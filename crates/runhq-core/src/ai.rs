//! AI provider integration.
//!
//! RunHQ talks to any OpenAI-compatible chat completions endpoint
//! (`/chat/completions`). That umbrella covers OpenAI itself, Azure
//! OpenAI (with a thin URL prefix), Ollama (`/v1/...`), LM Studio,
//! Together, OpenRouter, Groq, DeepSeek, Mistral, and most local
//! gateways — meaning a single transport keeps the core surface tiny
//! while still letting the user point RunHQ at literally anything.
//!
//! This module is deliberately UI/Tauri-free so it stays unit-testable
//! and reusable from a future CLI. Persistence of provider records lives
//! in [`crate::state`] alongside services and stacks; the HTTP client
//! itself is stateless and reconstructed per request, which keeps the
//! core crate free of long-lived async resources.
//!
//! ### Threat model
//!
//! API keys are stored in `config.json` in the user's home directory.
//! That's the same trust boundary as a `~/.npmrc`, `~/.aws/credentials`,
//! or `~/.config/gh/hosts.yml`: secured by filesystem permissions, not
//! encryption-at-rest. A future iteration can move keys into the OS
//! keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux);
//! the [`AiProvider`] shape exposes a stable `id` so the migration is
//! mechanical.

mod client;
mod prompts;
mod provider;
mod streaming;
mod thinking;
mod types;

pub use client::{chat_completion, test_provider};
pub use prompts::{
    build_advisory_triage_prompt, build_commit_prompt, build_explain_diff_prompt,
    build_explain_project_prompt, build_log_triage_prompt, build_polish_standup_prompt,
    build_workspace_report_prompt, generate_commit_message, AdvisoryBrief,
};
pub use provider::{apply_language_directive, apply_language_to_vec, AiProvider, AiProviderKind};
pub use streaming::chat_completion_stream;
#[cfg(test)]
pub(crate) use streaming::{idle_budget, STREAM_ACTIVE_IDLE_TIMEOUT, STREAM_IDLE_TIMEOUT};
pub use thinking::{ThinkPart, ThinkState};
pub use types::{ChatMessage, ChatOptions, ChatResponse, StreamChunk, TestResult};

#[cfg(test)]
mod tests;
