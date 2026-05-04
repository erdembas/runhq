use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::events::EventSink;
use crate::logs::LogStore;
use crate::resources::{ResourceSample, ResourceSampler};
use crate::state::ServiceDef;
use parking_lot::Mutex;

use super::pty::{DEFAULT_SERVICE_PTY_COLS, DEFAULT_SERVICE_PTY_ROWS};
use super::types::{process_key, Running, ServiceStatus};

/// How often the supervisor samples per-service CPU + memory.
///
/// 2s is the sweet spot: frequent enough that UI sparklines feel live when
/// a service spikes, infrequent enough that the sysinfo refresh (which walks
/// every running process) stays well below 1% of the supervisor's own CPU
/// budget on a laptop with a dozen running services.
const RESOURCE_SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

/// The supervisor — cheap to clone (internally an `Arc` structure).
pub struct Supervisor {
    pub(super) sink: Arc<dyn EventSink>,
    pub logs: LogStore,
    pub(super) running: Arc<Mutex<HashMap<String, Running>>>,
    pub(super) statuses: Arc<Mutex<HashMap<String, ServiceStatus>>>,
    pub(super) last_resources: Arc<Mutex<HashMap<String, ResourceSample>>>,
    /// Active run id per service, keyed by service_id.
    ///
    /// An entry is inserted at the top of `start_all` / `start_cmd` (before
    /// any spawn), read by every code path that emits a log line for this
    /// service during the run, and removed by the supervision task once
    /// the *last* command for the service has terminated. Lines that
    /// arrive after the entry is cleared (e.g. the child-task emitted
    /// `[exited]` closer races the next `start_cmd`) carry `None` — the
    /// client treats those as orphan lines rather than misattributing
    /// them.
    pub(super) run_ids: Arc<Mutex<HashMap<String, String>>>,
    pub(super) pty_sizes: Arc<Mutex<HashMap<String, (u16, u16)>>>,
}

impl Supervisor {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            logs: LogStore::new(),
            running: Arc::new(Mutex::new(HashMap::new())),
            statuses: Arc::new(Mutex::new(HashMap::new())),
            last_resources: Arc::new(Mutex::new(HashMap::new())),
            run_ids: Arc::new(Mutex::new(HashMap::new())),
            pty_sizes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn resize_command_pty(
        &self,
        service_id: &str,
        cmd_name: &str,
        cols: u16,
        rows: u16,
    ) -> AppResult<()> {
        let key = process_key(service_id, cmd_name);
        let size = (cols.max(20), rows.max(5));
        self.pty_sizes.lock().insert(key.clone(), size);

        let handle = self.running.lock().get(&key).and_then(|r| r.pty.clone());
        if let Some(handle) = handle {
            handle.resize(size.0, size.1)?;
        }
        Ok(())
    }

    pub(super) fn pty_size_for(&self, key: &str) -> (u16, u16) {
        self.pty_sizes
            .lock()
            .get(key)
            .copied()
            .unwrap_or((DEFAULT_SERVICE_PTY_COLS, DEFAULT_SERVICE_PTY_ROWS))
    }

    /// Read the active run id for a service (if any). Cloning once under
    /// the lock keeps the critical section tiny — no long borrow leaks
    /// into the async codepaths downstream.
    pub(super) fn current_run_id(&self, service_id: &str) -> Option<String> {
        self.run_ids.lock().get(service_id).cloned()
    }

    pub fn get_resources(&self, service_id: &str) -> Option<ResourceSample> {
        self.last_resources.lock().get(service_id).copied()
    }

    /// Long-running CPU + memory sampler. Ticks every
    /// [`RESOURCE_SAMPLE_INTERVAL`] and emits a `ResourceSample` for each
    /// currently-running service via [`EventSink::emit_resources`]. Never
    /// returns under normal operation — the caller is expected to drive it
    /// from a spawned task scoped to the app's lifetime.
    ///
    /// We can't call `tokio::spawn` from `Supervisor::new()` directly
    /// because Tauri's `setup()` callback runs before the async runtime is
    /// active; the caller (Tauri shell) picks the right runtime to spawn
    /// us on — usually `tauri::async_runtime::spawn`.
    ///
    /// The sysinfo refresh itself runs inside `spawn_blocking` so a slow
    /// /proc walk can't stall the tokio runtime that IPC handlers share.
    /// One refresh per tick covers every service cheaply — a per-service
    /// fan-out would duplicate the process-table walk pointlessly.
    pub async fn run_resource_sampler(self: Arc<Self>) {
        let sampler = Arc::new(ResourceSampler::new());
        let mut interval = tokio::time::interval(RESOURCE_SAMPLE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip the immediate first tick — the sampler primed in `new()`
        // already has one snapshot, but the UI hasn't had a chance to
        // subscribe yet on app start. Waiting one interval also gives
        // sysinfo a small gap between prime and first real measurement,
        // which tightens the CPU% delta it reports.
        interval.tick().await;

        loop {
            interval.tick().await;

            // Collect "service_id -> [root pid, ...]" under the lock, then
            // drop the lock before blocking on sysinfo. Holding `running`
            // during a 100ms refresh would serialize with start/stop which
            // we need to stay snappy.
            let service_pids: HashMap<String, Vec<u32>> = {
                let map = self.running.lock();
                let mut out: HashMap<String, Vec<u32>> = HashMap::new();
                for (key, r) in map.iter() {
                    if let Some(svc_id) = key.split("::").next() {
                        out.entry(svc_id.to_string()).or_default().push(r.pid);
                    }
                }
                out
            };

            if service_pids.is_empty() {
                continue;
            }

            let sampler_clone = sampler.clone();
            let samples = tokio::task::spawn_blocking(move || {
                service_pids
                    .into_iter()
                    .map(|(id, pids)| (id, sampler_clone.sample(&pids)))
                    .collect::<Vec<_>>()
            })
            .await;

            if let Ok(samples) = samples {
                let mut cache = self.last_resources.lock();
                for (id, sample) in samples {
                    self.sink.emit_resources(&id, &sample);
                    cache.insert(id, sample);
                }
            }
        }
    }

    // ---- Service-level operations ------------------------------------------

    pub async fn start_all(&self, svc: ServiceDef) -> AppResult<ServiceStatus> {
        if svc.cmds.is_empty() {
            return Err(AppError::Invalid(format!(
                "service '{}' has no commands",
                svc.name
            )));
        }
        for entry in &svc.cmds {
            let key = process_key(&svc.id, &entry.name);
            if self.running.lock().contains_key(&key) {
                return Err(AppError::AlreadyRunning(format!(
                    "{}:{}",
                    svc.id, entry.name
                )));
            }
        }

        // Mint the run id FIRST — before `start_one` even emits its shell
        // prompt echo. This is the whole point of the server-side run id:
        // every byte the child produces, including the `$ <cmd>` banner
        // pushed at the top of `start_one`, has to be tagged with the
        // same id the lifecycle event will carry, or the UI has to fall
        // back to heuristics.
        let run_id = uuid::Uuid::new_v4().to_string();
        self.run_ids.lock().insert(svc.id.clone(), run_id);

        for entry in &svc.cmds {
            let _ = self.start_one(&svc, entry).await;
        }

        let agg = self.aggregate_status(&svc);
        self.set_status(agg.clone());

        Ok(agg)
    }

    pub async fn start_cmd(&self, svc: ServiceDef, cmd_name: &str) -> AppResult<ServiceStatus> {
        let entry = svc
            .cmds
            .iter()
            .find(|e| e.name == cmd_name)
            .ok_or_else(|| AppError::NotFound(format!("{}:{}", svc.id, cmd_name)))?;

        let key = process_key(&svc.id, cmd_name);
        if self.running.lock().contains_key(&key) {
            return Err(AppError::AlreadyRunning(key));
        }

        // Reuse the existing run id when another command of this service
        // is already in flight (the new command joins the ongoing run);
        // otherwise mint a fresh one. Locking once and using the entry
        // API keeps this atomic — two concurrent start_cmd calls for the
        // same service can't end up minting two different run ids.
        {
            let mut guard = self.run_ids.lock();
            guard
                .entry(svc.id.clone())
                .or_insert_with(|| uuid::Uuid::new_v4().to_string());
        }

        self.start_one(&svc, entry).await?;
        let agg = self.aggregate_status(&svc);
        self.set_status(agg.clone());
        Ok(agg)
    }

    pub fn stop_all(&self, svc_id: &str) -> AppResult<()> {
        let keys: Vec<String> = self
            .running
            .lock()
            .keys()
            .filter(|k| k.starts_with(&format!("{svc_id}::")))
            .cloned()
            .collect();

        for key in keys {
            self.stop_one_internal(&key);
        }
        Ok(())
    }

    pub fn stop_cmd(&self, svc_id: &str, cmd_name: &str) -> AppResult<()> {
        let key = process_key(svc_id, cmd_name);
        if !self.running.lock().contains_key(&key) {
            return Ok(());
        }
        self.stop_one_internal(&key);
        Ok(())
    }

    pub fn service_status(&self, svc: &ServiceDef) -> ServiceStatus {
        self.aggregate_status(svc)
    }

    pub fn is_running(&self, svc_id: &str) -> bool {
        let map = self.running.lock();
        map.keys().any(|k| k.starts_with(&format!("{svc_id}::")))
    }
}
