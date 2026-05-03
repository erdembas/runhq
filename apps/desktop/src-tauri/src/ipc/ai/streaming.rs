use runhq_core::ai::{self, AiProvider, ChatMessage, ChatOptions, StreamChunk};
use runhq_core::error::{AppError, AppResult};
use serde::Deserialize;
use tauri::State;

use super::provider::{resolve_ai_provider, ChatRequestInput};
use crate::AppState;

// ---- AI streaming surfaces -----------------------------------------------

/// Generic chat completion with streaming. The frontend hooks a
/// `Channel<StreamChunk>` and renders deltas as they arrive — matches
/// the OpenAI streaming experience users already know.
#[tauri::command]
pub async fn ai_chat_completion_stream(
    input: ChatRequestInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    stream_with_fallback(&provider, input.messages, input.options, on_chunk).await
}

#[derive(Debug, Deserialize)]
pub struct ExplainDiffInput {
    /// Unified diff text. The frontend ships it raw so the backend
    /// doesn't have to know which surface (commit panel, history,
    /// branches, cross-project) the diff came from.
    pub diff: String,
    #[serde(default)]
    pub file_path: Option<String>,
    /// `true` when the diff represents a hand-picked selection
    /// (single hunk) rather than a whole file. Adjusts the prompt
    /// wording so the model knows the scope is narrow.
    #[serde(default)]
    pub selection_only: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_diff(
    input: ExplainDiffInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "There is no diff to explain — stage or open a change first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_explain_diff_prompt(
        &input.diff,
        input.file_path.as_deref(),
        input.selection_only,
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // A tad warmer than commit messages: explanations benefit
            // from one or two paraphrasing attempts when the user
            // hits "regenerate".
            temperature: Some(0.3),
            // No surface-level cap. Diff explanation is the surface
            // most likely to need a *lot* of room — a power user on
            // a Gemini 1M / Claude 200K model might paste 800 commits
            // of history and expect a multi-section walk-through. A
            // hard 1500 here would silently truncate that. We trust
            // the provider's `max_output_tokens` (configured in AI
            // Settings) or the server's own per-model default to be
            // the safety net. The `<think>` parser and scratchpad
            // reclassifier already hide planning preambles from the
            // UI, so giving the model unlimited rope only costs the
            // user's own latency / quota — their call to make.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ExplainLogInput {
    /// The single log line the user right-clicked on.
    pub line: String,
    /// The surrounding ±N lines. Order is preserved (oldest first);
    /// the prompt frames it as "most-recent last" to match how
    /// engineers read tail output.
    #[serde(default)]
    pub context_lines: Vec<String>,
    /// Inferred runtime hint ("node", "rust", "go", "python", …).
    /// Drives ecosystem-aware suggestions in the model's reply.
    #[serde(default)]
    pub runtime: Option<String>,
    /// User-friendly service name (`api-svc`), used so the model can
    /// speak about the failure in concrete terms.
    #[serde(default)]
    pub service_name: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_log(
    input: ExplainLogInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.line.trim().is_empty() {
        return Err(AppError::Invalid("Log line is empty.".into()));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_log_triage_prompt(
        &input.line,
        &input.context_lines,
        input.runtime.as_deref(),
        input.service_name.as_deref(),
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            temperature: Some(0.2),
            // No surface cap. Triage body is naturally short (~250t)
            // because the prompt format constrains it ("Likely cause:
            // … Try this: …"), but we let the provider / server be
            // the ceiling so users on long-context models can paste
            // whole stack traces and get back equally thorough
            // breakdowns. If a local 3B model goes overboard with
            // its planning preamble, the user can either set a
            // provider-level `max_output_tokens` cap or hit Stop.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct TriageAdvisoriesInput {
    /// The (already filtered + ordered) advisory rows the user wants
    /// the model to triage. Frontend ships them through unchanged
    /// from the visible list — that way the model triages exactly
    /// what the user is looking at, even when severity tile filters
    /// have narrowed the view to "CRITICAL only".
    pub advisories: Vec<ai::AdvisoryBrief>,
    /// Friendly project name (e.g. `belgehub-mobile`). Drives the
    /// "Project: `…`" header in the prompt; lets the model speak
    /// about the failure in concrete terms.
    #[serde(default)]
    pub project_name: Option<String>,
    /// Inferred runtime (`node`, `python`, `rust`, …). Adjusts the
    /// model's fix recommendations toward the right ecosystem
    /// (`npm install` vs `pip install` vs `cargo update`).
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_triage_advisories(
    input: TriageAdvisoriesInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.advisories.is_empty() {
        return Err(AppError::Invalid(
            "No advisories to triage — clear filters or run a scan first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_advisory_triage_prompt(
        &input.advisories,
        input.project_name.as_deref(),
        input.runtime.as_deref(),
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Slightly cool — triage benefits from consistent
            // ordering across regenerations more than it does from
            // creative phrasing. Hot temperatures here have shown
            // (in QA) a tendency to swap the top-3 fix order on
            // each regenerate, which destroys the "did it agree
            // with itself?" sanity check the user does mentally.
            temperature: Some(0.2),
            // No surface cap; defer to provider/model. The prompt's
            // self-imposed 300-word limit constrains output even on
            // verbose models, but a 60-row triage with proper
            // grouping rationale legitimately exceeds 1500 tokens
            // on smaller models — past tests with a hard cap here
            // produced mid-list cutoffs that hid the most useful
            // recommendations.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct PolishStandupInput {
    /// Raw markdown produced by `timeline::export_standup`. We
    /// intentionally ship it as a string instead of re-deriving on the
    /// backend so the user gets the same content they're staring at.
    pub raw_markdown: String,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_polish_standup(
    input: PolishStandupInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.raw_markdown.trim().is_empty() {
        return Err(AppError::Invalid(
            "Nothing to polish — record some activity first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_polish_standup_prompt(&input.raw_markdown);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            temperature: Some(0.4),
            // No surface cap. The polished standup itself is bounded
            // by format (~250t of Yesterday / Today / Blockers
            // bullets), but a long week of activity legitimately
            // produces longer standups, and scratchpad-heavy models
            // need uncapped room to think. The provider-level
            // `max_output_tokens` is the place to clamp this if the
            // user is on a small model with a fixed output window.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeWorkspaceInput {
    /// Pre-aggregated portfolio snapshot built by the frontend (see
    /// `lib/ai/workspaceSummary.ts`). We accept it as a free-form
    /// `serde_json::Value` rather than a typed schema so the
    /// dashboard can grow new signal columns (e.g. log-error
    /// counts, dependabot alerts, deployment status) without
    /// dragging the IPC layer along — the prompt is JSON-aware and
    /// the model handles missing keys gracefully.
    #[serde(default)]
    pub facts: serde_json::Value,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_analyze_workspace(
    input: AnalyzeWorkspaceInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.facts.is_null() {
        return Err(AppError::Invalid(
            "Nothing to analyse — workspace snapshot is empty.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let facts_pretty =
        serde_json::to_string_pretty(&input.facts).unwrap_or_else(|_| input.facts.to_string());
    let messages = ai::build_workspace_report_prompt(&facts_pretty);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Cool — the workspace report is a structured executive
            // summary; users regenerate it expecting the same risk
            // picture, only re-phrased. A hot temperature here
            // produces wildly different "top hotspot" rankings on
            // back-to-back runs and erodes trust.
            temperature: Some(0.2),
            // No surface cap. The prompt's 250-word ceiling
            // keeps output bounded; uncapped lets reasoning-heavy
            // models think privately without clipping the visible
            // report.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ExplainProjectInput {
    /// Pre-built one-line summary from the dashboard ("api-svc · 3
    /// critical CVEs · 47d stale · dirty tree"). The frontend builds
    /// it because it has the user's chosen number formatting; the
    /// backend just frames it for the LLM.
    pub headline: String,
    /// Structured facts as a free-form JSON object. Anything the
    /// dashboard already knows about the project: `dirty_files`,
    /// `branch`, `ahead`, `behind`, `cve_critical`, `outdated_total`,
    /// `last_activity_days`, `runtime`, etc. Passing it as JSON
    /// (rather than a typed Rust struct) keeps the IPC stable as the
    /// dashboard adds new dimensions.
    #[serde(default)]
    pub facts: serde_json::Value,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_project_state(
    input: ExplainProjectInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let mut block = String::new();
    if !input.headline.trim().is_empty() {
        block.push_str(&format!("Headline: {}\n\n", input.headline.trim()));
    }
    let facts_pretty =
        serde_json::to_string_pretty(&input.facts).unwrap_or_else(|_| input.facts.to_string());
    block.push_str("Facts:\n```json\n");
    block.push_str(&facts_pretty);
    block.push_str("\n```\n");

    let messages = ai::build_explain_project_prompt(&block);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Dashboard explanation is a hover-popover; we want a
            // calm, factual tone, not creative writing.
            temperature: Some(0.1),
            // No surface cap — defer to provider / server. The
            // popover answer is bounded by the prompt itself ("one
            // tight paragraph") so we don't *need* a numeric ceiling
            // to keep it short, and an uncapped budget gives small
            // models room to plan in private without truncating the
            // visible paragraph that comes after.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

/// Run a streaming completion and guarantee that the channel sees
/// exactly one terminal event (`Done` from the core, or an `Error`
/// emitted here when the network/SSE parser bails mid-stream). Without
/// this, a dropped connection would leave the UI spinner stuck forever
/// because no terminal chunk ever arrives.
async fn stream_with_fallback(
    provider: &AiProvider,
    mut messages: Vec<ChatMessage>,
    options: ChatOptions,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
) -> AppResult<()> {
    // Apply the provider's preferred response language uniformly across
    // every streaming surface (chat panel, diff explainer, log triage,
    // standup polisher, project state). Doing it here — rather than in
    // each prompt builder — keeps the builders pure and means a future
    // 6th feature inherits the behaviour for free.
    if let Some(directive) = provider.language_directive() {
        ai::apply_language_to_vec(&mut messages, &directive);
    }
    // Note: we don't merge `options.max_tokens` against
    // `provider.max_output_tokens` here. `chat_completion_stream`
    // calls `provider.resolve_max_tokens(options.max_tokens)` at
    // body-building time and applies the same min-rule that
    // `chat_completion` (non-streaming) uses, so commit-message
    // generation and streaming surfaces honour the user's
    // per-provider cap identically.
    let result = ai::chat_completion_stream(provider, messages, options, |chunk| {
        let _ = on_chunk.send(chunk);
    })
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            // Best-effort terminal Error so the UI can render a
            // failure state instead of an indefinite "thinking…".
            let _ = on_chunk.send(StreamChunk::Error {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}
