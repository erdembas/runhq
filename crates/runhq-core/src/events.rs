//! Event sink abstraction.

use crate::logs::LogLine;
use crate::process::ServiceStatus;
use crate::resources::ResourceSample;

pub trait EventSink: Send + Sync + 'static {
    fn emit_log(&self, service_id: &str, cmd_name: &str, line: &LogLine);
    fn emit_status(&self, status: &ServiceStatus);
    fn emit_resources(&self, service_id: &str, sample: &ResourceSample);
}

#[derive(Default, Clone, Copy)]
pub struct NullSink;

impl EventSink for NullSink {
    fn emit_log(&self, _service_id: &str, _cmd_name: &str, _line: &LogLine) {}
    fn emit_status(&self, _status: &ServiceStatus) {}
    fn emit_resources(&self, _service_id: &str, _sample: &ResourceSample) {}
}
