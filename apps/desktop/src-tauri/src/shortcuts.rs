use runhq_core::state::Store;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::quick_action::toggle_quick_action;
use crate::window::focus_main_window;

fn normalise_shortcut_string(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix("Cmd+") {
        format!("CmdOrCtrl+{rest}")
    } else {
        raw.to_string()
    }
}

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

pub(crate) fn register_app_shortcuts(app: &mut tauri::App, store: &Store) {
    let snapshot_shortcuts = store.snapshot().prefs.shortcuts.clone();
    let global_shortcut = app.global_shortcut();

    let qa_shortcut_str = normalise_shortcut_string(&snapshot_shortcuts.quick_action);
    register_global_shortcut(global_shortcut, "quick_action", &qa_shortcut_str, |app| {
        toggle_quick_action(app);
    });

    let focus_shortcut_str = normalise_shortcut_string(&snapshot_shortcuts.focus_main);
    if !focus_shortcut_str.eq_ignore_ascii_case(&qa_shortcut_str) {
        register_global_shortcut(global_shortcut, "focus_main", &focus_shortcut_str, |app| {
            focus_main_window(app.clone());
        });
    } else {
        tracing::warn!(
            "focus_main shortcut equals quick_action ({qa_shortcut_str}); skipping focus_main registration to avoid clobbering palette binding"
        );
    }
}
