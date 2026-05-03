use crate::error::{AppError, AppResult};

use super::super::{apply_language_to_vec, chat_completion, AiProvider, ChatMessage, ChatOptions};

// ---------------------------------------------------------------------------
// Commit message generation
// ---------------------------------------------------------------------------

/// Maximum diff payload we'll send to the LLM. Big monorepo commits can
/// blow past 100k tokens easily; truncating here keeps cost predictable
/// AND avoids 400 "context too long" errors that'd otherwise look like
/// a RunHQ bug. We truncate from the END since the diff header (file
/// list) is the most informative chunk when context is scarce.
pub(in crate::ai) const MAX_DIFF_CHARS: usize = 16_000;

pub(in crate::ai) fn truncate_for_prompt(diff: &str) -> String {
    if diff.len() <= MAX_DIFF_CHARS {
        return diff.to_string();
    }
    let mut s = diff[..MAX_DIFF_CHARS].to_string();
    s.push_str(
        "\n\n[diff truncated by RunHQ — only the first chunk was sent to keep the prompt small]",
    );
    s
}

/// Build the conventional-commits-aware prompt. Recent commit subjects
/// are passed in so the AI mimics the project's existing tone (e.g. if
/// the repo is on emoji prefixes or `[scope]` style, the model copies
/// that voice instead of inventing something new).
pub fn build_commit_prompt(
    diff: &str,
    branch: Option<&str>,
    recent_commits: &[String],
    user_hint: Option<&str>,
) -> Vec<ChatMessage> {
    // The system message is the heart of the feature: it pins
    // Conventional Commits style, gives a length budget, and — critically
    // for reasoning models — tells the model to wrap the FINAL message in
    // explicit sentinel tags. Earlier versions of this prompt asked the
    // model to "output only the commit message" which works for
    // instruction-tuned chat models but fails spectacularly for reasoning
    // models (DeepSeek-R1, GLM-4.x, Qwen-QwQ, OpenAI o-series): they
    // ignore "no reasoning" instructions and dump pages of numbered
    // analysis ("1. Analyze the request… 2. Determine the prefix…
    // 3. Draft the first line…") straight into `delta.content`. The
    // user then sees that monologue in their commit textarea.
    //
    // Sentinel tags fix this at the contract level: we don't ask the
    // model to suppress reasoning, we just ask it to MARK where the
    // final answer is. Reasoning model habits stay intact (they get to
    // think aloud), the post-processor extracts only what's between the
    // tags, and `strip_message_artifacts` falls back to the legacy
    // heuristics if the model forgets the tags entirely.
    let system = "You are an expert software engineer that writes excellent git commit messages. \
                  \n\nOUTPUT CONTRACT (read carefully):\n\
                  - Wrap your FINAL commit message between <commit> and </commit> tags.\n\
                  - The text BETWEEN those tags is what will be inserted into the user's textarea verbatim — no further processing.\n\
                  - You may think, plan, or list options BEFORE the opening <commit> tag; everything outside the tags is ignored.\n\
                  - Inside the tags, output the message ONLY — no quotes, no code fences, no preamble, no commentary.\n\
                  \n\nMESSAGE STYLE:\n\
                  - First line imperative, 50 characters or fewer, with no trailing period.\n\
                  - Use a Conventional Commits prefix when one fits (feat, fix, chore, docs, refactor, test, perf, build, ci, style).\n\
                  - If the change set spans several unrelated areas, pick the dominant one.\n\
                  - When there is enough context for a meaningful body, add a blank line and a short body explaining the WHY, wrapped at 72 characters and at most four lines.\n\
                  - Never invent issue numbers, co-authors, or files that aren't in the diff.\n\
                  - Match the tone and prefix style of the recent commits when they look intentional.\n\
                  \n\nEXAMPLE (illustrative; do NOT copy this content):\n\
                  <commit>feat(auth): add OAuth login flow\n\n\
                  Wires the new identity provider into the existing session\n\
                  bootstrapper so existing users keep their tokens.</commit>";

    let mut user = String::new();
    if let Some(b) = branch {
        if !b.is_empty() {
            user.push_str(&format!("Current branch: {b}\n"));
        }
    }
    if !recent_commits.is_empty() {
        user.push_str("Recent commits on this repo (for tone matching, not for content):\n");
        for line in recent_commits.iter().take(8) {
            user.push_str(&format!("- {line}\n"));
        }
        user.push('\n');
    }
    if let Some(hint) = user_hint {
        let h = hint.trim();
        if !h.is_empty() {
            user.push_str(&format!("Author hint about this change: {h}\n\n"));
        }
    }
    user.push_str("Staged diff:\n```diff\n");
    user.push_str(&truncate_for_prompt(diff));
    user.push_str("\n```\n\nWrite the commit message now.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// One-shot helper that builds the prompt and dispatches the chat
/// completion. Returns the trimmed message body suitable for direct
/// insertion into a commit textarea.
pub async fn generate_commit_message(
    provider: &AiProvider,
    diff: &str,
    branch: Option<&str>,
    recent_commits: &[String],
    user_hint: Option<&str>,
) -> AppResult<String> {
    if diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "There are no staged changes to summarize. Stage something first.".into(),
        ));
    }
    let mut messages = build_commit_prompt(diff, branch, recent_commits, user_hint);
    // Use the commit-specific language setting, which falls back to
    // the general response language when unset. This lets a user
    // keep chat in Turkish while writing commits in English (the
    // common open-source convention) — or vice versa — without one
    // setting hijacking the other.
    if let Some(directive) = provider.commit_language_directive() {
        apply_language_to_vec(&mut messages, &directive);
    }
    let resp = chat_completion(
        provider,
        messages,
        ChatOptions {
            // Low-but-not-zero temperature: we want a deterministic
            // first-shot message, but a touch of variation helps when
            // the user hits "Generate" again wanting a different angle.
            temperature: Some(0.2),
            max_tokens: Some(400),
        },
    )
    .await?;

    Ok(strip_message_artifacts(&resp.content))
}

/// Some models politely wrap their answer in triple backticks or
/// "Here's the commit message:" preamble despite the system prompt
/// telling them not to. We strip the most common offenders so the
/// textarea never inherits junk.
/// Extract the final commit message from the model's raw output.
///
/// Two layers of defence, in this order:
///
/// 1. **Sentinel tags** (`<commit>...</commit>`). Our system prompt
///    tells the model to wrap the final message in these tags. When
///    the model complies, this branch wins immediately and everything
///    outside is dropped — including pages of reasoning monologue
///    that GLM-4.x / DeepSeek-R1 / QwQ / o-series like to emit. We
///    accept the LAST `<commit>...</commit>` block in the output, on
///    the off chance a reasoning model "drafts" inside placeholder
///    tags before settling on its final answer.
///
/// 2. **Legacy heuristics** (no tags found). Fall back to stripping
///    `<think>...</think>` chain-of-thought blocks, "Here's the
///    commit message:" preambles, and code fences. This keeps the
///    feature working with non-reasoning models that don't honour
///    the tag contract — a small instruction-tuned local model might
///    just emit the bare message — and with reasoning models that
///    forget to close the tag.
///
/// Implemented without a regex dependency: `find` + `rfind` on byte
/// offsets is plenty for these short, predictable patterns. The
/// alternative — pulling in `regex` for two patterns — would bloat
/// the runhq-core crate's dep graph for no expressivity gain.
pub(in crate::ai) fn strip_message_artifacts(raw: &str) -> String {
    // Layer 1: sentinel-tag extraction. The model was prompted to
    // wrap its final answer in `<commit>…</commit>`, so when we see
    // the closing tag we trust the contract: take the last block
    // (handles "draft 1 / draft 2 / final" patterns) and ignore
    // everything else, no matter how long the preamble.
    if let Some(extracted) = extract_last_commit_tag(raw) {
        return extracted.trim().to_string();
    }

    // Layer 2: defensive cleanup for outputs without sentinel tags.
    // This branch handles two failure modes simultaneously:
    //   (a) the model didn't follow the tag contract (older models,
    //       small local models) but at least kept the output clean;
    //   (b) the model emitted `<think>…</think>` reasoning ahead of
    //       a bare answer (Qwen QwQ, R1 distills behind proxies that
    //       strip explicit reasoning channels and pass `<think>` tags
    //       through plain `content`).
    let mut s = strip_think_blocks(raw.trim());

    // Iterate twice: a model can wrap the answer as
    //     "Here's the commit message:\n```\n…\n```"
    // — preamble + fence — so a single pass over either direction
    // leaves the other still attached. Two passes is enough; we don't
    // expect more nesting than that in practice.
    for _ in 0..2 {
        s = s.trim().to_string();

        let lowered = s.to_ascii_lowercase();
        for prefix in [
            "here's the commit message:",
            "here is the commit message:",
            "commit message:",
            "commit:",
        ] {
            if lowered.starts_with(prefix) {
                s = s[prefix.len()..].to_string();
                break;
            }
        }

        s = s.trim().to_string();

        // Drop a leading code fence (```text, ```diff, plain ```).
        if let Some(rest) = s.strip_prefix("```") {
            if let Some(idx) = rest.find('\n') {
                s = rest[idx + 1..].to_string();
            }
        }
        // Drop a trailing code fence.
        if s.trim_end().ends_with("```") {
            let trimmed = s.trim_end();
            s = trimmed[..trimmed.len() - 3].to_string();
        }
    }
    s.trim().to_string()
}

/// Return the contents of the LAST `<commit>...</commit>` block in
/// `raw`, or `None` if there isn't a complete one. Case-insensitive on
/// the tag itself; preserves the inner text byte-for-byte.
///
/// Why "last" instead of "first": reasoning models routinely produce
/// drafts inside placeholder tags before committing to a final answer
/// ("Draft 1: <commit>X</commit>... actually let me reconsider...
/// <commit>Y</commit>"). Taking the last hit means we get the model's
/// considered answer rather than its first guess.
fn extract_last_commit_tag(raw: &str) -> Option<&str> {
    // Manual case-insensitive search via lowercase-mirror lookup. We
    // don't lowercase the WHOLE string then slice — that would diverge
    // byte indices for non-ASCII content (the message body itself can
    // contain Turkish/CJK/diacritics), and we need the original bytes
    // back for the slice. Instead lowercase only enough to find tag
    // positions, then slice the original.
    let lowered = raw.to_ascii_lowercase();
    let close_idx = lowered.rfind("</commit>")?;
    // Find the OPENING tag that pairs with this closer — the last
    // `<commit>` strictly before `close_idx`. `rfind` over a slice
    // of `lowered` gives us the right offset directly (slices are
    // ASCII for these tag names so byte indices are stable).
    let prefix = &lowered[..close_idx];
    let open_idx = prefix.rfind("<commit>")?;
    let content_start = open_idx + "<commit>".len();
    Some(&raw[content_start..close_idx])
}

/// Remove every `<think>...</think>` block from the input. Multiline,
/// non-greedy, case-insensitive on the tag.
///
/// Reasoning models distributed via OpenAI-compatible APIs sometimes
/// emit their chain-of-thought inline as `<think>…</think>` instead of
/// (or in addition to) a separate `reasoning_content` channel. If the
/// model also forgot to wrap its final answer in `<commit>` tags, that
/// `<think>` block lands in our textarea — exactly the bug this
/// helper exists to prevent.
///
/// We loop because nothing structurally forbids two siblings: a model
/// could produce `<think>plan</think>here's the answer<think>second
/// thoughts</think>final`. One pass per block. A 32-iteration cap
/// guards against pathological infinite loops if either tag ever
/// matches itself (it can't, given the literal contents — but defence
/// in depth is cheaper than diagnosing a runaway worker).
fn strip_think_blocks(input: &str) -> String {
    let mut out = input.to_string();
    for _ in 0..32 {
        let lower = out.to_ascii_lowercase();
        let Some(open) = lower.find("<think>") else {
            break;
        };
        let after_open = open + "<think>".len();
        let Some(rel_close) = lower[after_open..].find("</think>") else {
            // Open tag with no matching close: drop everything from
            // the opener onwards. The model started thinking and
            // never finished — better to lose the tail than to surface
            // a half-monologue in the textarea.
            out.truncate(open);
            break;
        };
        let close = after_open + rel_close + "</think>".len();
        out.replace_range(open..close, "");
    }
    out
}
