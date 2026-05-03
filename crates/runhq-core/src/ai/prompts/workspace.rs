use super::super::ChatMessage;
use super::common::{MAX_WORKSPACE_FACTS_CHARS, NO_SCRATCHPAD_DIRECTIVE};

/// Prompt the model to write an executive-level workspace report —
/// "if I had 5 minutes with my tech lead, what should I look at first
/// across all my projects?". Inputs are pre-aggregated by the
/// frontend (see `lib/ai/workspaceSummary.ts`) into a single JSON
/// facts blob: per-project status / CVE counts / outdated counts /
/// git state / activity, plus workspace totals.
///
/// The prompt structure mirrors how an engineer reads a dashboard:
/// "what's on fire?" → "what's bleeding slowly?" → "what can I ship
/// right now?" → "what's actually fine?". Keeping that shape stable
/// across regenerations means the user develops muscle memory for
/// where to look first; a free-form "summarise this" prompt would
/// let the model reorder sections and tank that scanning rhythm.
///
/// Char-budget enforcement happens here rather than at the prompt-
/// build site so the IPC layer stays a thin pass-through. If the
/// frontend ships an over-budget blob (a 200-project monorepo
/// edge case), we tail-trim and add an explicit "[trimmed]" note
/// so the model knows it's not seeing the full picture.
pub fn build_workspace_report_prompt(facts_json: &str) -> Vec<ChatMessage> {
    let system_base = "You are RunHQ's portfolio-review assistant — an experienced tech lead reading a one-page workspace snapshot for a working engineer. \
                  Answer in GitHub-flavoured Markdown using exactly four sections in this order: \
                  **TL;DR** (one sentence — the single most important thing to do today), \
                  **Risk hotspots** (up to four bullets, each naming a specific project and the concrete reason it's risky — RCE-class CVEs, repeated crashes, dirty trees blocking deploys, weeks of staleness on a critical service), \
                  **Quick wins** (up to three bullets — things shippable in under 30 minutes: a `cargo update`, a clean stash-and-pull, an obvious `npm audit fix`), \
                  **Steady state** (one line — what's quietly healthy and doesn't need attention; if everything is on fire, say \"nothing\"). \
                  Cite real project names from the facts in backticks. Cite real numbers — never round vaguely (\"a few CVEs\" is wrong; \"3 critical CVEs in `belgehub-mobile`\" is right). \
                  Suggested commands go in backticks. \
                  When a section has no qualifying projects, write \"None.\" rather than padding it with weak items. \
                  Never invent projects, packages, or CVE details that aren't in the facts. \
                  Keep the entire response under 250 words.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    let trimmed = facts_json.trim();
    let (body, trimmed_note) = if trimmed.len() > MAX_WORKSPACE_FACTS_CHARS {
        // Tail-trim and announce. We deliberately don't try to JSON-
        // surgery the blob into a shape that's still parseable —
        // the prompt frames it as a free-form "snapshot" not a
        // typed schema, so a truncation marker mid-array reads as
        // "you're seeing the head of the list" rather than "the
        // payload is broken JSON". The model's "don't invent"
        // guardrail covers the gap.
        (
            &trimmed[..MAX_WORKSPACE_FACTS_CHARS],
            "\n\n[snapshot truncated — only the first portion of the workspace was sent]",
        )
    } else {
        (trimmed, "")
    };

    let mut user = String::new();
    user.push_str(
        "Review this workspace snapshot and tell me where to focus.\n\n\
         The snapshot is a JSON object. `workspace` holds aggregate counts; \
         `projects` is an array, one entry per service, in the order the dashboard \
         currently shows them.\n\n\
         ```json\n",
    );
    user.push_str(body);
    user.push_str(trimmed_note);
    user.push_str("\n```\n\nNow write the report.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// Prompt the model to rewrite a raw timeline-events markdown block
/// into a clean three-section standup ("Yesterday / Today / Blockers").
/// Input is already grouped/aggregated by `timeline::export_standup`,
/// so the model is purely a rewriter, not a fact-extractor.
pub fn build_polish_standup_prompt(raw_markdown: &str) -> Vec<ChatMessage> {
    // Tight, declarative system prompt — early experiments with a
    // bulleted "Rules:" block caused 3B-class local models (llama3.2,
    // qwen2.5:3b, phi-3) to literally echo the rules back as the
    // answer. Plain prose with second-person imperatives is more
    // robust across model sizes.
    let system_base = "You rewrite raw engineering activity logs into clean daily standups. \
                  Your output is the standup itself — never instructions, rules, or scaffolding. \
                  Format the output as GitHub-flavoured Markdown with exactly three sections: \
                  **Yesterday**, **Today**, and **Blockers**. \
                  Each section gets 2 to 4 short bullets, grouped by project or service when helpful. \
                  Infer Today from in-flight work visible in Yesterday's log (open WIP, half-finished branches). \
                  Set Blockers to \"None.\" unless the log shows repeated errors or stuck services. \
                  Never invent commits, services, teammates, or numbers that aren't in the input. \
                  Begin the response directly with the **Yesterday** heading.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    let mut user = String::new();
    user.push_str("Activity log:\n\n");
    user.push_str("```markdown\n");
    user.push_str(raw_markdown.trim());
    user.push_str("\n```\n\nWrite the standup now.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}
