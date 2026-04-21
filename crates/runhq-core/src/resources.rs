//! Per-service CPU + memory sampling.
//!
//! Wraps [`sysinfo`] behind a narrow API that the supervisor drives on a
//! tick. Shelling out to `ps`/`top` would be simpler but racy across
//! platforms; sysinfo already owns the cross-platform complexity and we
//! already depend on it for port inspection, so it's the right lever.
//!
//! CPU measurement is a **delta** between two refreshes, which means the
//! first refresh after `new()` always reads 0% per process. We prime the
//! system on construction so the first caller-visible sample has a real
//! number instead of a misleading zero.

use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

/// Instantaneous aggregate of a service's process tree.
///
/// - `cpu_percent` is summed across every descendant PID, in the
///   one-core-is-100% convention (a 2-core peg shows as ~200.0). UIs
///   normalise as they see fit.
/// - `memory_bytes` is the sum of each descendant's RSS — approximate for
///   shared pages, but a robust enough signal for "is this service eating
///   my RAM?". sysinfo 0.30+ returns memory in bytes (not KB like older
///   versions).
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct ResourceSample {
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

pub struct ResourceSampler {
    system: Mutex<System>,
}

impl ResourceSampler {
    pub fn new() -> Self {
        let mut system = System::new();
        // Prime the CPU counter. Without this, the very first sample in the
        // supervisor's lifetime always reports 0.0% because sysinfo has no
        // previous snapshot to diff against.
        system.refresh_processes(ProcessesToUpdate::All, true);
        Self {
            system: Mutex::new(system),
        }
    }

    /// Sample the process tree rooted at each pid in `root_pids`. Descendants
    /// are included so a service launched as `sh -lc 'pnpm dev'` reports the
    /// dev server's footprint, not the shell's near-zero stub.
    pub fn sample(&self, root_pids: &[u32]) -> ResourceSample {
        if root_pids.is_empty() {
            return ResourceSample::default();
        }

        let mut system = self.system.lock();
        system.refresh_processes(ProcessesToUpdate::All, true);

        // Build a parent → children adjacency once per tick. Cheaper than
        // walking every process per root when a stack has many services.
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, proc) in system.processes() {
            if let Some(ppid) = proc.parent() {
                children
                    .entry(ppid.as_u32())
                    .or_default()
                    .push(pid.as_u32());
            }
        }

        // BFS from every root. `visited` guards against the pathological
        // case where sysinfo returns a parent cycle (seen on some Linux
        // kernels under heavy fork churn) — we'd otherwise livelock.
        let mut visited: HashSet<u32> = HashSet::new();
        let mut queue: Vec<u32> = root_pids.to_vec();
        while let Some(pid) = queue.pop() {
            if !visited.insert(pid) {
                continue;
            }
            if let Some(kids) = children.get(&pid) {
                queue.extend(kids.iter().copied());
            }
        }

        let mut cpu = 0.0f32;
        let mut mem = 0u64;
        for pid in &visited {
            if let Some(proc) = system.process(sysinfo::Pid::from_u32(*pid)) {
                cpu += proc.cpu_usage();
                mem += proc.memory();
            }
        }

        ResourceSample {
            cpu_percent: cpu,
            memory_bytes: mem,
        }
    }
}

impl Default for ResourceSampler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_roots_returns_zero() {
        let sampler = ResourceSampler::new();
        let s = sampler.sample(&[]);
        assert_eq!(s, ResourceSample::default());
    }

    #[test]
    fn sampling_current_process_has_memory() {
        let sampler = ResourceSampler::new();
        let pid = std::process::id();
        let s = sampler.sample(&[pid]);
        // The test binary itself has to occupy some RSS. CPU% may legitimately
        // be ~0 since the process is mostly idle during the sampler's own
        // refresh, so we only assert on memory — the more stable signal.
        assert!(s.memory_bytes > 0, "expected non-zero RSS for self");
    }
}
