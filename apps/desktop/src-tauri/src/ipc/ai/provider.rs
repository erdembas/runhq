use runhq_core::ai::{
    self, AiProvider, AiProviderKind, ChatMessage, ChatOptions, ChatResponse, TestResult,
};
use runhq_core::error::{AppError, AppResult};
use serde::Deserialize;
use tauri::State;

use crate::AppState;

// ---- AI providers --------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AiProviderInput {
    /// When omitted we mint a new id; passing one updates the existing
    /// record. Lets the React form reuse the same endpoint for create
    /// and edit without juggling separate IPC routes.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub kind: AiProviderKind,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub default: bool,
    /// Preferred response language as a BCP-47-ish code (`en`, `tr`,
    /// `auto`, …). Optional — when absent the model decides on its
    /// own (typically English or whatever the user wrote in).
    #[serde(default)]
    pub response_language: Option<String>,
    /// Per-provider language override for AI-generated commit
    /// messages. Optional. Empty / `inherit` means "use
    /// response_language"; `auto` opts the commit surface out of any
    /// language directive even when the chat surface has one. See
    /// `AiProvider::commit_language_directive`.
    #[serde(default)]
    pub commit_language: Option<String>,
    /// Per-provider hard ceiling on output tokens. `None` means "no
    /// client-side cap" — let the server decide. The form treats an
    /// empty input as `None`; a positive integer is forwarded as-is
    /// and clamps every AI surface (chat, diff, log, standup,
    /// project, commit message). See `AiProvider::max_output_tokens`
    /// for the resolution rules.
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    /// Optional context window (input + output) in tokens. Drives the
    /// chat composer's TokenMeter. 0/None means "no denominator" —
    /// the meter still shows the raw count.
    #[serde(default)]
    pub context_window: Option<u32>,
}

#[tauri::command]
pub fn list_ai_providers(state: State<'_, AppState>) -> AppResult<Vec<AiProvider>> {
    Ok(state.store.ai_providers())
}

#[tauri::command]
pub fn upsert_ai_provider(
    input: AiProviderInput,
    state: State<'_, AppState>,
) -> AppResult<AiProvider> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    if input.base_url.trim().is_empty() {
        return Err(AppError::Invalid("base URL is required".into()));
    }
    if input.model.trim().is_empty() {
        return Err(AppError::Invalid("model is required".into()));
    }

    // Preserve the original `created_at_ms` on edits — purely cosmetic
    // ("added 3 days ago") but a stable timestamp keeps the list order
    // honest after every save.
    let (id, created_at_ms) = match input.id.as_deref() {
        Some(id) if !id.is_empty() => {
            let existing_ts = state
                .store
                .ai_provider(id)
                .map(|p| p.created_at_ms)
                .unwrap_or_else(now_ms);
            (id.to_string(), existing_ts)
        }
        _ => (uuid::Uuid::new_v4().to_string(), now_ms()),
    };

    let provider = AiProvider {
        id,
        name: input.name.trim().to_string(),
        kind: input.kind,
        base_url: input.base_url.trim().to_string(),
        api_key: input.api_key,
        model: input.model.trim().to_string(),
        default: input.default,
        response_language: input
            .response_language
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        commit_language: input
            .commit_language
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        // 0 from the form means "blank → no cap", same as `None`. Any
        // positive value is forwarded as-is. We don't clamp to a
        // minimum here: if the user types `1` they get `1`, and the
        // resulting truncated answer is its own teaching moment.
        max_output_tokens: input.max_output_tokens.filter(|v| *v > 0),
        context_window: input.context_window.filter(|v| *v > 0),
        created_at_ms,
    };
    state
        .store
        .upsert_ai_provider(provider.clone())
        .map_err(AppError::from)?;
    Ok(provider)
}

#[tauri::command]
pub fn remove_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.store.remove_ai_provider(&id).map_err(AppError::from)
}

#[tauri::command]
pub fn set_default_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state
        .store
        .set_default_ai_provider(&id)
        .map_err(AppError::from)
}

/// Probe the provider's `/chat/completions` endpoint without burning
/// real tokens. Returns a structured success/failure record so the UI
/// can render a green check + latency or a red error message without
/// having to parse exception strings.
#[tauri::command]
pub async fn test_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<TestResult> {
    let provider = state.store.ai_provider(&id).ok_or(AppError::NotFound(id))?;
    ai::test_provider(&provider).await
}

#[derive(Debug, Deserialize)]
pub struct ChatRequestInput {
    /// When `None`, we resolve the user's default provider. Lets feature
    /// surfaces (commit panel, future inline chat, etc.) call this
    /// without each one re-implementing default-resolution.
    #[serde(default)]
    pub provider_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub options: ChatOptions,
}

#[tauri::command]
pub async fn ai_chat_completion(
    input: ChatRequestInput,
    state: State<'_, AppState>,
) -> AppResult<ChatResponse> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    ai::chat_completion(&provider, input.messages, input.options).await
}

pub(super) fn resolve_ai_provider(
    explicit_id: Option<&str>,
    state: &State<'_, AppState>,
) -> AppResult<AiProvider> {
    if let Some(id) = explicit_id {
        return state
            .store
            .ai_provider(id)
            .ok_or_else(|| AppError::NotFound(format!("AI provider {id}")));
    }
    state.store.default_ai_provider().ok_or_else(|| {
        AppError::Invalid(
            "No AI provider configured. Open Settings → AI Providers to add one.".into(),
        )
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
