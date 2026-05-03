use super::super::ChatMessage;
use super::common::{
    truncate_with_marker, MAX_EXPLAIN_DIFF_CHARS, MAX_LOG_TRIAGE_CHARS, NO_SCRATCHPAD_DIRECTIVE,
};

/// Prompt the model to explain what a diff changes — in plain English,
/// grounded in the actual hunks. We ask for a structured shape (1-line
/// summary → bullets → review concerns) so the answer renders cleanly
/// in the popover and the user knows what to expect every time.
pub fn build_explain_diff_prompt(
    diff: &str,
    file_path: Option<&str>,
    selection_only: bool,
) -> Vec<ChatMessage> {
    let system_base = "You are a senior code reviewer explaining a diff to a teammate. \
                  Write plain English in GitHub-flavoured Markdown — clarity over completeness. \
                  Lead with a one-line bold summary of the diff. Follow it with up to five short bullets describing the actual changes. \
                  If there are real risks (nullability, missing tests, off-by-ones, breaking changes), add a brief **Review concerns** section; otherwise omit it. \
                  Reference the real symbols and file paths from the diff when they help. Never invent code that isn't in the diff. \
                  Never wrap your final answer in code fences.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    let scope = if selection_only {
        "the selected hunk"
    } else if file_path.is_some() {
        "the diff for one file"
    } else {
        "the diff"
    };

    let mut user = String::new();
    user.push_str(&format!("Explain {scope}.\n"));
    if let Some(p) = file_path {
        user.push_str(&format!("File: `{p}`\n"));
    }
    user.push_str("\n```diff\n");
    user.push_str(&truncate_with_marker(
        diff,
        MAX_EXPLAIN_DIFF_CHARS,
        "[diff truncated by RunHQ — only the leading hunks were sent]",
    ));
    user.push_str("\n```\n");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// Prompt the model to triage a log line: name the likely cause and
/// suggest a fix. The runtime hint (`node`, `rust`, `go`, …) helps the
/// model pick the right ecosystem advice (e.g. `Cargo.toml` vs
/// `package.json`); the service name lets it speak about the failure
/// in concrete terms ("`api-svc` can't reach Postgres").
pub fn build_log_triage_prompt(
    line: &str,
    context_lines: &[String],
    runtime: Option<&str>,
    service_name: Option<&str>,
) -> Vec<ChatMessage> {
    let system_base = "You are a senior backend engineer triaging a production log line. \
                  Answer in GitHub-flavoured Markdown. Start with **Likely cause** in one or two sentences. \
                  Follow it with a **Try this** numbered list of at most four items; each item gets a one-line rationale and an optional shell snippet in backticks. \
                  Be specific — cite the ports, env vars, and file paths that appear in the log. \
                  If the line is plainly benign info or debug noise, say so in one sentence and stop. \
                  Never speculate about code you can't see; when the cause is genuinely ambiguous, name the single piece of evidence (a longer log, `--trace`, a particular file) that would resolve it.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    let mut user = String::new();
    user.push_str("Triage this log line.\n\n");
    if let Some(svc) = service_name {
        user.push_str(&format!("Service: `{svc}`\n"));
    }
    if let Some(rt) = runtime {
        if !rt.is_empty() {
            user.push_str(&format!("Runtime: `{rt}`\n"));
        }
    }
    user.push_str("\nThe line that triggered the alert:\n```\n");
    user.push_str(line.trim_end());
    user.push_str("\n```\n\n");

    if !context_lines.is_empty() {
        user.push_str("Surrounding log context (most-recent last):\n```\n");
        let joined = context_lines.join("\n");
        user.push_str(&truncate_with_marker(
            &joined,
            MAX_LOG_TRIAGE_CHARS,
            "[log context truncated by RunHQ]",
        ));
        user.push_str("\n```\n");
    }
    user.push_str("\nNow triage.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// Prompt the model to summarise *why* a project is in a worrying state,
/// using only facts the dashboard has already aggregated. We pass the
/// facts as a small JSON-y block so the model can't hallucinate fields
/// that aren't there. Output is intentionally short — this lives in a
/// hover popover, not a full panel.
pub fn build_explain_project_prompt(facts_block: &str) -> Vec<ChatMessage> {
    let system_base = "You are RunHQ's dashboard explainer. The user is asking why a project card is showing warnings. \
                  Answer in GitHub-flavoured Markdown as one tight paragraph of at most four sentences — no bullets, no headers, no preamble. \
                  Cite the concrete facts you were given (vulnerability counts, days since last activity, dirty file count, branch ahead/behind); never invent numbers. \
                  End with one concrete next action in backticks when obvious (for example `npm audit fix` or `git pull`); otherwise end with a single sentence describing the next step the engineer would take.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    let mut user = String::new();
    user.push_str("Explain why this project is showing warnings, based on these facts:\n\n");
    user.push_str(facts_block.trim());

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}
