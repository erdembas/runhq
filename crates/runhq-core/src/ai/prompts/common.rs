/// Char budget for a diff sent to the explainer. Smaller than the
/// commit-message budget because diff explanations don't need every
/// hunk to produce a useful summary; we'd rather drop late hunks than
/// blow past `max_tokens` and lose the response.
pub(in crate::ai) const MAX_EXPLAIN_DIFF_CHARS: usize = 12_000;
/// Char budget for a log-triage payload (focused error window). Logs
/// are line-noisy, so this is intentionally tight.
pub(super) const MAX_LOG_TRIAGE_CHARS: usize = 6_000;
/// Char budget for the rendered advisory list passed to the triage
/// prompt. A scanned monorepo can easily produce 60+ advisories
/// (the user's `belgehub-mobile` had 64 in the canonical screenshot)
/// — at ~120 chars per row that's 7-8K of payload, comfortably
/// inside any modern model's context window. The cap exists so a
/// pathological 500-advisory result doesn't blow the budget for
/// wrapper text + reasoning room. We trim by *severity priority*
/// (critical/high first) when over budget so the model sees the
/// rows that matter most.
pub(super) const MAX_ADVISORY_TRIAGE_CHARS: usize = 9_000;
/// Hard cap on advisories sent to the model regardless of char
/// budget. Keeps the worst-case prompt cost predictable on
/// pay-per-token hosted providers (60 rows * ~120 chars ≈ 7K chars
/// ≈ 1.8K tokens).
pub(super) const MAX_ADVISORY_TRIAGE_ROWS: usize = 60;
/// Char budget for the workspace-analysis JSON facts blob. Each
/// project line is ~250-400 chars (name, runtime, status, CVE
/// counts, outdated counts, git, activity); 12K chars covers a
/// 30-40 project portfolio comfortably. Anything bigger and we
/// trust the frontend to have already trimmed via a "first N
/// projects by risk" pass — see `buildWorkspaceFacts`.
pub(super) const MAX_WORKSPACE_FACTS_CHARS: usize = 12_000;

/// Anti-scratchpad directive shared by every prompt builder.
///
/// Smaller models (3B-class llama3.2 / qwen2.5 / phi-3 / gemma3)
/// routinely ignore abstract instructions like "do not show your
/// reasoning" but reliably imitate concrete examples. So we name the
/// exact phrases they tend to leak (`Drafting the Response`,
/// `Internal Monologue`, `Step 1:`, …) and pair them with a one-line
/// "do this instead" framing. This is the prompt-side belt; the
/// `ThinkState` scratchpad-marker reclassifier is the suspenders that
/// catches what slips through anyway.
pub(super) const NO_SCRATCHPAD_DIRECTIVE: &str = " \
    Output the final answer directly — no preamble, no analysis steps, no scratchpad. \
    Never write headings or bullets named \"Drafting the Response\", \"Drafting the Content\", \
    \"Drafting the Standup\", \"Drafting the Answer\", \"Drafting the Output\", \
    \"Internal Monologue\", \"Inference:\", \"Final Answer:\", \"Step 1:\", \
    \"Reasoning:\", \"Analysis:\", or \"Plan:\". \
    Never enumerate planning steps such as \"1. Reading the input\" or \"2. Identifying the change\". \
    Never narrate what you are about to do — just do it. \
    The very first character of your response must be the start of the actual answer.";

pub(super) fn truncate_with_marker(s: &str, max: usize, marker: &str) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut out = s[..max].to_string();
    out.push_str("\n\n");
    out.push_str(marker);
    out
}
