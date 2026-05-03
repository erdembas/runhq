use std::io::Read;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::ipc::Channel;

use super::TerminalOutput;

/// Maximum window the flusher will hold a partial batch before shipping it.
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);

/// Hard size cap that forces an immediate flush, even mid-window.
const FLUSH_THRESHOLD: usize = 32 * 1024;

/// Buffer the reader uses for each blocking `read()` call.
const READ_BUF: usize = 8 * 1024;

pub(super) fn spawn_output_pipeline(
    mut reader: Box<dyn Read + Send>,
    on_output: Channel<TerminalOutput>,
) {
    let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>();

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
        let mut acc: Vec<u8> = Vec::with_capacity(64 * 1024);
        loop {
            match chunk_rx.recv_timeout(FLUSH_INTERVAL) {
                Ok(chunk) => {
                    acc.extend_from_slice(&chunk);
                    while acc.len() < FLUSH_THRESHOLD {
                        match chunk_rx.try_recv() {
                            Ok(more) => acc.extend_from_slice(&more),
                            Err(_) => break,
                        }
                    }
                    if acc.len() >= FLUSH_THRESHOLD {
                        emit_batch(&on_output, &acc);
                        acc.clear();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !acc.is_empty() {
                        emit_batch(&on_output, &acc);
                        acc.clear();
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if !acc.is_empty() {
                        emit_batch(&on_output, &acc);
                    }
                    return;
                }
            }
        }
    });
}

fn emit_batch(channel: &Channel<TerminalOutput>, bytes: &[u8]) {
    let _ = channel.send(TerminalOutput {
        data: BASE64.encode(bytes),
    });
}
