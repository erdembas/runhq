use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::events::EventSink;
use crate::logs::{LogStore, Stream};

// All parameters here are plumbing for the line-reader task; bundling
// them into a struct just to satisfy the 7-argument lint would trade a
// legitimate warning for a layer of indirection readers have to peel
// back at every call site. Every argument is load-bearing, so allow it.
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_line_reader<R>(
    log_key: &str,
    reader: R,
    stream: Stream,
    logs: LogStore,
    sink: Arc<dyn EventSink>,
    svc_id: String,
    cmd_name: String,
    run_id: Option<String>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let key = log_key.to_string();
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            // Clone once per line — the run id is a ~36-byte UUID string,
            // so the allocation is trivial next to the kernel read and the
            // IPC emit we're about to do.
            let line = logs.push(&key, stream, text, run_id.clone());
            sink.emit_log(&svc_id, &cmd_name, &line);
        }
    });
}
