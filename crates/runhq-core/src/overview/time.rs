use std::time::Instant;

use chrono::Utc;

// ---- Helpers --------------------------------------------------------------

pub(super) fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Approximate the wall-clock millisecond timestamp at which the given
/// `Instant` was captured. We can't recover an exact wall time from a
/// monotonic instant — and we don't need to; the caller only uses this
/// to render "X minutes ago" labels — but we can subtract its
/// `elapsed()` from the current wall clock with low single-digit-ms
/// drift. Saturates at 0 on the off-chance the system clock jumped
/// backward enough to make the subtraction underflow.
pub(super) fn ms_from_instant(inst: Instant) -> i64 {
    let elapsed = inst.elapsed().as_millis() as i64;
    now_ms().saturating_sub(elapsed).max(0)
}
