use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, LogicalPosition, LogicalSize, Manager};

/// Grace window after a palette show during which we suppress the
/// focus-loss-based auto-hide.
const PALETTE_SHOW_GRACE: Duration = Duration::from_millis(250);

/// Tauri-managed state for the Quick Action window lifecycle.
pub(crate) struct QuickActionGuard {
    pub(crate) last_shown: Mutex<Option<Instant>>,
}

impl QuickActionGuard {
    pub(crate) fn new() -> Self {
        Self {
            last_shown: Mutex::new(None),
        }
    }
}

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

    let win_w = (mon_w - 80.0).clamp(720.0, 1200.0);
    let win_h = (mon_h - 120.0).clamp(560.0, 900.0);

    let x = mon_x + (mon_w - win_w) / 2.0;
    let y = mon_y + (mon_h - win_h) / 2.0;

    let _ = win.set_size(LogicalSize::new(win_w, win_h));
    let _ = win.set_position(LogicalPosition::new(x, y));
}

pub(crate) fn toggle_quick_action(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick-action") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            emit_palette_closed(app);
        } else {
            if let Some(guard) = app.try_state::<QuickActionGuard>() {
                if let Ok(mut slot) = guard.last_shown.lock() {
                    *slot = Some(Instant::now());
                }
            }
            reposition_quick_action(app);
            let _ = w.show();
            let _ = w.set_focus();

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

pub(crate) fn emit_palette_closed(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("runhq://palette-closed", ());
    }
}

pub(crate) fn install_quick_action_window(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    let qa_url = if cfg!(debug_assertions) {
        tauri::WebviewUrl::External("http://localhost:1420/quick-action.html".parse().unwrap())
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

    Ok(())
}

#[tauri::command]
pub fn show_quick_action(app: tauri::AppHandle) {
    toggle_quick_action(&app);
}

#[tauri::command]
pub fn hide_quick_action(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick-action") {
        let _ = w.hide();
    }
    emit_palette_closed(&app);
}
