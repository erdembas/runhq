use crate::state::ServiceDef;

use super::supervisor::Supervisor;
use super::types::{process_key, CommandStatus, ServiceStatus, Status};

impl Supervisor {
    pub(super) fn stop_one_internal(&self, key: &str) {
        let tx = {
            let mut map = self.running.lock();
            map.get_mut(key).and_then(|r| r.stop_tx.take())
        };
        if let Some(tx) = tx {
            let _ = tx.send(());
        }
    }

    // ---- Aggregate status --------------------------------------------------

    pub(super) fn aggregate_status(&self, svc: &ServiceDef) -> ServiceStatus {
        let running_map = self.running.lock();
        let statuses_map = self.statuses.lock();
        let mut commands = Vec::with_capacity(svc.cmds.len());
        for entry in &svc.cmds {
            let key = process_key(&svc.id, &entry.name);
            let is_running = running_map.contains_key(&key);
            let status = if is_running {
                Status::Running
            } else {
                statuses_map
                    .get(&svc.id)
                    .and_then(|s| s.commands.iter().find(|c| c.name == entry.name))
                    .map(|c| c.status)
                    .unwrap_or(Status::Stopped)
            };
            let (pid, started_at_ms) = if is_running {
                let r = running_map.get(&key).unwrap();
                (Some(r.pid), Some(r.started_at_ms))
            } else {
                (None, None)
            };
            commands.push(CommandStatus {
                name: entry.name.clone(),
                status,
                pid,
                started_at_ms,
                exit_code: None,
                error: None,
            });
        }
        drop(running_map);
        drop(statuses_map);

        let agg = Status::aggregate(&commands.iter().map(|c| c.status).collect::<Vec<_>>());
        let primary = commands.first();
        ServiceStatus {
            id: svc.id.clone(),
            status: agg,
            pid: primary.and_then(|c| c.pid),
            started_at_ms: primary.and_then(|c| c.started_at_ms),
            exit_code: None,
            error: None,
            commands,
            // Inline lookup instead of `self.current_run_id` to avoid
            // re-taking the same lock we just released above.
            run_id: self.run_ids.lock().get(&svc.id).cloned(),
        }
    }

    pub(super) fn set_status(&self, status: ServiceStatus) {
        self.statuses
            .lock()
            .insert(status.id.clone(), status.clone());
        self.sink.emit_status(&status);
    }
}
