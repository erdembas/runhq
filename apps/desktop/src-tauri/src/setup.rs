use std::sync::Arc;

use runhq_core::events::EventSink;
use runhq_core::paths;
use runhq_core::process::Supervisor;
use runhq_core::state::Store;
use tauri::Manager;

use crate::app_state::{AppState, TauriEventSink};
use crate::quick_action::{install_quick_action_window, QuickActionGuard};
use crate::shortcuts::register_app_shortcuts;
use crate::terminal::TerminalManager;
use crate::tray::install_tray;
use crate::tray_hint::install_tray_hint_window;
use crate::window::install_main_window_close_handler;

pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    runhq_core::shell_env::import_login_shell_path();

    let home = paths::runhq_home()?;
    std::fs::create_dir_all(&home)?;

    let store = Arc::new(Store::open(&home)?);
    let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.handle().clone()));
    let supervisor = Arc::new(Supervisor::new(sink));
    let terminals = TerminalManager::new();

    let sampler_supervisor = supervisor.clone();
    tauri::async_runtime::spawn(async move {
        sampler_supervisor.run_resource_sampler().await;
    });

    app.manage(AppState {
        store: store.clone(),
        supervisor,
        terminals,
    });
    app.manage(QuickActionGuard::new());

    install_tray(app)?;
    install_quick_action_window(app)?;
    install_tray_hint_window(app)?;
    register_app_shortcuts(app, &store);
    install_main_window_close_handler(app);

    Ok(())
}
