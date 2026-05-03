/// Phrases that strongly signal the model is still in scratchpad
/// mode and is about to (or did) emit the actual answer below.
/// Matched case-insensitively. Each entry is rare enough in genuine
/// engineering prose that hitting one is overwhelming evidence the
/// prefix above it was the model thinking out loud.
///
/// We deliberately list "drafting the …" with several object words
/// rather than relying on a single canonical phrase: small models
/// freely substitute the noun (`Response` → `Content` / `Standup` /
/// `Answer` / `Explanation` / `Output`) while keeping the same
/// scratchpad template. Any one of these variants triggers the same
/// reclassification, so the user sees the same clean answer flow no
/// matter which noun the model picked today.
const SCRATCHPAD_MARKERS: &[&str] = &[
    // "Drafting the …" family — most common scratchpad-end heading
    // emitted by 3B-class instruct models walking through a plan.
    "drafting the response",
    "drafting the content",
    "drafting the answer",
    "drafting the standup",
    "drafting the explanation",
    "drafting the triage",
    "drafting the output",
    "drafting the message",
    "drafting the reply",
    "drafting response",
    // Bare "Drafting:" / explicit monologue label.
    "drafting:",
    "internal monologue",
    // Explicit "this is the final answer" labels — rare in good
    // prose, common as a scratchpad-to-answer hinge.
    "final answer:",
    "**final answer:**",
    "**final answer**",
];

/// Locate the earliest scratchpad marker in `buf` (case-insensitive).
/// Returns the byte offset and length of the matched marker in the
/// ORIGINAL casing, since we slice back into `buf` with that offset.
pub(super) fn find_scratchpad_marker(buf: &str) -> Option<(usize, usize)> {
    // Lowercase the buffer once, but track byte offsets that map back
    // 1:1 to the original because `to_lowercase()` can change byte
    // lengths for non-ASCII chars. The markers are pure ASCII, so we
    // cheat: do an ASCII-lower compare per byte instead of allocating.
    // This keeps offsets identical between the search view and `buf`.
    let bytes = buf.as_bytes();
    let mut best: Option<(usize, usize)> = None;
    for marker in SCRATCHPAD_MARKERS {
        let m = marker.as_bytes();
        if m.len() > bytes.len() {
            continue;
        }
        for i in 0..=bytes.len() - m.len() {
            let mut hit = true;
            for j in 0..m.len() {
                if bytes[i + j].to_ascii_lowercase() != m[j] {
                    hit = false;
                    break;
                }
            }
            if hit {
                if best.map_or(true, |(b, _)| i < b) {
                    best = Some((i, m.len()));
                }
                break;
            }
        }
    }
    best
}

/// Number of trailing bytes in `s` that could be the leading prefix
/// of any [`SCRATCHPAD_MARKERS`] entry (case-insensitive). Returns 0
/// when no partial match is found, otherwise the longest matching
/// prefix length so the caller can hold back exactly those bytes.
///
/// We *require* the partial match to start at a word boundary — the
/// byte before the candidate must be ASCII whitespace, or the
/// candidate must be at the start of the buffer. Without this rule,
/// a buffer ending in "world" would match the 1-byte prefix "d" of
/// "drafting…" and we'd hold a byte back on every chunk forever,
/// breaking streaming. Real-world scratchpad markers always sit at
/// line start in model output, so the boundary check has no false
/// negatives in practice.
///
/// ASCII-only markers, so we lower per-byte without allocating.
pub(super) fn ends_with_partial_marker_ci(s: &str) -> usize {
    if s.is_empty() {
        return 0;
    }
    let bytes = s.as_bytes();
    let mut max_hold = 0usize;
    for marker in SCRATCHPAD_MARKERS {
        let m = marker.as_bytes();
        // Cap the partial length at marker.len() - 1 — a full match
        // is the find_scratchpad_marker job, not the holdback path.
        let limit = m.len().saturating_sub(1).min(bytes.len());
        for n in (1..=limit).rev() {
            let tail_start = bytes.len() - n;
            // Word-boundary gate: candidate must begin at start of
            // buffer or immediately after whitespace.
            if tail_start > 0 && !bytes[tail_start - 1].is_ascii_whitespace() {
                continue;
            }
            let tail = &bytes[tail_start..];
            let mut hit = true;
            for j in 0..n {
                if tail[j].to_ascii_lowercase() != m[j] {
                    hit = false;
                    break;
                }
            }
            if hit {
                if n > max_hold {
                    max_hold = n;
                }
                break;
            }
        }
    }
    max_hold
}
