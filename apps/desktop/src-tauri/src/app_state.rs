use std::sync::Arc;

use runhq_core::events::EventSink;
use runhq_core::logs::LogLine;
use runhq_core::process::{ServiceStatus, Supervisor};
use runhq_core::resources::ResourceSample;
use runhq_core::state::Store;
use serde::Serialize;
use tauri::Emitter;

use crate::terminal::TerminalManager;

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

pub struct TauriEventSink {
    app: tauri::AppHandle,
}

impl TauriEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
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
