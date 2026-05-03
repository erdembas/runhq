/// One slice of a `<think>`-aware split: either reasoning text,
/// answer text, or a marker that everything previously classified
/// as answer was actually reasoning. Strings are owned because the
/// splitter has to hold them across stream chunks anyway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThinkPart {
    Reasoning(String),
    Answer(String),
    /// "Naked close" marker: we saw `</think>` without ever seeing
    /// a matching `<think>`. The caller should treat all content
    /// emitted as `Answer` up to this point as reasoning instead.
    /// Common pattern in reasoning models routed through proxies
    /// that strip the opener (OpenRouter normalisation, certain
    /// vLLM deployments) but pass the closer through unchanged.
    ReclassifyAsReasoning,
}

/// Stateful splitter that consumes streamed `delta.content` strings
/// and yields [`ThinkPart`]s, separating any `<think>...</think>`
/// blocks from the surrounding answer text.
///
/// Why stateful: a single `<think>` open or `</think>` close tag can
/// straddle two streamed chunks (`<thi` then `nk>`), so a naive
/// per-chunk find/replace would leak the angle brackets into the
/// rendered answer. We keep at most a handful of bytes in `pending`
/// to survive that look-ahead while never holding back legitimate
/// content longer than necessary.
#[derive(Debug, Default)]
pub struct ThinkState {
    in_think: bool,
    /// True once we've seen any `<think>` opener (or already fired
    /// the naked-close reclassification). Used to gate the naked
    /// close behaviour so it triggers at most once per stream.
    seen_open: bool,
    /// True once we've fired a SCRATCHPAD-marker reclassification.
    /// Some smaller models ignore the "no internal monologue"
    /// directive and dump their planning into the answer with
    /// headings like `Drafting the Response`, `Internal Monologue`,
    /// or a leading `Final Answer:` line. The first time we spot
    /// one of those markers we reclassify everything before it as
    /// reasoning. We only fire once per stream because the same
    /// phrase can recur naturally inside a long answer (e.g. a
    /// retrospective bullet that quotes the marker), and we don't
    /// want to delete real content the second time around.
    seen_scratchpad: bool,
    /// Buffered tail of the most recent chunk that *might* be the
    /// start of an open/close tag. Flushed downstream once we know
    /// it isn't (or once a tag completes).
    pending: String,
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

mod scratchpad;

use scratchpad::{ends_with_partial_marker_ci, find_scratchpad_marker};

impl ThinkState {
    /// Feed the next streamed content slice and receive zero or more
    /// classified parts. The slice is consumed in order; partial tag
    /// fragments are held in `self.pending` until they either
    /// complete or are disproven.
    pub fn feed(&mut self, chunk: &str) -> Vec<ThinkPart> {
        let mut buf = std::mem::take(&mut self.pending);
        buf.push_str(chunk);
        let mut out: Vec<ThinkPart> = Vec::new();

        loop {
            if self.in_think {
                // Looking for </think>. Emit everything up to (but
                // not including) the close tag as Reasoning.
                if let Some(idx) = buf.find(THINK_CLOSE) {
                    if idx > 0 {
                        out.push(ThinkPart::Reasoning(buf[..idx].to_string()));
                    }
                    buf = buf[idx + THINK_CLOSE.len()..].to_string();
                    self.in_think = false;
                    continue;
                }
                // No close yet — emit what we have, but withhold the
                // last few chars in case they're a partial `</think>`.
                let safe = safe_emit_len(&buf, THINK_CLOSE);
                if safe > 0 {
                    out.push(ThinkPart::Reasoning(buf[..safe].to_string()));
                    buf = buf[safe..].to_string();
                }
                break;
            } else {
                // Scratchpad-marker reclassification (fires once).
                // Some small models ignore the "no monologue" prompt
                // directive and dump their planning into the answer
                // body with headings like `Drafting the Response` or
                // `Final Answer:`. When we spot one we move every
                // emitted-as-answer chunk so far into the reasoning
                // bucket and drop the marker line itself, so the
                // user sees only the actual answer that comes next.
                //
                // We do this BEFORE the <think> tag scan because the
                // marker signals "the answer starts now" — there's
                // no point waiting around for a `<think>` opener that
                // the model is never going to emit.
                if !self.seen_scratchpad {
                    if let Some((m_idx, m_len)) = find_scratchpad_marker(&buf) {
                        let after_marker = &buf[m_idx + m_len..];
                        if let Some(nl_idx) = after_marker.find('\n') {
                            // Full marker line in the buffer. Push
                            // any pre-marker prose as Answer (so the
                            // caller's accumulated answer covers it
                            // before the reclassify fires), signal
                            // reclassify, then skip the entire
                            // marker line — including any trailing
                            // parenthetical the model added (e.g.
                            // `(Internal Monologue/Drafting):`).
                            if m_idx > 0 {
                                out.push(ThinkPart::Answer(buf[..m_idx].to_string()));
                            }
                            out.push(ThinkPart::ReclassifyAsReasoning);
                            buf = buf[m_idx + m_len + nl_idx + 1..].to_string();
                            self.seen_scratchpad = true;
                            // Suppress naked-close: the model has
                            // already given us its "scratchpad ends
                            // here" signal via this marker, and a
                            // later spurious `</think>` should not
                            // wipe out the answer we just rescued.
                            self.seen_open = true;
                            continue;
                        } else {
                            // Marker found but its line is still
                            // streaming. Emit pre-marker prose as
                            // answer (cheap to reclassify later if
                            // needed) and hold the marker fragment
                            // until the newline arrives.
                            if m_idx > 0 {
                                out.push(ThinkPart::Answer(buf[..m_idx].to_string()));
                                buf = buf[m_idx..].to_string();
                            }
                            break;
                        }
                    }
                }
                // Outside a <think> block. Look for whichever of
                // <think> or </think> appears first in this buffer.
                // The </think>-without-opener case is the "naked
                // close" pattern (proxy stripped the opener) — we
                // honour it by retroactively reclassifying.
                let open_idx = buf.find(THINK_OPEN);
                let close_idx = buf.find(THINK_CLOSE);
                let next = match (open_idx, close_idx) {
                    (Some(o), Some(c)) => {
                        if o < c {
                            Some((o, true))
                        } else {
                            Some((c, false))
                        }
                    }
                    (Some(o), None) => Some((o, true)),
                    (None, Some(c)) => Some((c, false)),
                    (None, None) => None,
                };

                if let Some((idx, is_open)) = next {
                    if is_open {
                        // <think> opener: prose before it is answer,
                        // we flip into reasoning for what follows.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        buf = buf[idx + THINK_OPEN.len()..].to_string();
                        self.seen_open = true;
                        self.in_think = true;
                        continue;
                    } else if !self.seen_open {
                        // </think> with no prior <think> — naked
                        // close. Push any pending text as answer
                        // first (so the reclassification covers it
                        // along with everything the caller already
                        // emitted), then signal reclassify, then
                        // resume in answer mode for content after.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        out.push(ThinkPart::ReclassifyAsReasoning);
                        buf = buf[idx + THINK_CLOSE.len()..].to_string();
                        self.seen_open = true;
                        continue;
                    } else {
                        // Stray </think> with the opener already
                        // consumed earlier in the stream. Drop the
                        // tag so it doesn't leak into the answer,
                        // emit surrounding prose as answer.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        buf = buf[idx + THINK_CLOSE.len()..].to_string();
                        continue;
                    }
                }

                // No tag found yet. Hold back any trailing bytes
                // that could be the start of either tag OR a
                // scratchpad marker (`Final Answer:`, `Drafting the
                // Response`, …). Without the marker holdback we'd
                // happily emit "Hello world\nFinal Answ" as answer
                // and only realise it was a marker on the next
                // chunk — too late to suppress the preview flash.
                let mut safe =
                    safe_emit_len(&buf, THINK_OPEN).min(safe_emit_len(&buf, THINK_CLOSE));
                if !self.seen_scratchpad {
                    safe = safe.saturating_sub(ends_with_partial_marker_ci(&buf[..safe]));
                }
                if safe > 0 {
                    out.push(ThinkPart::Answer(buf[..safe].to_string()));
                    buf = buf[safe..].to_string();
                }
                break;
            }
        }

        self.pending = buf;
        out
    }

    /// End-of-stream flush. Emits whatever's left in `pending` as
    /// either reasoning (if we were inside a `<think>` block when the
    /// stream closed) or answer (otherwise). Used to recover when a
    /// model forgets to emit a closing tag.
    pub fn flush(&mut self) -> Option<ThinkPart> {
        let tail = std::mem::take(&mut self.pending);
        if tail.is_empty() {
            return None;
        }
        Some(if self.in_think {
            ThinkPart::Reasoning(tail)
        } else {
            ThinkPart::Answer(tail)
        })
    }
}

/// How many bytes from the start of `buf` are safe to emit without
/// risking that we'd hand off a partial copy of `tag`. The pessimistic
/// answer: hold back up to `tag.len() - 1` trailing bytes that could
/// form a prefix of `tag`. We narrow this with an `ends_with_partial`
/// check so most chunks pass through unbuffered.
pub(super) fn safe_emit_len(buf: &str, tag: &str) -> usize {
    let max_hold = tag.len().saturating_sub(1);
    if buf.len() <= max_hold {
        // The whole buffer might be a partial tag — hold all of it.
        if ends_with_partial(buf, tag) {
            return 0;
        }
        return buf.len();
    }
    // CRITICAL UTF-8 SAFETY: `buf` is model output and may contain
    // multi-byte characters (em-dash, smart quotes, emoji, CJK, etc.).
    // Slicing `&buf[buf.len() - max_hold..]` with a raw byte index
    // panics if that index lands in the middle of a UTF-8 codepoint.
    // We had a real-world panic on the input ` — dep` where max_hold
    // landed inside the em-dash (3 bytes), killing the tokio worker
    // and silently dropping the rest of the stream. Round the split
    // down to the nearest char boundary; this only ever holds back
    // *more* bytes than strictly necessary, never less, so tag-prefix
    // detection stays sound.
    let mut split = buf.len() - max_hold;
    while split > 0 && !buf.is_char_boundary(split) {
        split -= 1;
    }
    let candidate = &buf[split..];
    if ends_with_partial(candidate, tag) {
        split
    } else {
        buf.len()
    }
}

/// True iff `s` ends with a non-empty proper prefix of `tag`. We
/// don't include the full `tag` here on purpose — a fully matched
/// tag is handled by the caller via `find`, so this only triggers
/// in the "could-still-grow-into-a-tag" look-ahead path.
fn ends_with_partial(s: &str, tag: &str) -> bool {
    let max = tag.len().min(s.len());
    for n in (1..=max).rev() {
        if s.ends_with(&tag[..n]) && &tag[..n] != tag {
            return true;
        }
    }
    false
}

/// Locate the end of the next complete SSE event in `buf`.
///
/// Returns `(event_end, separator_len)` such that `buf[..event_end]` is
/// the event payload (without the trailing blank-line separator) and
/// the next `separator_len` bytes are the separator itself. We match
/// both `\n\n` and `\r\n\r\n` because some HTTP intermediaries
/// (proxies, dev gateways) coerce LF to CRLF; missing the CRLF case
/// would silently buffer the entire stream.
pub(super) fn find_event_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let len = buf.len();
    let mut i = 0;
    while i < len {
        if i + 4 <= len && &buf[i..i + 4] == b"\r\n\r\n" {
            return Some((i, 4));
        }
        if i + 2 <= len && &buf[i..i + 2] == b"\n\n" {
            return Some((i, 2));
        }
        i += 1;
    }
    None
}
