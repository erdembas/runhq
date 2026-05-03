use runhq_core::ai;
use runhq_core::error::{AppError, AppResult};
use runhq_core::git;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::super::resolve_cwd;
use super::provider::resolve_ai_provider;
use crate::AppState;

/// Snapshot of the data needed to seed a commit-message chat in the
/// AI Chat panel. The Phase-5 chat-hub flow asks the renderer to drive
/// the conversation (so the user can switch models, follow up, etc.),
/// but git plumbing is still cheapest in Rust — we run the diff and
/// log here, hand the plain text to JS, and let the panel build its
/// own prompt around it.
///
/// Why not just return the prompt strings?
/// We could, but that hard-codes the prompt structure on the Rust
/// side. By shipping the raw evidence the renderer can iterate on
/// wording / persona without an IPC version bump.
#[derive(Debug, Serialize)]
pub struct CommitChatContext {
    pub branch: Option<String>,
    pub diff: String,
    pub recent_subjects: Vec<String>,
    /// Truncation marker so the renderer can show a "[diff truncated]"
    /// pill or similar without re-implementing the size policy. Set
    /// when we cap the staged diff at `MAX_COMMIT_CHAT_DIFF_CHARS`.
    pub diff_truncated: bool,
}

#[derive(Debug, Deserialize)]
pub struct CommitChatContextInput {
    pub service_id: String,
}

/// Soft cap for the staged-diff blob shipped to the chat panel. Big
/// enough to capture a meaty refactor (~250 lines), small enough that
/// even tiny-context models won't choke when we tack on the system
/// prompt + recent commits.
const MAX_COMMIT_CHAT_DIFF_CHARS: usize = 12_000;

#[tauri::command]
pub async fn ai_commit_chat_context(
    input: CommitChatContextInput,
    state: State<'_, AppState>,
) -> AppResult<CommitChatContext> {
    let cwd = resolve_cwd(&input.service_id, &state)?;

    let cwd_for_diff = cwd.clone();
    let mut diff = tokio::task::spawn_blocking(move || git::diff_staged_raw(&cwd_for_diff))
        .await
        .map_err(|e| AppError::Other(format!("diff task join failed: {e}")))??;
    let mut diff_truncated = false;
    if diff.len() > MAX_COMMIT_CHAT_DIFF_CHARS {
        diff.truncate(MAX_COMMIT_CHAT_DIFF_CHARS);
        diff.push_str("\n[diff truncated by RunHQ — only the leading hunks were sent]");
        diff_truncated = true;
    }

    let cwd_for_log = cwd.clone();
    let recent = tokio::task::spawn_blocking(move || git::log(&cwd_for_log, None, 8))
        .await
        .map_err(|e| AppError::Other(format!("log task join failed: {e}")))?
        .unwrap_or_default();
    let recent_subjects: Vec<String> = recent.into_iter().map(|c| c.subject).collect();

    let branch = git::status(&cwd).and_then(|s| s.branch);

    Ok(CommitChatContext {
        branch,
        diff,
        recent_subjects,
        diff_truncated,
    })
}

#[derive(Debug, Deserialize)]
pub struct GenerateCommitInput {
    /// Service whose working tree we summarise. Service id (rather than
    /// raw cwd) keeps the surface uniform with every other git command.
    pub service_id: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Optional one-line nudge from the user ("focus on the perf fix")
    /// — the AI gives it weight when picking which area of the diff
    /// to emphasise.
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GenerateCommitResult {
    pub message: String,
    pub model: Option<String>,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub provider_id: String,
    pub provider_name: String,
}

#[tauri::command]
pub async fn ai_generate_commit_message(
    input: GenerateCommitInput,
    state: State<'_, AppState>,
) -> AppResult<GenerateCommitResult> {
    let cwd = resolve_cwd(&input.service_id, &state)?;
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;

    // Pull tone-matching context off the main thread — git shells out,
    // so even quick reads block briefly. Wrapping in `spawn_blocking`
    // is cheap insurance against ever-so-slightly-slow filesystems.
    let cwd_for_diff = cwd.clone();
    let diff = tokio::task::spawn_blocking(move || git::diff_staged_raw(&cwd_for_diff))
        .await
        .map_err(|e| AppError::Other(format!("diff task join failed: {e}")))??;

    let cwd_for_log = cwd.clone();
    let recent = tokio::task::spawn_blocking(move || git::log(&cwd_for_log, None, 8))
        .await
        .map_err(|e| AppError::Other(format!("log task join failed: {e}")))?
        .unwrap_or_default();
    let recent_subjects: Vec<String> = recent.into_iter().map(|c| c.subject).collect();

    let branch = git::status(&cwd).and_then(|s| s.branch);

    let raw = ai::generate_commit_message(
        &provider,
        &diff,
        branch.as_deref(),
        &recent_subjects,
        input.hint.as_deref(),
    )
    .await?;

    Ok(GenerateCommitResult {
        message: raw,
        // We don't have a token count here because `generate_commit_message`
        // discards the raw `ChatResponse`. Keeping the fields in the IPC
        // shape (rather than dropping them) lets us start surfacing
        // "Used N tokens" in the UI later without an IPC version bump.
        model: Some(provider.model.clone()),
        prompt_tokens: None,
        completion_tokens: None,
        provider_id: provider.id.clone(),
        provider_name: provider.name.clone(),
    })
}
