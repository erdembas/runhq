use std::io::Read;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use parking_lot::{Condvar, Mutex};
use tauri::ipc::Channel;

use super::TerminalOutput;

const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
const FLUSH_THRESHOLD: usize = 32 * 1024;
const READ_BUF: usize = 8 * 1024;
// Bound both the native reader queue and bytes waiting for xterm to parse.
const READ_QUEUE_CHUNKS: usize = 16;
const OUTPUT_WINDOW: usize = 128 * 1024;

#[derive(Default)]
struct FlowState {
    pending: usize,
    closed: bool,
}

pub(super) struct OutputFlow {
    pub(super) id: String,
    state: Mutex<FlowState>,
    ready: Condvar,
}

impl Default for OutputFlow {
    fn default() -> Self {
        Self::new(uuid::Uuid::new_v4().to_string())
    }
}

impl OutputFlow {
    pub(super) fn new(id: String) -> Self {
        Self {
            id,
            state: Mutex::new(FlowState::default()),
            ready: Condvar::new(),
        }
    }

    fn reserve(&self, bytes: usize) -> bool {
        let mut state = self.state.lock();
        while !state.closed && state.pending + bytes > OUTPUT_WINDOW {
            self.ready.wait(&mut state);
        }
        if state.closed {
            return false;
        }
        state.pending += bytes;
        true
    }

    pub(super) fn acknowledge(&self, bytes: usize) {
        let mut state = self.state.lock();
        state.pending = state.pending.saturating_sub(bytes);
        self.ready.notify_all();
    }

    pub(super) fn close(&self) {
        self.state.lock().closed = true;
        self.ready.notify_all();
    }
}

pub(super) fn spawn_output_pipeline(
    mut reader: Box<dyn Read + Send>,
    on_output: Channel<TerminalOutput>,
    flow: Arc<OutputFlow>,
) {
    let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Vec<u8>>(READ_QUEUE_CHUNKS);

    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if chunk_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    std::thread::spawn(move || {
        loop {
            let Ok(first) = chunk_rx.recv() else { return };
            let mut acc = first;
            // A deadline measured from the first byte, not an idle timeout:
            // steady trickles of output must not postpone the flush forever.
            let deadline = Instant::now() + FLUSH_INTERVAL;
            let mut disconnected = false;
            while acc.len() < FLUSH_THRESHOLD {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match chunk_rx.recv_timeout(remaining) {
                    Ok(chunk) => acc.extend_from_slice(&chunk),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
            if !flow.reserve(acc.len()) {
                return;
            }
            if on_output
                .send(TerminalOutput {
                    data: BASE64.encode(&acc),
                    stream_id: flow.id.clone(),
                })
                .is_err()
            {
                flow.close();
                return;
            }
            if disconnected {
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_output_is_bounded_and_lossless_with_a_slow_consumer() {
        let expected: Vec<u8> = (0..2 * 1024 * 1024).map(|i| (i % 256) as u8).collect();
        let flow = Arc::new(OutputFlow::default());
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                panic!("expected JSON")
            };
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            tx.send(BASE64.decode(value["data"].as_str().unwrap()).unwrap())
                .unwrap();
            Ok(())
        });
        spawn_output_pipeline(
            Box::new(std::io::Cursor::new(expected.clone())),
            channel,
            flow.clone(),
        );
        let mut actual = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        while let Ok(chunk) = rx.recv_timeout(Duration::from_millis(50)) {
            actual.extend(chunk);
        }
        // Batches may be partial when the producer is preempted. It must stop
        // within one batch of the window, never exceed it or require data loss.
        assert!(actual.len() <= OUTPUT_WINDOW);
        assert!(actual.len() > OUTPUT_WINDOW - FLUSH_THRESHOLD - READ_BUF);
        flow.acknowledge(actual.len());
        while actual.len() < expected.len() {
            let chunk = rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let size = chunk.len();
            actual.extend(chunk);
            flow.acknowledge(size);
        }
        assert_eq!(actual, expected);
    }

    #[test]
    fn output_waits_for_parser_acknowledgement() {
        let flow = Arc::new(OutputFlow::default());
        assert!(flow.reserve(OUTPUT_WINDOW));
        let worker_flow = flow.clone();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || tx.send(worker_flow.reserve(1)).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        flow.acknowledge(1);
        assert!(rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
    }

    #[test]
    fn shutdown_releases_a_blocked_output_worker() {
        let flow = Arc::new(OutputFlow::default());
        assert!(flow.reserve(OUTPUT_WINDOW));
        let worker_flow = flow.clone();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || tx.send(worker_flow.reserve(1)).unwrap());
        flow.close();
        assert!(!rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
    }

    #[test]
    fn late_acknowledgement_cannot_underflow() {
        let flow = OutputFlow::default();
        flow.acknowledge(OUTPUT_WINDOW);
        assert!(flow.reserve(OUTPUT_WINDOW));
    }
}
