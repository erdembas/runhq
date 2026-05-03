use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

pub(super) const FINISH_GRACE: Duration = Duration::from_millis(1500);
pub(crate) const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const STREAM_ACTIVE_IDLE_TIMEOUT: Duration = Duration::from_secs(12);

pub(crate) fn idle_budget(answer_started: bool) -> Duration {
    if answer_started {
        STREAM_ACTIVE_IDLE_TIMEOUT
    } else {
        STREAM_IDLE_TIMEOUT
    }
}

pub(super) enum ReadOutcome {
    Bytes(Option<Vec<u8>>),
    IdleTimedOut,
    FinishGraceExpired,
}

pub(super) async fn read_next_chunk(
    resp: &mut reqwest::Response,
    finish_seen_at: Option<Instant>,
    last_progress_at: Instant,
    answer_started: bool,
    stream_id: &str,
    accumulated_len: usize,
    reasoning_len: usize,
) -> AppResult<ReadOutcome> {
    match finish_seen_at {
        None => {
            read_before_finish(
                resp,
                last_progress_at,
                answer_started,
                stream_id,
                accumulated_len,
                reasoning_len,
            )
            .await
        }
        Some(seen) => read_after_finish(resp, seen, stream_id).await,
    }
}

async fn read_before_finish(
    resp: &mut reqwest::Response,
    last_progress_at: Instant,
    answer_started: bool,
    stream_id: &str,
    accumulated_len: usize,
    reasoning_len: usize,
) -> AppResult<ReadOutcome> {
    let budget = idle_budget(answer_started);
    let elapsed = last_progress_at.elapsed();
    if elapsed >= budget {
        tracing::debug!(
            stream_id = %stream_id,
            budget_ms = budget.as_millis() as u64,
            elapsed_ms = elapsed.as_millis() as u64,
            answer_started,
            body_len = accumulated_len,
            reasoning_len,
            "ai.stream.idle_timeout (entry)",
        );
        return Ok(ReadOutcome::IdleTimedOut);
    }
    let remaining = budget - elapsed;
    match tokio::time::timeout(remaining, resp.chunk()).await {
        Ok(Ok(opt)) => Ok(ReadOutcome::Bytes(opt.map(|b| b.to_vec()))),
        Ok(Err(e)) => {
            tracing::warn!(
                stream_id = %stream_id,
                error = %e,
                "ai.stream.read_error",
            );
            Err(AppError::Other(format!("streaming read failed: {e}")))
        }
        Err(_) => {
            tracing::debug!(
                stream_id = %stream_id,
                remaining_ms = remaining.as_millis() as u64,
                answer_started,
                body_len = accumulated_len,
                reasoning_len,
                "ai.stream.idle_timeout (chunk wait)",
            );
            Ok(ReadOutcome::IdleTimedOut)
        }
    }
}

async fn read_after_finish(
    resp: &mut reqwest::Response,
    seen: Instant,
    stream_id: &str,
) -> AppResult<ReadOutcome> {
    let elapsed = seen.elapsed();
    if elapsed >= FINISH_GRACE {
        tracing::debug!(
            stream_id = %stream_id,
            elapsed_ms = elapsed.as_millis() as u64,
            "ai.stream.finish_grace_expired (entry)",
        );
        return Ok(ReadOutcome::FinishGraceExpired);
    }
    let remaining = FINISH_GRACE - elapsed;
    match tokio::time::timeout(remaining, resp.chunk()).await {
        Ok(Ok(opt)) => Ok(ReadOutcome::Bytes(opt.map(|b| b.to_vec()))),
        Ok(Err(e)) => {
            tracing::warn!(
                stream_id = %stream_id,
                error = %e,
                "ai.stream.read_error (post-finish)",
            );
            Err(AppError::Other(format!("streaming read failed: {e}")))
        }
        Err(_) => {
            tracing::debug!(
                stream_id = %stream_id,
                "ai.stream.finish_grace_expired (chunk wait)",
            );
            Ok(ReadOutcome::FinishGraceExpired)
        }
    }
}
