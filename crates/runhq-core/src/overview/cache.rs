use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::license::LicenseScanSummary;

use super::types::{AuditResult, OutdatedResult};

/// Dependency scan results are memoised for this long. Re-running
/// `npm outdated` across 20 projects every time the user toggles a filter
/// is wasteful; five minutes is a reasonable "coffee break" cadence that
/// still reflects recent `npm install`s when the user returns.
const SCAN_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

// ---- Scan cache -----------------------------------------------------------

#[derive(Clone)]
pub(super) struct ScanEntry {
    pub(super) outdated: Option<OutdatedResult>,
    pub(super) audit: Option<AuditResult>,
    /// License summary captured in the same scan pass. Stored
    /// alongside outdated/audit so a single TTL governs all three
    /// channels — diverging TTLs would let the chip show stale
    /// license data while audit looked fresh, which is exactly the
    /// kind of "what does freshness even mean here?" UX we want
    /// to avoid.
    pub(super) license: Option<LicenseScanSummary>,
    pub(super) fetched_at: Instant,
}

#[derive(Clone)]
pub(super) struct ScanCache {
    pub(super) inner: Arc<Mutex<HashMap<PathBuf, ScanEntry>>>,
    // TTL is a field rather than reading the global constant directly so tests
    // can drive expiry with a tiny duration + real sleep. Backdating `Instant`
    // values underflows on fresh Windows CI runners where `Instant::now()` is
    // smaller than `SCAN_CACHE_TTL`, so we avoid that construction entirely.
    pub(super) ttl: Duration,
}

impl ScanCache {
    pub(super) fn global() -> Self {
        use std::sync::OnceLock;
        static GLOBAL: OnceLock<ScanCache> = OnceLock::new();
        GLOBAL
            .get_or_init(|| ScanCache {
                inner: Arc::new(Mutex::new(HashMap::new())),
                ttl: SCAN_CACHE_TTL,
            })
            .clone()
    }

    pub(super) fn get_fresh(&self, cwd: &Path) -> Option<ScanEntry> {
        let guard = self.inner.lock();
        let entry = guard.get(cwd)?;
        if entry.fetched_at.elapsed() < self.ttl {
            Some(entry.clone())
        } else {
            None
        }
    }

    pub(super) fn snapshot(&self) -> HashMap<PathBuf, ScanEntry> {
        let guard = self.inner.lock();
        guard
            .iter()
            .filter(|(_, e)| e.fetched_at.elapsed() < self.ttl)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub(super) fn insert(
        &self,
        cwd: &Path,
        outdated: Option<OutdatedResult>,
        audit: Option<AuditResult>,
        license: Option<LicenseScanSummary>,
    ) {
        self.inner.lock().insert(
            cwd.to_path_buf(),
            ScanEntry {
                outdated,
                audit,
                license,
                fetched_at: Instant::now(),
            },
        );
    }
}
