use runhq_core::error::AppResult;
use serde::{Deserialize, Serialize};

// ---- Token counting (chat composer meter) -------------------------------

#[derive(Debug, Deserialize)]
pub struct CountTokensInput {
    /// String fragments to count. The frontend passes one entry per
    /// chat history message + the live composer text — summing on
    /// our side avoids materialising a single oversized `String` on
    /// every keystroke.
    pub texts: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CountTokensOutput {
    /// BPE-estimated token total. See `runhq_core::tokens` for the
    /// tokeniser choice and fallback semantics.
    pub tokens: u32,
}

/// Estimate the prompt size in tokens for the chat composer's meter.
///
/// Cheap by tiktoken standards — we use `o200k_base` (GPT-4o family,
/// efficient for non-Latin scripts) and the call is linear in input
/// length. Frontend can call this on every keystroke without
/// debouncing for prompts up to ~50KB; bigger payloads should be
/// debounced at ~100ms by the caller.
#[tauri::command]
pub async fn ai_count_tokens(input: CountTokensInput) -> AppResult<CountTokensOutput> {
    // The tokeniser does its own thread-safe lazy init, so we can
    // call it directly from the async context without spawning to
    // a blocking pool. Empty inputs short-circuit inside `count_tokens`.
    let tokens = runhq_core::tokens::count_tokens_many(&input.texts);
    Ok(CountTokensOutput { tokens })
}
