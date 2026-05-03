use tauri::{Emitter, LogicalPosition, LogicalSize, Manager};

/// Hint banner dimensions (logical pixels — the frontend styles to match).
const TRAY_HINT_W: f64 = 360.0;
const TRAY_HINT_H: f64 = 104.0;
const TRAY_HINT_PAD_X: f64 = 16.0;
const TRAY_HINT_PAD_Y: f64 = 40.0;

pub(crate) fn install_tray_hint_window(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
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

    Ok(())
}

#[tauri::command]
pub fn show_tray_hint(app: tauri::AppHandle) {
    let Some(win) = app.get_webview_window("tray-hint") else {
        return;
    };

    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let position = monitor.position();
        let mon_logical_w = size.width as f64 / scale;
        let mon_logical_x = position.x as f64 / scale;
        let mon_logical_y = position.y as f64 / scale;

        let x = mon_logical_x + mon_logical_w - TRAY_HINT_W - TRAY_HINT_PAD_X;
        let y = mon_logical_y + TRAY_HINT_PAD_Y;

        let _ = win.set_size(LogicalSize::new(TRAY_HINT_W, TRAY_HINT_H));
        let _ = win.set_position(LogicalPosition::new(x, y));
    }

    let _ = win.emit("runhq://tray-hint-show", ());
    let _ = win.show();
}
