//! RunHQ desktop shell.
//!
//! This crate is intentionally thin. All domain logic lives in
//! [`runhq_core`]; this shell is responsible for:
//!
//! 1. Wiring up Tauri plugins and commands.
//! 2. Implementing [`runhq_core::EventSink`] on top of Tauri's event bus.
//! 3. Exposing the IPC command surface ([`ipc`]) that the React UI talks to.
//!
//! If this file grows past a few hundred lines, split into submodules.

pub mod ipc;
pub mod terminal;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use runhq_core::events::EventSink;
use runhq_core::logs::LogLine;
use runhq_core::paths;
use runhq_core::process::{ServiceStatus, Supervisor};
use runhq_core::resources::ResourceSample;
use runhq_core::state::Store;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use terminal::TerminalManager;
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Debug, Clone, Serialize)]
struct LogEvent<'a> {
    service_id: &'a str,
    cmd_name: &'a str,
    line: &'a LogLine,
}

#[derive(Debug, Clone, Serialize)]
struct ResourceEvent<'a> {
    service_id: &'a str,
    #[serde(flatten)]
    sample: &'a ResourceSample,
}

struct TauriEventSink {
    app: tauri::AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit_log(&self, service_id: &str, cmd_name: &str, line: &LogLine) {
        let _ = self.app.emit(
            "service://log",
            LogEvent {
                service_id,
                cmd_name,
                line,
            },
        );
    }

    fn emit_status(&self, status: &ServiceStatus) {
        let _ = self.app.emit("service://status", status);
    }

    fn emit_resources(&self, service_id: &str, sample: &ResourceSample) {
        let _ = self
            .app
            .emit("service://resources", ResourceEvent { service_id, sample });
    }
}

/// Shared Tauri-managed state.
pub struct AppState {
    pub store: Arc<Store>,
    pub supervisor: Arc<Supervisor>,
    pub terminals: TerminalManager,
}

/// Grace window after a palette show during which we suppress the
/// focus-loss-based auto-hide. macOS fires a transient `Focused(false)`
/// event on transparent/borderless NSWindows between `show()` and the
/// window actually becoming key — without this guard, triggering the
/// palette while RunHQ is the frontmost app slams it shut the same
/// tick it opens.
const PALETTE_SHOW_GRACE: Duration = Duration::from_millis(250);

/// Tauri-managed state for the Quick Action window lifecycle.
///
/// Holds the timestamp of the most recent show so the blur handler can
/// distinguish "the user actually switched apps" from "macOS is still
/// settling key-window ownership right after we opened".
struct QuickActionGuard {
    last_shown: Mutex<Option<Instant>>,
}

/// Recenter the quick-action window on whichever monitor currently owns
/// the main RunHQ window (falling back to the palette's own monitor, then
/// the primary). Called on every show so the palette follows the user
/// across multi-monitor setups and tight 13" displays — the one-time
/// `.center()` in the builder only runs at startup and otherwise leaves
/// the palette pinned to its first home.
///
/// Also clamps the window size to the monitor's logical bounds so the
/// palette can never open off-screen on a small laptop display, which is
/// what was causing the panel to render too high on 13" MacBooks: the
/// 1200×900 default overflowed the 1280×800 MBA viewport and the React
/// side centered inside that overflowed frame, not the screen.
fn reposition_quick_action(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("quick-action") else {
        return;
    };

    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let scale = monitor.scale_factor();
    let size = monitor.size();
    let position = monitor.position();

    let mon_w = size.width as f64 / scale;
    let mon_h = size.height as f64 / scale;
    let mon_x = position.x as f64 / scale;
    let mon_y = position.y as f64 / scale;

    // Target is a spacious backdrop around the 620×520 palette — enough
    // transparent margin for "click outside to dismiss" to feel natural —
    // but never larger than the monitor minus menu bar / dock allowances.
    // Min of 720×560 keeps the backdrop usable on sub-laptop displays;
    // max of 1200×900 stops the window from stretching absurdly wide on
    // 5K studio displays.
    let win_w = (mon_w - 80.0).clamp(720.0, 1200.0);
    let win_h = (mon_h - 120.0).clamp(560.0, 900.0);

    let x = mon_x + (mon_w - win_w) / 2.0;
    let y = mon_y + (mon_h - win_h) / 2.0;

    let _ = win.set_size(LogicalSize::new(win_w, win_h));
    let _ = win.set_position(LogicalPosition::new(x, y));
}

fn toggle_quick_action(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick-action") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            emit_palette_closed(app);
        } else {
            // Stamp before `show()` — the `Focused(false)` race we're
            // guarding against can fire between `show()` returning and
            // our handler observing the state, so we need the grace
            // window to already be armed when the event arrives.
            if let Some(guard) = app.try_state::<QuickActionGuard>() {
                if let Ok(mut slot) = guard.last_shown.lock() {
                    *slot = Some(Instant::now());
                }
            }
            // Reposition BEFORE show so the window appears in its final
            // location on the first frame — otherwise the user sees a
            // flash at the old monitor position before it snaps over.
            reposition_quick_action(app);
            let _ = w.show();
            let _ = w.set_focus();
            // Only dim the main window when the user triggered the palette
            // while RunHQ itself was on-screen. If we're coming in from a
            // global shortcut (main window hidden/minimised) there's no
            // surface to dim, so firing the event would cause a stale
            // backdrop to linger the next time the main window is shown.
            let main_visible = app
                .get_webview_window("main")
                .and_then(|m| m.is_visible().ok())
                .unwrap_or(false);
            if main_visible {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.emit("runhq://palette-opened", ());
                }
            }
        }
    }
}

/// Tell the main window to tear down the quick-action backdrop overlay. Kept
/// as a helper so every code path that can hide the palette (toggle, blur,
/// close-requested) notifies the main window consistently — forgetting one
/// leaves the overlay stuck on screen until the next toggle.
fn emit_palette_closed(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("runhq://palette-closed", ());
    }
}

/// Hint banner dimensions (logical pixels — the frontend styles to match).
const TRAY_HINT_W: f64 = 360.0;
const TRAY_HINT_H: f64 = 104.0;
/// Inset from the primary monitor's top-right corner. We target a spot that
/// lives under the macOS menubar (≈24 px tall) with a little breathing room,
/// which also lines up nicely with taskbar tray icons on Windows.
const TRAY_HINT_PAD_X: f64 = 16.0;
const TRAY_HINT_PAD_Y: f64 = 40.0;

/// Show the in-app tray hint banner.
///
/// The window is pre-warmed during `setup()` so this command can reposition
/// and reveal it without paying webview startup time — important because the
/// user triggered this by closing the main window and we want the banner to
/// feel instantaneous, not "uh, where did the app go?".
///
/// Positioning math runs fresh each show so the banner follows monitor
/// changes (dock/undock, display swap) without us subscribing to events.
#[tauri::command]
fn show_tray_hint(app: tauri::AppHandle) {
    let Some(win) = app.get_webview_window("tray-hint") else {
        return;
    };

    // Anchor to whichever monitor the main window currently calls home —
    // falling back to the primary monitor if the main window is hidden or
    // gone. This matches where the user's attention most likely is.
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let position = monitor.position();
        // Convert physical monitor geometry to the logical coordinates
        // Tauri's `set_position` expects.
        let mon_logical_w = size.width as f64 / scale;
        let mon_logical_x = position.x as f64 / scale;
        let mon_logical_y = position.y as f64 / scale;

        let x = mon_logical_x + mon_logical_w - TRAY_HINT_W - TRAY_HINT_PAD_X;
        let y = mon_logical_y + TRAY_HINT_PAD_Y;

        let _ = win.set_size(LogicalSize::new(TRAY_HINT_W, TRAY_HINT_H));
        let _ = win.set_position(LogicalPosition::new(x, y));
    }

    // Fire the "show" event BEFORE un-hiding so the React side arms its
    // enter animation on the same frame the user sees the window.
    let _ = win.emit("runhq://tray-hint-show", ());
    let _ = win.show();
}

/// JS-facing hook around [`toggle_quick_action`] so the in-app titlebar
/// trigger drives the exact same floating Quick Action window as the OS-wide
/// global shortcut. Having one path prevents drift between entrypoints.
#[tauri::command]
fn show_quick_action(app: tauri::AppHandle) {
    toggle_quick_action(&app);
}

/// Unconditionally hide the Quick Action palette and notify the main window.
/// Unlike [`show_quick_action`] (which toggles), this never re-shows the
/// window — safe to call from a backdrop click where a concurrent
/// `Focused(false)` may have already hidden the palette.
#[tauri::command]
fn hide_quick_action(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick-action") {
        let _ = w.hide();
    }
    emit_palette_closed(&app);
}

/// Bring the main RunHQ window to the foreground from any entry point —
/// Quick Action sub-actions, tray, global shortcuts. Needed because:
///   • Cmd+H on macOS hides the NSApp, and a plain `window.show()` won't
///     un-hide the app; you must call `app.show()` first.
///   • Closing the traffic-light on macOS leaves the window `orderOut:`'d
///     AND often drops NSApp back to `Accessory` — `set_focus()` alone can
///     then surface the window but leave it behind other apps. Re-asserting
///     the `Regular` activation policy every time guarantees the window
///     actually comes to the foreground.
///   • Minimised windows need an explicit `unminimize()` before `show()`.
///   • Doing this in Rust sidesteps per-method JS permissions (is_minimized,
///     unminimize, app-show) — one capability (`invoke`) covers the lot.
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        // Reassert Regular before unhide: if the app ever slipped into
        // Accessory (the "silent background app" state), `app.show()` is a
        // no-op and the window stays hidden.
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = app.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
        // macOS occasionally lands the window "visible but behind the
        // frontmost app" when coming out of a hidden state (close-button
        // → tray-click path, most commonly). A second `set_focus` after
        // `show()` has settled the window level reliably promotes it to
        // key — cheap insurance that the user ends up actually looking
        // at the window they just asked for.
        #[cfg(target_os = "macos")]
        {
            let _ = w.set_focus();
        }
    }
}

/// Rewrite legacy bare `Cmd+…` shortcut strings to the platform-aware
/// `CmdOrCtrl+…` form Tauri's global-shortcut parser expects. See the
/// "Global Shortcuts" section in `setup()` for the full rationale —
/// pulled out here so both shortcut registrations share one source of
/// truth instead of duplicating the rewrite inline.
fn normalise_shortcut_string(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix("Cmd+") {
        format!("CmdOrCtrl+{rest}")
    } else {
        raw.to_string()
    }
}

/// Parse a normalised shortcut string and bind it to a press handler.
/// The handler runs only on `ShortcutState::Pressed` so a user holding
/// the chord doesn't fire the action repeatedly while the keys
/// debounce (the global-shortcut plugin emits both Pressed and
/// Released events; we only care about the leading edge).
///
/// Failures are logged with the binding `name` so a bad config row is
/// debuggable from the logs without us needing to surface a UI toast
/// for what is almost always a typo in a hand-edited prefs file.
fn register_global_shortcut<F>(
    global_shortcut: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    name: &'static str,
    shortcut_str: &str,
    handler: F,
) where
    F: Fn(&tauri::AppHandle) + Send + Sync + 'static,
{
    match shortcut_str.parse::<tauri_plugin_global_shortcut::Shortcut>() {
        Ok(shortcut) => {
            if let Err(e) = global_shortcut.on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    handler(app);
                }
            }) {
                tracing::warn!("failed to register global shortcut '{name}' ({shortcut_str}): {e}");
            }
        }
        Err(e) => {
            tracing::warn!("invalid shortcut string for '{name}' ({shortcut_str}): {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // GUI launches (`open RunHQ.app`, Finder, Dock) inherit the
            // launchd PATH, which is the bare-bones `/usr/bin:/bin:...` set.
            // That breaks every subprocess we spawn (`npm outdated`,
            // `cargo audit`, `pip-audit`, AI tool calls, etc.) because dev
            // binaries installed via `brew`, `nvm`, `fnm`, `volta`, `asdf`,
            // `rustup`, `pyenv` live elsewhere. Two-layer recovery: probe
            // the user's login shell PATH AND always merge in canonical
            // dev-tool dirs so nvm shims (typically initialised in
            // `.zshrc`, not `.zprofile`) still resolve. Dev builds started
            // with `cargo run` from a terminal are unaffected (their
            // parent shell already exports the full PATH) but calling
            // this unconditionally is cheap and keeps prod/dev parity.
            runhq_core::shell_env::import_login_shell_path();

            let home = paths::runhq_home()?;
            std::fs::create_dir_all(&home)?;

            let store = Arc::new(Store::open(&home)?);
            let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink {
                app: app.handle().clone(),
            });
            let supervisor = Arc::new(Supervisor::new(sink));
            let terminals = TerminalManager::new();

            // Drive the per-service CPU + memory sampler on Tauri's own
            // async runtime. Can't call `tokio::spawn` inside `setup()` —
            // the runtime isn't mounted yet; `tauri::async_runtime::spawn`
            // picks the right one and lives for the whole app lifetime.
            let sampler_supervisor = supervisor.clone();
            tauri::async_runtime::spawn(async move {
                sampler_supervisor.run_resource_sampler().await;
            });

            app.manage(AppState {
                store: store.clone(),
                supervisor,
                terminals,
            });

            app.manage(QuickActionGuard {
                last_shown: Mutex::new(None),
            });

            // ---- System Tray ----
            let show = MenuItem::with_id(app, "show", "Show RunHQ", true, None::<&str>)?;
            let new_service =
                MenuItem::with_id(app, "new-service", "New Service…", true, None::<&str>)?;
            let new_stack = MenuItem::with_id(app, "new-stack", "New Stack…", true, None::<&str>)?;
            let scan = MenuItem::with_id(app, "scan", "Discover projects…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&show, &sep, &new_service, &new_stack, &scan, &sep, &quit],
            )?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("RunHQ")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => focus_main_window(app.clone()),
                    "new-service" => {
                        focus_main_window(app.clone());
                        let _ = app.emit("runhq://tray-action", "new-service");
                    }
                    "new-stack" => {
                        focus_main_window(app.clone());
                        let _ = app.emit("runhq://tray-action", "new-stack");
                    }
                    "scan" => {
                        focus_main_window(app.clone());
                        let _ = app.emit("runhq://tray-action", "scan");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Treat *any* left-click release as "bring me back".
                    // Tauri emits both Down and Up on macOS; we only act on
                    // Up so a long-press doesn't fire twice, but we accept
                    // it regardless of which code path the platform uses
                    // first. The previous handler missed the very first
                    // click after a close-to-tray on some macOS builds
                    // because the Down was swallowed by the menu-on-left
                    // gesture recognizer — dropping that gesture (via
                    // `show_menu_on_left_click(false)` above) fixes that,
                    // and we keep the Up filter for deterministic behaviour.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main_window(tray.app_handle().clone());
                    }
                })
                .build(app)?;

            // ---- Quick Action floating window ----
            let qa_url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External(
                    "http://localhost:1420/quick-action.html".parse().unwrap(),
                )
            } else {
                tauri::WebviewUrl::App("quick-action.html".into())
            };

            let qa_window = tauri::WebviewWindowBuilder::new(app, "quick-action", qa_url)
                .title("Quick Action")
                .inner_size(1200.0, 900.0)
                .center()
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .shadow(false)
                .background_color(tauri::utils::config::Color(0, 0, 0, 0))
                .build()?;

            let qa_win = qa_window.clone();
            qa_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Focused(false) => {
                    // Suppress the spurious blur event macOS emits in the
                    // tiny window between `show()` and the palette actually
                    // becoming key — see `PALETTE_SHOW_GRACE`. A real focus
                    // loss (user clicked another app) fires well after the
                    // grace window, so this only filters the race, not the
                    // legitimate "click-away to dismiss" UX.
                    let app = qa_win.app_handle();
                    let within_grace = app
                        .try_state::<QuickActionGuard>()
                        .and_then(|g| g.last_shown.lock().ok().and_then(|slot| *slot))
                        .map(|t| t.elapsed() < PALETTE_SHOW_GRACE)
                        .unwrap_or(false);
                    if within_grace {
                        return;
                    }
                    let _ = qa_win.hide();
                    emit_palette_closed(app);
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = qa_win.hide();
                    emit_palette_closed(qa_win.app_handle());
                }
                _ => {}
            });

            // ---- Tray hint banner (in-app "RunHQ still running" toast) ----
            //
            // A separate webview so we can animate independently of the
            // main window and so dismissing it doesn't clobber main-window
            // state. Pre-warmed at startup (rather than lazily created the
            // first time we show it) to keep the show timing instant — the
            // user just pressed close, any perceptible delay feels like a
            // crash.
            //
            // It's transparent, decoration-less, always-on-top, and opted
            // out of the taskbar / app switcher so it reads as a toast
            // rather than a window. Close requests just hide so we can
            // reuse the window for subsequent shows.
            let th_url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External("http://localhost:1420/tray-hint.html".parse().unwrap())
            } else {
                tauri::WebviewUrl::App("tray-hint.html".into())
            };

            let th_window = tauri::WebviewWindowBuilder::new(app, "tray-hint", th_url)
                .title("RunHQ Hint")
                .inner_size(TRAY_HINT_W, TRAY_HINT_H)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .focused(false)
                .shadow(false)
                .background_color(tauri::utils::config::Color(0, 0, 0, 0))
                .build()?;

            let th_win = th_window.clone();
            th_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = th_win.hide();
                }
            });

            // ---- Global Shortcuts ----
            //
            // Before v0.2.1 the stored default was a literal `Cmd+Shift+K`.
            // Tauri's global-shortcut parser maps bare `Cmd` to SUPER, which
            // is fine on macOS (⌘) but binds the Windows/Super key on
            // Linux/Windows — almost never what the user wants, and on
            // Windows 10+ the OS grabs `Win+Shift+K` for itself. We rewrite
            // any legacy bare `Cmd+…` prefix to `CmdOrCtrl+…` so the parser
            // resolves it to the platform-native modifier (Cmd on macOS,
            // Ctrl elsewhere) without forcing a migration write on the
            // user's config file.
            //
            // Two shortcuts are registered side by side, both honouring the
            // legacy-prefix rewrite via `normalise_shortcut_string`:
            //   • Quick Action  → opens the floating command palette
            //   • Focus Main    → promotes the main window to the front
            // They're decoupled in user prefs so users can rebind either
            // (or both) without dragging the other along — different
            // gestures for different muscle memory.
            let snapshot_shortcuts = store.snapshot().prefs.shortcuts.clone();
            let global_shortcut = app.global_shortcut();

            let qa_shortcut_str = normalise_shortcut_string(&snapshot_shortcuts.quick_action);
            // `app.global_shortcut()` already returns a `&GlobalShortcut<Wry>`,
            // so the helper takes that reference directly — adding another
            // `&` here would just chain `&&…` and trip Clippy's
            // `needless_borrow` lint in release builds.
            register_global_shortcut(
                global_shortcut,
                "quick_action",
                &qa_shortcut_str,
                |app| {
                    toggle_quick_action(app);
                },
            );

            let focus_shortcut_str = normalise_shortcut_string(&snapshot_shortcuts.focus_main);
            // Defensive: if a user (or a corrupted config) ends up with
            // both shortcuts pointing to the same chord, registering the
            // second one would just clobber the first silently — Tauri's
            // global-shortcut plugin overwrites the previous handler
            // without warning. Skip the duplicate to keep the palette
            // working; the Settings UI also flags equal bindings to
            // surface the conflict, but defence in depth is cheap.
            if !focus_shortcut_str.eq_ignore_ascii_case(&qa_shortcut_str) {
                register_global_shortcut(
                    global_shortcut,
                    "focus_main",
                    &focus_shortcut_str,
                    |app| {
                        focus_main_window(app.clone());
                    },
                );
            } else {
                tracing::warn!(
                    "focus_main shortcut equals quick_action ({qa_shortcut_str}); skipping focus_main registration to avoid clobbering palette binding"
                );
            }

            // ---- Main window close → hide instead of quit ----
            //
            // We emit `runhq://main-will-hide` BEFORE hiding so the React side
            // has a chance to show the one-time "still running in the menu
            // bar" OS notification. The emit must happen while the webview is
            // still alive; after `hide()` it remains alive on macOS but may
            // be paused by the OS on other platforms.
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let _ = win.emit("runhq://main-will-hide", ());
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::app_info,
            ipc::list_services,
            ipc::add_service,
            ipc::update_service,
            ipc::remove_service,
            ipc::scan_directory,
            ipc::detect_project,
            ipc::start_service,
            ipc::start_service_cmd,
            ipc::stop_service,
            ipc::stop_service_cmd,
            ipc::restart_service,
            ipc::service_status,
            ipc::get_logs,
            ipc::clear_logs,
            ipc::list_ports,
            ipc::kill_port,
            ipc::open_path,
            ipc::open_url,
            ipc::get_prefs,
            ipc::update_prefs,
            ipc::detect_editors,
            ipc::open_in_editor,
            ipc::list_stacks,
            ipc::add_stack,
            ipc::update_stack,
            ipc::remove_stack,
            ipc::start_stack,
            ipc::stop_stack,
            ipc::restart_stack,
            ipc::git_status,
            ipc::git_branches,
            ipc::git_remote_branches,
            ipc::git_checkout,
            ipc::git_create_branch,
            ipc::git_delete_branch,
            ipc::git_fetch,
            ipc::git_pull,
            ipc::git_stash,
            ipc::git_stash_pop,
            ipc::git_undo_last_commit,
            ipc::git_amend_commit_message,
            ipc::git_stage_file,
            ipc::git_unstage_file,
            ipc::git_stage_all,
            ipc::git_unstage_all,
            ipc::git_discard_file,
            ipc::git_commit,
            ipc::git_push,
            ipc::git_log,
            ipc::git_show_commit,
            ipc::git_diff_commit_file,
            ipc::get_project_overview,
            ipc::scan_project_dependencies,
            ipc::scan_project_dependency_for_service,
            ipc::list_persisted_scans,
            ipc::delete_persisted_scan,
            ipc::clear_persisted_scans,
            ipc::record_timeline_event,
            ipc::get_timeline,
            ipc::get_daily_summary,
            ipc::get_weekly_summary,
            ipc::export_standup,
            ipc::list_conversations,
            ipc::get_conversation,
            ipc::create_conversation,
            ipc::append_conversation_message,
            ipc::rename_conversation,
            ipc::pin_conversation,
            ipc::favorite_conversation,
            ipc::archive_conversation,
            ipc::delete_conversation,
            ipc::git_diff,
            ipc::git_diff_staged,
            ipc::git_diff_file,
            ipc::git_diff_file_staged,
            ipc::git_diff_branches,
            ipc::git_diff_all_raw,
            ipc::git_diff_staged_raw,
            ipc::list_ai_providers,
            ipc::upsert_ai_provider,
            ipc::remove_ai_provider,
            ipc::set_default_ai_provider,
            ipc::test_ai_provider,
            ipc::ai_chat_completion,
            ipc::ai_chat_completion_stream,
            ipc::ai_generate_commit_message,
            ipc::ai_commit_chat_context,
            ipc::ai_explain_diff,
            ipc::ai_explain_log,
            ipc::ai_triage_advisories,
            ipc::ai_polish_standup,
            ipc::ai_analyze_workspace,
            ipc::ai_count_tokens,
            ipc::ai_explain_project_state,
            ipc::list_notes,
            ipc::read_note,
            ipc::write_note,
            ipc::delete_note,
            ipc::create_note,
            ipc::read_all_notes,
            ipc::list_noted_services,
            ipc::discover_project_docs,
            ipc::read_project_doc,
            ipc::resolve_doc_image,
            ipc::scan_licenses,
            ipc::generate_third_party_notices,
            ipc::write_third_party_notices,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_destroy,
            show_quick_action,
            hide_quick_action,
            focus_main_window,
            show_tray_hint,
        ])
        .build(tauri::generate_context!())
        .expect("error while building RunHQ")
        .run(|app_handle, event| {
            // macOS dock-click reopen. When the user red-X's the window we
            // `prevent_close` + `hide`, which leaves zero visible NSWindows.
            // macOS then sends `applicationShouldHandleReopen:` the next
            // time the user clicks the dock tile — Tauri surfaces this as
            // `RunEvent::Reopen`. Without handling it the dock icon becomes
            // a no-op, which looks like the app froze.
            //
            // We only refocus when there are no visible windows; if the
            // user still has the main window open (e.g. they clicked the
            // dock tile to bring it forward from another Space) macOS does
            // the right thing on its own and we don't want to stack up a
            // redundant show() call.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    focus_main_window(app_handle.clone());
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle;
                let _ = event;
            }
        });
}
