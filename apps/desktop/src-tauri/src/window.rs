use tauri::{Emitter, Manager};

#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = app.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
        #[cfg(target_os = "macos")]
        {
            let _ = w.set_focus();
        }
    }
}

pub(crate) fn install_main_window_close_handler(app: &mut tauri::App) {
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
}
