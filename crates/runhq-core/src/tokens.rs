//! Token counting for the chat composer's "context length" meter.
//!
//! The chat panel ships every send with the full conversation
//! history plus a system prompt; without a counter the user has no
//! way to tell when they're about to exceed their model's window
//! and get a 4xx from the provider mid-stream. Cursor's UI solves
//! the same problem with a `12.4k / 128k` gauge, and we replicate
//! that pattern.
//!
//! Why tiktoken (BPE) and not a char/4 heuristic:
//!
//! - English text *averages* ~4 chars/token, but code, JSON, and
//!   non-Latin scripts swing that range from 2 to 7. A heuristic
//!   that's right on prose is wrong by 2× on a stack trace, and
//!   that's exactly the content RunHQ users paste into chat.
//! - tiktoken's `cl100k_base` matches GPT-3.5/4 exactly, and is a
//!   *very* close upper bound for Anthropic, Gemini, and most
//!   llama.cpp tokenizers — close enough that the user's "am I
//!   about to overflow?" mental model is preserved across providers.
//! - `o200k_base` (used by GPT-4o family) is roughly equivalent for
//!   English but tokenises non-Latin scripts more efficiently. We
//!   pick it over `cl100k_base` because RunHQ ships with Turkish
//!   localisation and many of our users paste Turkish/Arabic prose;
//!   for those a `cl100k_base` count over-estimates by ~30%.
//!
//! On init failure (corrupt embedded BPE table, OOM, anything that
//! makes `o200k_base()` return `Err`) we fall back to a char-based
//! approximation so the UI never has to special-case "counter is
//! offline" — the meter remains best-effort.

use std::sync::OnceLock;
use tiktoken_rs::{o200k_base, CoreBPE};

/// Lazily-initialised global tokeniser. We only build it once per
/// process: o200k init parses the embedded BPE table (~1MB) and
/// builds a HashMap, which costs ~50ms on a hot machine and ~200ms
/// on a cold one. Doing that on every keystroke would be visible.
fn bpe() -> Option<&'static CoreBPE> {
    static BPE: OnceLock<Option<CoreBPE>> = OnceLock::new();
    BPE.get_or_init(|| o200k_base().ok()).as_ref()
}

/// Estimate the token count for a string. Cheap by tiktoken standards
/// (linear in input length, ~1µs per 100 chars on M2) so we can call
/// it on every composer keystroke from the frontend without
/// debouncing. Returns `0` for empty input.
///
/// `count_tokens` is best-effort and never panics — on tokeniser
/// failure we fall back to `chars / 4`, which is a documented
/// industry heuristic that's roughly right for English. Callers
/// that need exact counts should compute server-side after building
/// the final prompt; this is a UI affordance, not a billing oracle.
pub fn count_tokens(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    if let Some(bpe) = bpe() {
        // `encode_with_special_tokens` includes special tokens in
        // the count, but our chat surface doesn't allow the user
        // to type raw `<|endoftext|>` so the special-token branch
        // is functionally equivalent to `encode_ordinary` here.
        // Picking the special-aware variant means future system
        // prompts that legitimately contain control tokens get
        // counted correctly without changing this function.
        return bpe.encode_with_special_tokens(text).len() as u32;
    }
    // Fallback: chars/4 heuristic. We use `chars().count()` rather
    // than `len()` so multi-byte UTF-8 (Turkish, CJK) doesn't get
    // double-counted as bytes. The `+ 3` rounds up so a 1-char
    // string still counts as 1, not 0.
    ((text.chars().count() as u32) + 3) / 4
}

/// Sum the token count across an arbitrary slice of strings. Same
/// semantics as `count_tokens` per element — kept as a separate
/// helper so the IPC layer doesn't have to allocate a single joined
/// `String` on every keystroke; chat history can run to dozens of
/// turns and a re-concatenation each time would dominate the cost.
pub fn count_tokens_many<I, S>(parts: I) -> u32
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    parts.into_iter().map(|s| count_tokens(s.as_ref())).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_is_zero() {
        assert_eq!(count_tokens(""), 0);
    }

    #[test]
    fn short_english_phrase_in_expected_range() {
        // "Hello, world!" is 4 tokens with cl100k and 4 with o200k —
        // we don't pin the exact number because tiktoken-rs may bump
        // the BPE table in a minor release; we just assert it's in
        // a tight range that a heuristic would also satisfy.
        let n = count_tokens("Hello, world!");
        assert!((2..=8).contains(&n), "expected 2..=8, got {n}");
    }

    #[test]
    fn many_aggregates_per_part() {
        let total = count_tokens_many(["foo", "bar", "baz"]);
        let manual = count_tokens("foo") + count_tokens("bar") + count_tokens("baz");
        assert_eq!(total, manual);
    }

    #[test]
    fn unicode_does_not_panic() {
        // Turkish + Arabic + emoji — the failure mode for a naive
        // `len() / 4` heuristic. We assert non-zero count, not the
        // exact value, since BPE table revisions can shift it.
        let n = count_tokens("Merhaba dünya 🌍 مرحبا");
        assert!(n > 0);
    }
}
