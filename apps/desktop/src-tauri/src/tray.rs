use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};

use crate::window::focus_main_window;

pub(crate) fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show RunHQ", true, None::<&str>)?;
    let new_service = MenuItem::with_id(app, "new-service", "New Service…", true, None::<&str>)?;
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

    Ok(())
}
