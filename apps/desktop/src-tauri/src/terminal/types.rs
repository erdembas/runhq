use serde::Serialize;

/// Payload pushed through the per-terminal channel.
#[derive(Clone, Serialize)]
pub struct TerminalOutput {
    /// Base64-encoded raw PTY bytes.
    pub data: String,
    /// Identifies this shell generation so late acknowledgements are harmless.
    pub stream_id: String,
}
