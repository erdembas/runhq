use std::time::Instant;

use serde_json::Value;

use crate::error::AppResult;

mod request;
mod timeouts;

#[cfg(test)]
pub(crate) use timeouts::{idle_budget, STREAM_ACTIVE_IDLE_TIMEOUT, STREAM_IDLE_TIMEOUT};

use super::provider::AiProvider;
use super::thinking::{find_event_boundary, ThinkPart, ThinkState};
use super::types::{ChatMessage, ChatOptions, ChatResponse, StreamChunk};
use request::open_stream;
use timeouts::{read_next_chunk, ReadOutcome};

/// SSE-aware sibling of [`chat_completion`]. Calls `on_chunk` for every
/// delta as it arrives and emits exactly one `Done` (or `Error`) at the
/// very end. The accumulated content is also returned in [`ChatResponse`]
/// so callers that only care about the final string can ignore the
/// callback and just `await` the future.
///
/// This function deliberately keeps the SSE parser in-house instead of
/// pulling `eventsource-stream`: the whole format is "lines beginning
/// with `data:` separated by blank lines, terminated by `data: [DONE]`",
/// and an extra crate is more surface than a 40-line state machine.
pub async fn chat_completion_stream<F>(
    provider: &AiProvider,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    mut on_chunk: F,
) -> AppResult<ChatResponse>
where
    F: FnMut(StreamChunk) + Send,
{
    let stream_id = uuid::Uuid::new_v4().simple().to_string();
    let stream_id = &stream_id[..8];
    let mut resp = open_stream(provider, messages, options, stream_id, &mut on_chunk).await?;

    let mut buf: Vec<u8> = Vec::new();
    let mut accumulated = String::new();
    let mut accumulated_reasoning = String::new();
    let mut model: Option<String> = None;
    let mut prompt_tokens: Option<u32> = None;
    let mut completion_tokens: Option<u32> = None;
    // Why the model stopped. Captured from the LAST delta that
    // reports a non-null `finish_reason` (OpenAI emits it once,
    // on the final `choices[0]`). We pin it to whatever wins last
    // because some servers ALSO send `finish_reason` on a usage-
    // only chunk after the content is closed — we want that one
    // if it's there.
    let mut finish_reason: Option<String> = None;
    // Stateful splitter for inline `<think>...</think>` blocks: some
    // chunks carry partial tags (`<thi` then `nk>` next), so we have
    // to remember whether we're currently inside a reasoning block
    // and a small look-ahead buffer for partial open/close tags.
    let mut think = ThinkState::default();

    // Once the model emits a non-null `finish_reason`, the answer is
    // conceptually complete. The OpenAI spec says one more chunk
    // (carrying `usage` when `stream_options.include_usage` is set)
    // and then `[DONE]` will follow — within milliseconds. Local
    // servers (LM Studio, some Ollama loads) sometimes emit
    // `finish_reason` and then **never close the stream**, leaving
    // our `resp.chunk().await` blocked until the 5-min top-level
    // timeout fires. The user's UI shows a pulsing caret the whole
    // time — exactly the "bittiğini anlamıyor" symptom they
    // reported. We bound this with a short grace window: after
    // `finish_reason` lands, we give the server up to
    // `FINISH_GRACE` to send anything else (most importantly the
    // usage chunk and `[DONE]`); past that we close the stream
    // ourselves and emit `Done` with whatever we collected. This
    // costs us the post-finish usage chunk on hung servers (which
    // by definition wasn't going to arrive anyway), but never
    // hangs the UI.
    let mut finish_seen_at: Option<Instant> = None;

    // Tracks the last moment we emitted user-visible content. Seeded
    // to `now()` at start so the first IDLE_TIMEOUT window covers
    // model warm-up (cold-start latency on local LM Studio / Ollama
    // can hit 10s+ before the first byte). Updated by the helper
    // closure `mark_progress` defined below.
    let mut last_progress_at = Instant::now();

    // Tracks whether at least one answer-token delta has reached the
    // client. Flips us from `IDLE_TIMEOUT` to the tighter
    // `ACTIVE_IDLE_TIMEOUT` (see constants above) — once tokens are
    // flowing we expect them to keep flowing, so silence is more
    // suspicious. Reasoning-only deltas don't count: a model can
    // legitimately spend 30s+ deep in `<think>` before the first
    // answer token, and we don't want to kill that.
    let mut answer_started = false;
    // Set to `true` if we exit the loop because content progress
    // stalled (no `Delta`/`Reasoning` for the active window).
    // Surfaced through `finish_reason` so the UI can show a clear
    // "stream stalled" banner instead of pretending the model
    // finished happily.
    let mut idle_timed_out = false;

    // Labeled outer loop so we can `break 'outer` from the inner SSE
    // parser the moment we see `[DONE]` instead of looping back to
    // `resp.chunk().await` for one more (always empty) read. That
    // extra read shows up in some servers' logs as "Client
    // disconnected. Stopping generation" — alarming the user even
    // though the run completed cleanly. Breaking immediately keeps
    // the close-handshake one-sided and the logs clean.
    'outer: loop {
        let bytes_opt = match read_next_chunk(
            &mut resp,
            finish_seen_at,
            last_progress_at,
            answer_started,
            stream_id,
            accumulated.len(),
            accumulated_reasoning.len(),
        )
        .await?
        {
            ReadOutcome::Bytes(opt) => opt,
            ReadOutcome::IdleTimedOut => {
                idle_timed_out = true;
                break 'outer;
            }
            ReadOutcome::FinishGraceExpired => break 'outer,
        };
        let bytes = match bytes_opt {
            Some(b) => b,
            // Stream ended cleanly (TCP close) — exit the loop and
            // run the normal flush path below.
            None => {
                tracing::debug!(
                    stream_id = %stream_id,
                    body_len = accumulated.len(),
                    reasoning_len = accumulated_reasoning.len(),
                    finish_reason = ?finish_reason,
                    "ai.stream.tcp_close",
                );
                break 'outer;
            }
        };
        tracing::trace!(
            stream_id = %stream_id,
            byte_count = bytes.len(),
            "ai.stream.bytes",
        );
        buf.extend_from_slice(&bytes);

        while let Some((event_end, sep_len)) = find_event_boundary(&buf) {
            let event_bytes: Vec<u8> = buf.drain(..event_end).collect();
            buf.drain(..sep_len);

            let event = match std::str::from_utf8(&event_bytes) {
                Ok(s) => s,
                Err(_) => continue, // skip malformed chunk rather than tearing down the stream
            };

            // An SSE event is one or more `data:` lines (concatenated
            // by the spec) plus comment lines starting with `:`. We
            // accept either format and stitch multi-line `data:`
            // payloads back together with `\n` separators.
            let mut data = String::new();
            for line in event.lines() {
                if line.starts_with(':') || line.is_empty() {
                    continue;
                }
                if let Some(rest) = line.strip_prefix("data:") {
                    let v = rest.strip_prefix(' ').unwrap_or(rest);
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(v);
                }
            }
            if data.is_empty() {
                continue;
            }
            if data.trim() == "[DONE]" {
                tracing::debug!(
                    stream_id = %stream_id,
                    body_len = accumulated.len(),
                    reasoning_len = accumulated_reasoning.len(),
                    finish_reason = ?finish_reason,
                    "ai.stream.done_marker",
                );
                break 'outer;
            }
            let parsed: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(e) => {
                    tracing::trace!(
                        stream_id = %stream_id,
                        error = %e,
                        sample = %data.chars().take(120).collect::<String>(),
                        "ai.stream.parse_skip",
                    );
                    continue;
                }
            };

            // OpenAI compatibility note: a single chunk can include
            // both a `delta.content` token AND the final `usage`
            // block (when `include_usage: true`). We don't `continue`
            // after extracting one — both fields below are independent
            // best-effort reads.
            let delta = parsed
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("delta"));

            // Reasoning emitted on a separate field, the well-behaved
            // path. DeepSeek and GLM use `reasoning_content`; OpenAI
            // o-series and OpenRouter's normalised stream use
            // `reasoning`. We accept either.
            for key in ["reasoning_content", "reasoning"] {
                if let Some(r) = delta.and_then(|d| d.get(key)).and_then(|c| c.as_str()) {
                    if !r.is_empty() {
                        accumulated_reasoning.push_str(r);
                        // Reasoning is genuine forward progress —
                        // refresh the idle timer so a long `<think>`
                        // phase doesn't get killed by the pre-answer
                        // window.
                        last_progress_at = Instant::now();
                        on_chunk(StreamChunk::Reasoning {
                            text: r.to_string(),
                        });
                    }
                }
            }

            if let Some(content) = delta
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
            {
                if !content.is_empty() {
                    // Split the chunk into reasoning vs. answer based
                    // on `<think>...</think>` markers. For models that
                    // don't use `<think>` this is a pass-through
                    // (everything ends up as `Delta`). Stateful: tags
                    // can split across chunks.
                    let parts = think.feed(content);
                    for part in parts {
                        match part {
                            ThinkPart::Reasoning(s) if !s.is_empty() => {
                                accumulated_reasoning.push_str(&s);
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::Reasoning { text: s });
                            }
                            ThinkPart::Answer(s) if !s.is_empty() => {
                                accumulated.push_str(&s);
                                answer_started = true;
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::Delta { text: s });
                            }
                            ThinkPart::ReclassifyAsReasoning => {
                                // Move everything we've emitted as
                                // an answer so far into the
                                // reasoning bucket. Frontend mirrors
                                // this exact transformation. Counts
                                // as progress: the model is mutating
                                // its previous output, which is
                                // forward motion even if no new
                                // tokens were produced this iteration.
                                accumulated_reasoning.push_str(&accumulated);
                                accumulated.clear();
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::ReclassifyAsReasoning);
                            }
                            _ => {}
                        }
                    }
                }
            }

            if model.is_none() {
                if let Some(m) = parsed.get("model").and_then(|m| m.as_str()) {
                    model = Some(m.to_string());
                }
            }
            // `finish_reason` lives on `choices[0]` (NOT inside
            // `delta`). It's `null` on every chunk except the final
            // one. We keep the most recent non-null value, since
            // some providers re-emit it on a trailing usage chunk.
            //
            // The first non-null `finish_reason` also arms the
            // grace timer that bounds how long we'll wait for the
            // post-finish `usage` + `[DONE]` chunks. Without this,
            // a hung-but-finished local server would leave us
            // blocked on the next `resp.chunk()` call indefinitely.
            if let Some(fr) = parsed
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("finish_reason"))
                .and_then(|v| v.as_str())
            {
                if !fr.is_empty() {
                    let was_seen = finish_seen_at.is_some();
                    finish_reason = Some(fr.to_string());
                    if !was_seen {
                        finish_seen_at = Some(Instant::now());
                        tracing::debug!(
                            stream_id = %stream_id,
                            finish_reason = %fr,
                            body_len = accumulated.len(),
                            reasoning_len = accumulated_reasoning.len(),
                            "ai.stream.finish_reason_seen",
                        );
                    }
                }
            }
            if let Some(usage) = parsed.get("usage") {
                if let Some(p) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                    prompt_tokens = Some(p as u32);
                }
                if let Some(c) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                    completion_tokens = Some(c as u32);
                }
            }
        }
    }

    // Flush any leftover characters held in the `<think>` look-ahead
    // buffer. This handles the rare case where a model closes the
    // stream without emitting `</think>` — we still surface what we
    // captured so the UI doesn't silently lose tokens.
    if let Some(tail) = think.flush() {
        match tail {
            ThinkPart::Reasoning(s) if !s.is_empty() => {
                accumulated_reasoning.push_str(&s);
                on_chunk(StreamChunk::Reasoning { text: s });
            }
            ThinkPart::Answer(s) if !s.is_empty() => {
                accumulated.push_str(&s);
                on_chunk(StreamChunk::Delta { text: s });
            }
            // Flush should never produce Reclassify (it's emitted
            // mid-stream when </think> is seen), but cover it for
            // exhaustiveness.
            ThinkPart::ReclassifyAsReasoning => {
                accumulated_reasoning.push_str(&accumulated);
                accumulated.clear();
                on_chunk(StreamChunk::ReclassifyAsReasoning);
            }
            _ => {}
        }
    }

    let reasoning_summary = if accumulated_reasoning.is_empty() {
        None
    } else {
        Some(accumulated_reasoning.clone())
    };
    // If we bailed via the idle-timeout escape hatch and the server
    // never sent its own `finish_reason`, synthesise one. This is
    // the signal that drives the UI's "stream stalled" affordance —
    // distinct from a clean `"stop"` so the user knows whether to
    // re-prompt vs. trust the partial answer.
    let effective_finish_reason = match finish_reason.clone() {
        Some(fr) => Some(fr),
        None if idle_timed_out => Some("timeout".to_string()),
        None => None,
    };
    tracing::debug!(
        stream_id = %stream_id,
        finish_reason = ?effective_finish_reason,
        body_len = accumulated.len(),
        reasoning_len = accumulated_reasoning.len(),
        prompt_tokens = ?prompt_tokens,
        completion_tokens = ?completion_tokens,
        idle_timed_out,
        "ai.stream.end",
    );
    on_chunk(StreamChunk::Done {
        content: accumulated.clone(),
        reasoning: reasoning_summary,
        model: model.clone(),
        prompt_tokens,
        completion_tokens,
        finish_reason: effective_finish_reason,
    });

    Ok(ChatResponse {
        content: accumulated,
        model,
        prompt_tokens,
        completion_tokens,
    })
}
