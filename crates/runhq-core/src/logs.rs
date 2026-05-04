//! Per-service log ring buffer.
//!
//! Design goals:
//! - **Bounded memory** even under log floods — a single service cannot
//!   exceed [`DEFAULT_CAP`] lines retained in memory.
//! - **O(1) append**, **O(n)** snapshot (but `n` is bounded and snapshots
//!   happen only when a user opens a service panel).
//! - **Monotonic sequence numbers** so consumers can deduplicate after a
//!   reconnect or resubscribe.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

pub const DEFAULT_CAP: usize = 10_000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub seq: u64,
    pub ts_ms: i64,
    pub stream: Stream,
    pub text: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub raw: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Deterministic correlation id for the *run* that produced this line.
    ///
    /// A run spans from a successful `start_all`/`start_cmd` through every
    /// child-process exit for that service (including the synthetic
    /// `[exited code X]` closer). Every line the supervisor emits during
    /// that window — the `$ <cmd>` echo, pre-command banners, stdout,
    /// stderr, spawn failures, the closing line — carries the *same*
    /// id, so the UI can collapse them under the owning lifecycle event
    /// without any timestamp guesswork (IPC jitter would otherwise
    /// misattribute the pre-`running` echo to the previous `stopped`).
    ///
    /// Lines pushed outside of a run (e.g. future ad-hoc diagnostics)
    /// carry `None` and fall through to legacy time-window attribution
    /// on the client.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug)]
struct Ring {
    cap: usize,
    buf: VecDeque<LogLine>,
    next_seq: AtomicU64,
}

impl Ring {
    fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            buf: VecDeque::with_capacity(cap.min(1024)),
            next_seq: AtomicU64::new(1),
        }
    }

    fn push(&mut self, stream: Stream, text: String, run_id: Option<String>) -> LogLine {
        self.push_with_options(stream, text, run_id, None, false)
    }

    fn push_with_detail(
        &mut self,
        stream: Stream,
        text: String,
        run_id: Option<String>,
        detail: Option<String>,
    ) -> LogLine {
        self.push_with_options(stream, text, run_id, detail, false)
    }

    fn push_raw(&mut self, stream: Stream, text: String, run_id: Option<String>) -> LogLine {
        self.push_with_options(stream, text, run_id, None, true)
    }

    fn push_with_options(
        &mut self,
        stream: Stream,
        text: String,
        run_id: Option<String>,
        detail: Option<String>,
        raw: bool,
    ) -> LogLine {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let line = LogLine {
            seq,
            ts_ms: chrono::Utc::now().timestamp_millis(),
            stream,
            text,
            raw,
            detail,
            run_id,
        };
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back(line.clone());
        line
    }

    fn tail(&self, since_seq: u64, limit: usize) -> Vec<LogLine> {
        self.buf
            .iter()
            .filter(|l| l.seq > since_seq)
            .take(limit)
            .cloned()
            .collect()
    }

    fn snapshot(&self) -> Vec<LogLine> {
        self.buf.iter().cloned().collect()
    }

    fn clear(&mut self) {
        self.buf.clear();
    }
}

/// A shared, cloneable store keyed by service id.
#[derive(Debug, Default, Clone)]
pub struct LogStore {
    inner: Arc<Mutex<HashMap<String, Ring>>>,
}

impl LogStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append a line to the per-service ring.
    ///
    /// `run_id` is the id of the currently-active run for the service that
    /// owns this log key. Pass `None` for lines emitted outside any run
    /// (e.g. one-off diagnostics); in practice every supervisor-emitted
    /// line during a `start_*` → exit cycle passes `Some(...)`.
    pub fn push(
        &self,
        service_id: &str,
        stream: Stream,
        text: String,
        run_id: Option<String>,
    ) -> LogLine {
        let mut map = self.inner.lock();
        let ring = map
            .entry(service_id.to_string())
            .or_insert_with(|| Ring::new(DEFAULT_CAP));
        ring.push(stream, text, run_id)
    }

    pub fn push_with_detail(
        &self,
        service_id: &str,
        stream: Stream,
        text: String,
        run_id: Option<String>,
        detail: Option<String>,
    ) -> LogLine {
        let mut map = self.inner.lock();
        let ring = map
            .entry(service_id.to_string())
            .or_insert_with(|| Ring::new(DEFAULT_CAP));
        ring.push_with_detail(stream, text, run_id, detail)
    }

    pub fn push_raw(
        &self,
        service_id: &str,
        stream: Stream,
        text: String,
        run_id: Option<String>,
    ) -> LogLine {
        let mut map = self.inner.lock();
        let ring = map
            .entry(service_id.to_string())
            .or_insert_with(|| Ring::new(DEFAULT_CAP));
        ring.push_raw(stream, text, run_id)
    }

    pub fn tail(&self, service_id: &str, since_seq: u64, limit: usize) -> Vec<LogLine> {
        let map = self.inner.lock();
        map.get(service_id)
            .map(|r| r.tail(since_seq, limit))
            .unwrap_or_default()
    }

    pub fn snapshot(&self, service_id: &str) -> Vec<LogLine> {
        let map = self.inner.lock();
        map.get(service_id).map(Ring::snapshot).unwrap_or_default()
    }

    pub fn clear(&self, service_id: &str) {
        if let Some(r) = self.inner.lock().get_mut(service_id) {
            r.clear();
        }
    }
}
