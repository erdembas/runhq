//! RunHQ desktop shell.
//!
//! This crate is intentionally thin. All domain logic lives in
//! [`runhq_core`]; this shell is responsible for:
//!
//! 1. Wiring up Tauri plugins and commands.
//! 2. Implementing [`runhq_core::EventSink`] on top of Tauri's event bus.
//! 3. Exposing the IPC command surface ([`ipc`]) that the React UI talks to.

mod app_state;
pub mod ipc;
mod quick_action;
mod setup;
mod shortcuts;
pub mod terminal;
mod tray;
mod tray_hint;
mod window;

pub use app_state::AppState;

use setup::setup_app;
use tracing_subscriber::{fmt, EnvFilter};
use window::focus_main_window;

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
        .setup(setup_app)
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
            terminal::commands::terminal_create,
            terminal::commands::terminal_write,
            terminal::commands::terminal_resize,
            terminal::commands::terminal_destroy,
            quick_action::show_quick_action,
            quick_action::hide_quick_action,
            window::focus_main_window,
            tray_hint::show_tray_hint,
        ])
        .build(tauri::generate_context!())
        .expect("error while building RunHQ")
        .run(|app_handle, event| {
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
