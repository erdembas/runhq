use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::window::focus_main_window;

pub(crate) struct TrayLabels {
    items: Vec<(String, MenuItem<tauri::Wry>)>,
}

fn stored_locale(app: &tauri::AppHandle) -> String {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("interface-locale")).ok())
        .filter(|locale| locale == "tr" || locale == "en")
        .unwrap_or_else(|| "en".into())
}

pub(crate) fn localize(app: &tauri::AppHandle, key: &str) -> String {
    localize_for(&stored_locale(app), key)
}

fn localize_for(locale: &str, key: &str) -> String {
    if locale == "tr" {
        static CATALOG: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
        let catalog = CATALOG.get_or_init(|| {
            serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../packages/cockpit-ui/src/i18n/tr.json"
            )))
            .expect("valid bundled Turkish catalog")
        });
        if let Some(value) = catalog.get(key).and_then(|value| value.as_str()) {
            return value.to_owned();
        }
    }
    key.to_owned()
}

#[tauri::command]
pub(crate) fn set_interface_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    if locale != "tr" && locale != "en" {
        return Err("Unsupported interface locale".into());
    }
    if let Some(labels) = app.try_state::<TrayLabels>() {
        for (key, item) in &labels.items {
            item.set_text(localize_for(&locale, key))
                .map_err(|error| error.to_string())?;
        }
    }
    for (label, title) in [
        ("quick-action", "Quick Action"),
        ("tray-hint", "RunHQ Hint"),
    ] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_title(&localize_for(&locale, title))
                .map_err(|error| error.to_string())?;
        }
    }
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("interface-locale"), locale).map_err(|error| error.to_string())
}

pub(crate) fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(
        app,
        "show",
        localize(app.handle(), "Show RunHQ"),
        true,
        None::<&str>,
    )?;
    let new_service = MenuItem::with_id(
        app,
        "new-service",
        localize(app.handle(), "New Service…"),
        true,
        None::<&str>,
    )?;
    let new_stack = MenuItem::with_id(
        app,
        "new-stack",
        localize(app.handle(), "New Stack…"),
        true,
        None::<&str>,
    )?;
    let scan = MenuItem::with_id(
        app,
        "scan",
        localize(app.handle(), "Discover projects…"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        localize(app.handle(), "Quit"),
        true,
        None::<&str>,
    )?;
    app.manage(TrayLabels {
        items: vec![
            ("Show RunHQ".into(), show.clone()),
            ("New Service…".into(), new_service.clone()),
            ("New Stack…".into(), new_stack.clone()),
            ("Discover projects…".into(), scan.clone()),
            ("Quit".into(), quit.clone()),
        ],
    });
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
