use super::*;

#[test]
fn safe_emit_len_handles_multibyte_boundary() {
    // Regression: a real-world panic happened on input containing
    // an em-dash (3 bytes UTF-8). With THINK_CLOSE = "</think>"
    // (8 bytes), max_hold = 7, and `buf.len() - 7` landed inside
    // the em-dash, killing the tokio worker mid-stream.
    let buf = "the runner package — dep";
    let safe = safe_emit_len(buf, "</think>");
    // Must not panic. Result must be a valid char boundary.
    assert!(buf.is_char_boundary(safe));
    // We don't end with "</think>" prefix bytes here, so the
    // function should green-light emitting the whole buffer.
    assert_eq!(safe, buf.len());
}

#[test]
fn safe_emit_len_holds_back_partial_tag_with_emoji_prefix() {
    // Another mixed-unicode case: emoji (4 bytes) followed by an
    // ascii prefix that *could* grow into "</think>". Make sure
    // the holdback boundary still lands on a char boundary and
    // doesn't slice through the emoji.
    let buf = "hello 🚀 </t";
    let safe = safe_emit_len(buf, "</think>");
    assert!(buf.is_char_boundary(safe));
    // "</t" is a real prefix of "</think>" — must hold it back.
    assert!(safe < buf.len());
}

#[test]
fn chat_url_normalises_trailing_slash() {
    let p = AiProvider {
        id: "x".into(),
        name: "x".into(),
        kind: AiProviderKind::Openai,
        base_url: "https://api.openai.com/v1/".into(),
        api_key: "k".into(),
        model: "gpt-4o-mini".into(),
        default: false,
        response_language: None,
        commit_language: None,
        max_output_tokens: None,
        context_window: None,
        created_at_ms: 0,
    };
    assert_eq!(p.chat_url(), "https://api.openai.com/v1/chat/completions");
}

#[test]
fn strip_handles_code_fence_and_preamble() {
    let raw = "Here's the commit message:\n```\nfeat(auth): add OAuth login\n\nIntroduces the OAuth handler.\n```";
    let cleaned = strip_message_artifacts(raw);
    assert!(cleaned.starts_with("feat(auth): add OAuth login"));
    assert!(!cleaned.contains("```"));
}

#[test]
fn strip_extracts_commit_tag_when_present() {
    // Happy path: model honours the sentinel tag contract. We
    // ignore EVERYTHING outside the tags, including any preamble
    // or trailing commentary that violates "output only the
    // commit message".
    let raw = "Sure! Here's a draft.\n\n<commit>feat: add favorite toggle</commit>\n\nLet me know if you want changes.";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat: add favorite toggle");
}

#[test]
fn strip_extracts_last_commit_tag_when_drafting() {
    // Reasoning models often "draft" inside placeholder tags
    // before committing. We MUST take the last one — the earlier
    // ones are abandoned drafts, not final answers.
    let raw = "<commit>draft 1: too long</commit>\nactually shorter:\n<commit>fix: trim leading whitespace</commit>";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "fix: trim leading whitespace");
}

#[test]
fn strip_extracts_multiline_commit_body() {
    // Body lines (and their leading whitespace) flow through verbatim.
    let raw = "<commit>feat(api): add pagination cursor\n\nReplaces the offset-based scheme so deletes mid-scroll\nno longer skip rows.</commit>";
    let cleaned = strip_message_artifacts(raw);
    assert!(cleaned.starts_with("feat(api): add pagination cursor"));
    assert!(cleaned.contains("Replaces the offset-based scheme"));
    assert!(cleaned.ends_with("skip rows."));
}

#[test]
fn strip_glm_style_reasoning_leak_via_tags() {
    // Real-world GLM-4.7-Flash output: pages of numbered
    // chain-of-thought analysis that violate the "no reasoning"
    // instruction. With sentinel tags in the system prompt the
    // model still rambles, but at least wraps the final answer.
    let raw = "1. **Analyze the Request:**\n   * **Output:** ONLY the commit message itself.\n\
            2. **Analyze the Staged Diff:** Adds a favorite feature.\n\
            3. **Determine the Prefix:** feat.\n\
            4. **Draft:** Favori özelliklerini ekle.\n\n\
            <commit>feat: ürünlere favori durumu ekle</commit>";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat: ürünlere favori durumu ekle");
}

#[test]
fn strip_falls_back_to_legacy_when_tags_absent() {
    // Older / smaller models may ignore the tag contract entirely
    // but still emit a clean, bare message. Layer-2 heuristics
    // must keep working for them.
    let raw = "feat: add cache invalidation";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat: add cache invalidation");
}

#[test]
fn strip_removes_think_blocks_when_no_commit_tags() {
    // Qwen-QwQ / R1 distill served behind a stripped-reasoning
    // proxy: chain-of-thought leaks into `delta.content` as
    // `<think>…</think>`, the answer follows in plain text, and
    // there are no sentinel commit tags. The legacy fallback
    // must scrub the think block before returning.
    let raw = "<think>Let me analyze the diff...\nThis adds a new endpoint.</think>\nfeat(api): add /healthz endpoint";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat(api): add /healthz endpoint");
    assert!(!cleaned.contains("<think>"));
    assert!(!cleaned.contains("Let me analyze"));
}

#[test]
fn strip_drops_unclosed_think_tail() {
    // Defensive: model started thinking and got cut off (max_tokens,
    // network blip, etc). Better to lose the tail than surface a
    // half-thought in the textarea. Empty string is OK here — the
    // UI's "stage changes, then generate" guard handles the
    // empty-result case downstream.
    let raw = "<think>I should consider three angles...";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "");
}

#[test]
fn strip_handles_multiple_think_blocks() {
    let raw = "<think>plan</think>feat: foo<think>second thoughts</think>";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat: foo");
}

#[test]
fn strip_preserves_non_ascii_inside_commit_tags() {
    // Turkish, Japanese, and other multi-byte content inside the
    // commit tags must come through byte-for-byte. The extractor
    // walks ASCII tag positions only — never lowercases the whole
    // body — to avoid breaking char boundaries.
    let raw = "<commit>feat: kullanıcı şifresini sıfırla — 部分対応</commit>";
    let cleaned = strip_message_artifacts(raw);
    assert_eq!(cleaned, "feat: kullanıcı şifresini sıfırla — 部分対応");
}

#[test]
fn truncate_keeps_under_limit() {
    let big = "a".repeat(MAX_DIFF_CHARS * 2);
    let t = truncate_for_prompt(&big);
    assert!(t.len() <= MAX_DIFF_CHARS + 200);
    assert!(t.contains("[diff truncated"));
}

#[test]
fn build_prompt_includes_branch_and_recents() {
    let msgs = build_commit_prompt(
        "diff --git a/x b/x\n+hello",
        Some("feat/oauth"),
        &["fix: bug".into()],
        Some("OAuth login"),
    );
    assert_eq!(msgs.len(), 2);
    assert!(msgs[1].content.contains("feat/oauth"));
    assert!(msgs[1].content.contains("fix: bug"));
    assert!(msgs[1].content.contains("OAuth login"));
}

#[test]
fn find_event_boundary_handles_lf_and_crlf() {
    let lf = b"data: {\"a\":1}\n\nrest";
    assert_eq!(find_event_boundary(lf), Some((13, 2)));

    let crlf = b"data: {\"a\":1}\r\n\r\nrest";
    assert_eq!(find_event_boundary(crlf), Some((13, 4)));

    // Incomplete buffer — separator hasn't arrived yet.
    let partial = b"data: {\"a\":1}\n";
    assert_eq!(find_event_boundary(partial), None);
}

/// Covers the policy split that drives stream stall detection.
/// Pre-answer windows MUST be longer than post-answer ones, and
/// the constants MUST satisfy `ACTIVE < IDLE`. If a future
/// refactor breaks this ordering it would silently make stalls
/// either un-detectable (post-answer too lenient) or kill
/// healthy reasoning streams (pre-answer too tight) — exactly
/// the regression that motivated the constants in the first
/// place. The test pins the contract.
#[test]
fn idle_budget_is_tighter_after_answer_starts() {
    let pre = idle_budget(false);
    let post = idle_budget(true);
    assert!(post < pre, "post-answer window must be tighter");
    assert_eq!(pre, STREAM_IDLE_TIMEOUT);
    assert_eq!(post, STREAM_ACTIVE_IDLE_TIMEOUT);
    // Sanity floor: even the tight post-answer window has to
    // tolerate a healthy network blip / TLS retransmit. Anything
    // less than 5s is too aggressive for real-world conditions.
    assert!(post >= Duration::from_secs(5));
}

/// Sanity-check the budget math we do at the call site:
/// `remaining = budget - elapsed_since_progress`. When elapsed
/// has already exceeded the budget we want a stall declaration
/// (the call site short-circuits without invoking `chunk()`),
/// modelled here as `checked_sub` returning `None`.
#[test]
fn idle_budget_short_circuits_when_progress_is_stale() {
    let budget = idle_budget(true);
    let stale = budget + Duration::from_secs(1);
    assert!(budget.checked_sub(stale).is_none());

    let fresh = Duration::from_millis(100);
    let remaining = budget.checked_sub(fresh).expect("fresh progress");
    assert!(remaining > Duration::from_secs(10));
}
