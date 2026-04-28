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

use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Supported provider transport. The runtime semantics are identical for
/// every variant — they all hit a `/chat/completions` endpoint with
/// `Authorization: Bearer <key>` — but the enum keeps a stable label we
/// can render in the UI ("OpenAI", "Anthropic via proxy", etc.) and
/// lets us add provider-specific quirks (header names, response
/// shapes) without breaking existing records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    /// OpenAI, plus any service that ships a "drop-in OpenAI replacement"
    /// (Ollama, LM Studio, OpenRouter, Together, Groq, DeepSeek, Mistral,
    /// Azure OpenAI with a custom `base_url`, etc.).
    #[default]
    Openai,
}

/// One persisted AI provider record. The user can register many of these
/// — for instance "Local Ollama" + "Production OpenAI" + "Cheap fallback
/// via Groq" — and pick a default that everyone in the app uses unless
/// a feature explicitly overrides it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: AiProviderKind,
    /// API root, e.g. `https://api.openai.com/v1`. We append
    /// `/chat/completions` ourselves so the user pastes the same URL
    /// they'd put in a `curl` example. Trailing slashes are tolerated.
    pub base_url: String,
    /// Bearer token. Persisted as plain text in `config.json` for now —
    /// see module-level docs for the rationale and migration plan.
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub default: bool,
    /// BCP-47-ish language code the model should respond in
    /// (`en`, `tr`, `de`, `auto`, …). `None` or `auto` means "let the
    /// model decide" — typically that mirrors the user's input. Stored
    /// per-provider so a user can keep a Turkish-leaning local model
    /// alongside an English-leaning OpenAI account.
    #[serde(default)]
    pub response_language: Option<String>,
    /// Hard ceiling on streamed output tokens for this provider, in
    /// tokens. `None` (default) means "no client-side cap" — we send
    /// no `max_tokens` field and let the server apply its own
    /// model-aware default. Useful for users on long-context models
    /// (Gemini 1M, Claude 200K, Qwen 128K) who legitimately want
    /// 5K+ token explanations of huge diffs and don't need RunHQ
    /// preempting them with a 2K cap. We *clamp* per-surface caller
    /// requests against this value: if a surface requests 1500 and
    /// the provider says max 8000, we send 1500; if the surface
    /// requests 1500 and the provider says 600, we send 600.
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    /// Optional per-provider context window (input + output) in tokens.
    /// Drives the chat composer's TokenMeter — when set, the meter
    /// renders a "12,400 / 128,000" gauge with traffic-light coloring
    /// as the user approaches the cap. `None` means we just show the
    /// raw count without a denominator (still useful, just no warning
    /// thresholds). Stored per-provider rather than per-model because
    /// the user may run the same model behind multiple providers
    /// (e.g. local llama.cpp at 8K vs. cloud at 128K).
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub created_at_ms: i64,
}

impl AiProvider {
    /// Resolve the chat completions URL. Strips a single trailing slash
    /// from `base_url` so both `https://api.openai.com/v1` and
    /// `https://api.openai.com/v1/` produce the same final URL.
    pub fn chat_url(&self) -> String {
        let trimmed = self.base_url.trim_end_matches('/');
        format!("{trimmed}/chat/completions")
    }

    /// Human-readable, model-friendly directive for the response
    /// language. `None`/empty/`auto`/`en` returns `None` (no
    /// directive), since English is the de-facto default and "auto"
    /// is what the model would do anyway.
    pub fn language_directive(&self) -> Option<String> {
        let raw = self.response_language.as_deref()?.trim();
        if raw.is_empty() || raw.eq_ignore_ascii_case("auto") {
            return None;
        }
        Some(language_directive_for_code(raw))
    }

    /// Resolve the effective `max_tokens` to put on the wire, given a
    /// caller-supplied surface preference (the per-feature hint set
    /// in `ipc.rs`). The rule: take the *smaller* of whichever values
    /// are set, treating `None` as "no opinion".
    ///
    /// Why this shape:
    /// - Some surfaces deliberately leave it `None` ("no surface
    ///   cap, please") so a Gemini 1M user really does get to spend
    ///   100K tokens explaining a giant diff if they want.
    /// - Some users set a provider-level cap because their model has
    ///   a tight output window or they want predictable cost. They
    ///   expect that cap to apply *everywhere*, even on surfaces
    ///   that hardcoded a higher hint.
    /// - When both sides have an opinion, the smaller one wins —
    ///   it's the conservative answer that respects both intents.
    pub fn resolve_max_tokens(&self, surface_hint: Option<u32>) -> Option<u32> {
        match (surface_hint, self.max_output_tokens) {
            (Some(s), Some(p)) => Some(s.min(p)),
            (Some(s), None) => Some(s),
            (None, Some(p)) => Some(p),
            (None, None) => None,
        }
    }
}

/// Map a BCP-47-ish language code to a "Respond in <Language>." line
/// suitable for appending to a system prompt. We keep the directive in
/// English (universal model knowledge) and add the native-script name
/// in parentheses so the model recognises the target without ambiguity
/// — `Respond in Turkish (Türkçe).` works much more reliably across
/// model sizes than just `tr` or `Türkçe` alone.
fn language_directive_for_code(code: &str) -> String {
    let lc = code.trim().to_ascii_lowercase();
    let pretty = match lc.as_str() {
        "en" | "english" => "English",
        "tr" | "turkish" => "Turkish (Türkçe)",
        "de" | "german" => "German (Deutsch)",
        "fr" | "french" => "French (Français)",
        "es" | "spanish" => "Spanish (Español)",
        "it" | "italian" => "Italian (Italiano)",
        "pt" | "portuguese" => "Portuguese (Português)",
        "nl" | "dutch" => "Dutch (Nederlands)",
        "pl" | "polish" => "Polish (Polski)",
        "ru" | "russian" => "Russian (Русский)",
        "uk" | "ukrainian" => "Ukrainian (Українська)",
        "ja" | "japanese" => "Japanese (日本語)",
        "ko" | "korean" => "Korean (한국어)",
        "zh" | "chinese" | "zh-cn" => "Chinese (中文)",
        "ar" | "arabic" => "Arabic (العربية)",
        "he" | "hebrew" => "Hebrew (עברית)",
        "hi" | "hindi" => "Hindi (हिन्दी)",
        // Free-form fallback: trust whatever the user typed. We lower-
        // case for the lookup but pass the original casing through to
        // the model so a custom value like "Klingon" still surfaces
        // legibly.
        _ => {
            return format!(
                "Respond in {}. Use the same language for headings, bullets, and code comments.",
                code.trim()
            )
        }
    };
    format!("Respond in {pretty}. Use the same language for headings, bullets, and code comments.",)
}

/// Inject a "Respond in X." directive into the first `system` message
/// of `messages`. Idempotent: if no directive applies (English / auto)
/// the messages are returned untouched. Adding the directive to the
/// SYSTEM message rather than the user message is deliberate — system
/// instructions outrank user content in every modern chat-tuned
/// model, so the language stays sticky even when the user later types
/// in a third language inside a chat panel.
pub fn apply_language_directive(messages: &mut [ChatMessage], directive: &str) {
    if directive.is_empty() {
        return;
    }
    if let Some(sys) = messages.iter_mut().find(|m| m.role == "system") {
        sys.content.push_str("\n\n");
        sys.content.push_str(directive);
    }
    // No system message present: we silently no-op rather than
    // panicking on slice mutation, since this fn only borrows a
    // `&mut [ChatMessage]`. Callers that own the Vec should prefer
    // `apply_language_to_vec` below.
}

/// Vec-owning sibling of [`apply_language_directive`] that prepends a
/// system message when the input has none. Most prompt builders return
/// `vec![system, user]` so the slice version is enough, but the chat
/// panel forwards arbitrary user histories through and needs this.
pub fn apply_language_to_vec(messages: &mut Vec<ChatMessage>, directive: &str) {
    if directive.is_empty() {
        return;
    }
    if let Some(sys) = messages.iter_mut().find(|m| m.role == "system") {
        sys.content.push_str("\n\n");
        sys.content.push_str(directive);
        return;
    }
    messages.insert(0, ChatMessage::system(directive.to_string()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    /// Model the server actually used. Some gateways (OpenRouter, etc.)
    /// remap requested models — we surface the actual one for the
    /// "Generated by …" footer.
    #[serde(default)]
    pub model: Option<String>,
    /// Token usage when the provider reports it. Optional because many
    /// OpenAI-compatible servers (Ollama, LM Studio) omit `usage`.
    #[serde(default)]
    pub prompt_tokens: Option<u32>,
    #[serde(default)]
    pub completion_tokens: Option<u32>,
}

/// Result of a "Test connection" probe — short, structured, never
/// blocking the UI. We keep `latency_ms` separate from `model_echo`
/// because some local providers ship empty content even on a healthy
/// 200, which would otherwise make the green-check feel flaky.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

fn build_headers(provider: &AiProvider) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    // The API key is optional: local servers (Ollama, LM Studio,
    // llama.cpp) don't need one, and self-hosted gateways may sit
    // behind their own auth proxy. Only attach the Authorization
    // header when the user actually provided a key — otherwise we'd
    // turn `Bearer ` (literal empty) into a 401 reason.
    let key = provider.api_key.trim();
    if !key.is_empty() {
        let bearer = format!("Bearer {key}");
        let auth = HeaderValue::from_str(&bearer)
            .map_err(|_| AppError::Invalid("API key contains invalid header characters".into()))?;
        headers.insert(AUTHORIZATION, auth);
    }
    Ok(headers)
}

/// Talk to the provider's `/chat/completions` endpoint and return a
/// flattened, UI-friendly response. Errors are mapped to [`AppError`]
/// so callers don't have to know about reqwest types.
pub async fn chat_completion(
    provider: &AiProvider,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
) -> AppResult<ChatResponse> {
    if provider.model.trim().is_empty() {
        return Err(AppError::Invalid(
            "Model name is empty for this provider".into(),
        ));
    }
    if provider.base_url.trim().is_empty() {
        return Err(AppError::Invalid(
            "Base URL is empty for this provider".into(),
        ));
    }

    // 60s is a deliberate ceiling: long enough for slow local models
    // (Ollama on a cold load) but short enough that a wedged endpoint
    // doesn't lock the UI behind a spinner indefinitely. The UI should
    // surface a "took too long, try again" toast rather than waiting.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other(format!("http client init failed: {e}")))?;

    let mut body = serde_json::json!({
        "model": provider.model,
        "messages": messages,
        "stream": false,
    });
    if let Some(temp) = options.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = provider.resolve_max_tokens(options.max_tokens) {
        body["max_tokens"] = serde_json::json!(max);
    }

    let url = provider.chat_url();
    let resp = client
        .post(&url)
        .headers(build_headers(provider)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request to {url} failed: {e}")))?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("failed reading response body: {e}")))?;

    if !status.is_success() {
        // Try to extract a friendly `error.message` from the OpenAI
        // error schema first; if the body isn't JSON we just surface
        // the raw text (truncated to keep error toasts sane).
        let friendly = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| {
                let mut s = raw.clone();
                if s.len() > 500 {
                    s.truncate(500);
                    s.push('…');
                }
                s
            });
        return Err(AppError::Other(format!(
            "AI provider returned {status}: {friendly}"
        )));
    }

    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("invalid JSON from provider: {e}")))?;

    let content = parsed
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let model = parsed
        .get("model")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());

    let usage = parsed.get("usage");
    let prompt_tokens = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let completion_tokens = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    Ok(ChatResponse {
        content,
        model,
        prompt_tokens,
        completion_tokens,
    })
}

/// Tiny ping that exercises the full request path (auth headers,
/// network, JSON shape) without burning real tokens. We send a single
/// `"ping"` user message with `max_tokens: 5` and report latency. Any
/// 2xx counts as success even if the model returns empty content,
/// because some local providers (LM Studio in particular) sometimes
/// return zero-content completions for very short prompts.
pub async fn test_provider(provider: &AiProvider) -> AppResult<TestResult> {
    let start = std::time::Instant::now();
    let res = chat_completion(
        provider,
        vec![
            ChatMessage::system("You are a healthcheck. Reply with the single word OK."),
            ChatMessage::user("ping"),
        ],
        ChatOptions {
            temperature: Some(0.0),
            max_tokens: Some(5),
        },
    )
    .await;
    let latency_ms = start.elapsed().as_millis() as u64;
    match res {
        Ok(r) => Ok(TestResult {
            ok: true,
            latency_ms,
            model: r.model,
            message: if r.content.trim().is_empty() {
                Some("Connected (empty response body).".into())
            } else {
                Some(r.content.trim().to_string())
            },
        }),
        Err(e) => Ok(TestResult {
            ok: false,
            latency_ms,
            model: None,
            message: Some(e.to_string()),
        }),
    }
}

// ---------------------------------------------------------------------------
// Commit message generation
// ---------------------------------------------------------------------------

/// Maximum diff payload we'll send to the LLM. Big monorepo commits can
/// blow past 100k tokens easily; truncating here keeps cost predictable
/// AND avoids 400 "context too long" errors that'd otherwise look like
/// a RunHQ bug. We truncate from the END since the diff header (file
/// list) is the most informative chunk when context is scarce.
const MAX_DIFF_CHARS: usize = 16_000;

fn truncate_for_prompt(diff: &str) -> String {
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
    // Honour the provider's preferred response language uniformly with
    // the streaming surfaces. If the team's convention is English-only
    // commits, the user picks English (or "Auto") in provider settings;
    // if they prefer commits in their native tongue, that's their call,
    // not ours.
    if let Some(directive) = provider.language_directive() {
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

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/// One chunk of a streaming AI response.
///
/// The variant tags are flat (no nesting) on purpose: the desktop
/// shell forwards these straight over a Tauri `Channel<StreamChunk>`
/// to the React side, and a flat tagged union maps cleanly to a
/// TypeScript discriminated union without any custom serde tomfoolery.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamChunk {
    /// A token (or token group) of the model's actual answer.
    /// Frontends should append `text` to whatever they're currently
    /// rendering as the response body.
    Delta { text: String },
    /// A token (or token group) of the model's chain-of-thought /
    /// reasoning trace. We split this from `Delta` because reasoning
    /// models (DeepSeek-R1, GLM-4.x, Qwen-QwQ, OpenAI o-series) emit
    /// pages of internal monologue that the user typically wants
    /// hidden behind a collapsible toggle. Sources we recognise:
    ///   - `delta.reasoning_content` (DeepSeek, GLM, Together)
    ///   - `delta.reasoning` (OpenRouter normalised, OpenAI o-series)
    ///   - `<think>...</think>` blocks inside `delta.content` (Qwen
    ///     QwQ, R1 distills shipping over plain `content`)
    Reasoning { text: String },
    /// Move all previously-emitted [`StreamChunk::Delta`] tokens
    /// into the reasoning bucket. Fired when the splitter sees a
    /// closing `</think>` tag without ever seeing a matching
    /// opener — a pattern used by reasoning models served behind
    /// proxies that strip the opener but pass the closer through
    /// (OpenRouter normalisation is the most common case). The
    /// frontend reducer concats `text` onto `reasoning` and resets
    /// `text` to the empty string.
    ReclassifyAsReasoning,
    /// The stream completed cleanly. Carries the fully-accumulated
    /// content (so callers don't have to re-stitch it themselves)
    /// and the usage block when the provider reported it.
    Done {
        content: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt_tokens: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        completion_tokens: Option<u32>,
        /// Why the model stopped generating, as reported by the
        /// provider (`finish_reason` on OpenAI-compatible APIs).
        ///
        /// The values we explicitly act on:
        ///   - `"stop"` — the model decided it was done.
        ///   - `"length"` — generation hit `max_tokens` (or the
        ///     model's context cap). The answer is **truncated**;
        ///     the UI must surface this so the user doesn't think
        ///     the assistant gave up mid-sentence. A "Continue"
        ///     affordance is the standard remedy.
        ///   - `"content_filter"` — provider safety filter tripped.
        ///   - `null` — provider didn't report (some local servers).
        ///
        /// We keep this as a free-form `Option<String>` rather than
        /// an enum so adding a new finish reason on the frontend
        /// doesn't require a backend release. The whole point is
        /// to never silently swallow a truncation event again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish_reason: Option<String>,
    },
    /// A provider-side error (4xx/5xx, malformed SSE, network blip).
    /// We funnel transport failures through the same channel so the
    /// UI has a single subscribe-and-render path.
    Error { message: String },
}

/// Grace window for trailing chunks (usage / `[DONE]`) AFTER the
/// provider emits its first non-null `finish_reason`. Some servers
/// finish the answer, send `finish_reason: "stop"`, and then **never
/// close the stream** — they sit on the open TCP socket with no
/// further bytes. Without this cap we'd block on `chunk()` until
/// reqwest's 5-min top-level timeout fires; with it we close the
/// stream ourselves after 1.5s of post-finish silence.
const FINISH_GRACE: Duration = Duration::from_millis(1500);

/// Content-progress idle window when the model has NOT started
/// emitting answer tokens yet. Allows reasoning-heavy models to
/// churn through long `<think>` blocks (typical worst case ~20s
/// between visible reasoning bursts on Qwen3-thinking / GLM-5
/// "deep thought" prompts). 30s gives that headroom without
/// stranding the user on a true cold-stall.
pub(crate) const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// Content-progress idle window AFTER at least one answer-token has
/// reached the client. Once tokens are flowing we expect them to
/// keep flowing — 12s of silence is essentially always an upstream
/// stall (the user's GLM-5.1 MaaS gateway is the canonical example:
/// emits ~5 tokens, then flatlines while keeping the TCP connection
/// alive with SSE keepalives). Tight window means the failure
/// surfaces quickly so auto-retry can kick in before the user gives
/// up on the answer.
pub(crate) const STREAM_ACTIVE_IDLE_TIMEOUT: Duration = Duration::from_secs(12);

/// Pure helper: how long should we wait for the next byte given the
/// current stream state? Extracted from [`chat_completion_stream`] so
/// the policy is unit-testable without standing up a fake SSE server.
///
/// Returns the budget for the **whole** content-progress window — the
/// caller subtracts `last_progress_at.elapsed()` from this to get the
/// remaining wait time. We don't fold that subtraction in here so the
/// call site can short-circuit on `elapsed >= budget` (i.e. we've
/// already stalled and shouldn't even call `chunk()`).
pub(crate) fn idle_budget(answer_started: bool) -> Duration {
    if answer_started {
        STREAM_ACTIVE_IDLE_TIMEOUT
    } else {
        STREAM_IDLE_TIMEOUT
    }
}

/// SSE-aware sibling of [`chat_completion`]. Calls `on_chunk` for every
/// delta as it arrives and emits exactly one `Done` (or `Error`) at the
/// very end. The accumulated content is also returned in [`ChatResponse`]
/// so callers that only care about the final string can ignore the
/// callback and just `await` the future.
///
/// This function deliberately keeps the SSE parser in-house instead of
/// pulling `eventsource-stream`: the whole format is "lines beginning
/// with `data:` separated by blank lines, terminated by `data: [DONE]`",
/// and an extra crate is more surface than a 40-line state machine.
pub async fn chat_completion_stream<F>(
    provider: &AiProvider,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    mut on_chunk: F,
) -> AppResult<ChatResponse>
where
    F: FnMut(StreamChunk) + Send,
{
    if provider.model.trim().is_empty() {
        return Err(AppError::Invalid(
            "Model name is empty for this provider".into(),
        ));
    }
    if provider.base_url.trim().is_empty() {
        return Err(AppError::Invalid(
            "Base URL is empty for this provider".into(),
        ));
    }

    // Per-stream correlation id. Lets us follow one streaming
    // session across the (potentially noisy) tracing output —
    // when two chats run in parallel, or when auto-retry fires
    // a fresh stream, this is what disambiguates them. Short
    // hex prefix is enough for readability; full uuids are
    // overkill for log correlation in a single process.
    let stream_id = uuid::Uuid::new_v4().simple().to_string();
    let stream_id = &stream_id[..8];
    tracing::debug!(
        stream_id = %stream_id,
        provider = %provider.name,
        model = %provider.model,
        message_count = messages.len(),
        max_tokens = ?provider.resolve_max_tokens(options.max_tokens),
        "ai.stream.begin",
    );

    // 5-minute ceiling for the whole stream — long enough for slow
    // local models on a cold load, short enough that a wedged endpoint
    // doesn't lock the UI forever. We rely on per-chunk timeouts (none
    // explicit, but reqwest's default keep-alive handling) to surface
    // mid-stream stalls.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Other(format!("http client init failed: {e}")))?;

    let mut body = serde_json::json!({
        "model": provider.model,
        "messages": messages,
        "stream": true,
    });
    if let Some(temp) = options.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = provider.resolve_max_tokens(options.max_tokens) {
        body["max_tokens"] = serde_json::json!(max);
    }
    // Some providers (OpenAI, OpenRouter) only emit a final `usage`
    // chunk when explicitly asked. Cheap insurance for our token
    // accounting; the providers that ignore the flag simply drop it.
    body["stream_options"] = serde_json::json!({ "include_usage": true });
    // Reasoning-routing flags ARE NOT universally tolerated. Local
    // OpenAI-compatible servers (vLLM, LM Studio, llama.cpp's
    // server) often reject unknown fields — especially the
    // `reasoning` object — with HTTP 400. We only opt in for
    // gateways that we know respect them. For everything else the
    // built-in `<think>...</think>` parser still extracts CoT from
    // the content stream.
    let base_lower = provider.base_url.to_lowercase();
    if base_lower.contains("openrouter.ai") {
        // OpenRouter respects both the legacy boolean and the
        // unified object form; sending both is belt-and-braces.
        body["include_reasoning"] = serde_json::json!(true);
        body["reasoning"] = serde_json::json!({ "exclude": false });
    }

    let url = provider.chat_url();
    let mut resp = client
        .post(&url)
        .headers(build_headers(provider)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request to {url} failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let raw = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("(failed reading body: {e})"));
        let friendly = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| {
                let mut s = raw;
                if s.len() > 500 {
                    s.truncate(500);
                    s.push('…');
                }
                s
            });
        let message = format!("AI provider returned {status}: {friendly}");
        on_chunk(StreamChunk::Error {
            message: message.clone(),
        });
        return Err(AppError::Other(message));
    }

    let mut buf: Vec<u8> = Vec::new();
    let mut accumulated = String::new();
    let mut accumulated_reasoning = String::new();
    let mut model: Option<String> = None;
    let mut prompt_tokens: Option<u32> = None;
    let mut completion_tokens: Option<u32> = None;
    // Why the model stopped. Captured from the LAST delta that
    // reports a non-null `finish_reason` (OpenAI emits it once,
    // on the final `choices[0]`). We pin it to whatever wins last
    // because some servers ALSO send `finish_reason` on a usage-
    // only chunk after the content is closed — we want that one
    // if it's there.
    let mut finish_reason: Option<String> = None;
    // Stateful splitter for inline `<think>...</think>` blocks: some
    // chunks carry partial tags (`<thi` then `nk>` next), so we have
    // to remember whether we're currently inside a reasoning block
    // and a small look-ahead buffer for partial open/close tags.
    let mut think = ThinkState::default();

    // Once the model emits a non-null `finish_reason`, the answer is
    // conceptually complete. The OpenAI spec says one more chunk
    // (carrying `usage` when `stream_options.include_usage` is set)
    // and then `[DONE]` will follow — within milliseconds. Local
    // servers (LM Studio, some Ollama loads) sometimes emit
    // `finish_reason` and then **never close the stream**, leaving
    // our `resp.chunk().await` blocked until the 5-min top-level
    // timeout fires. The user's UI shows a pulsing caret the whole
    // time — exactly the "bittiğini anlamıyor" symptom they
    // reported. We bound this with a short grace window: after
    // `finish_reason` lands, we give the server up to
    // `FINISH_GRACE` to send anything else (most importantly the
    // usage chunk and `[DONE]`); past that we close the stream
    // ourselves and emit `Done` with whatever we collected. This
    // costs us the post-finish usage chunk on hung servers (which
    // by definition wasn't going to arrive anyway), but never
    // hangs the UI.
    let mut finish_seen_at: Option<Instant> = None;

    // Tracks the last moment we emitted user-visible content. Seeded
    // to `now()` at start so the first IDLE_TIMEOUT window covers
    // model warm-up (cold-start latency on local LM Studio / Ollama
    // can hit 10s+ before the first byte). Updated by the helper
    // closure `mark_progress` defined below.
    let mut last_progress_at = Instant::now();

    // Tracks whether at least one answer-token delta has reached the
    // client. Flips us from `IDLE_TIMEOUT` to the tighter
    // `ACTIVE_IDLE_TIMEOUT` (see constants above) — once tokens are
    // flowing we expect them to keep flowing, so silence is more
    // suspicious. Reasoning-only deltas don't count: a model can
    // legitimately spend 30s+ deep in `<think>` before the first
    // answer token, and we don't want to kill that.
    let mut answer_started = false;
    // Set to `true` if we exit the loop because content progress
    // stalled (no `Delta`/`Reasoning` for the active window).
    // Surfaced through `finish_reason` so the UI can show a clear
    // "stream stalled" banner instead of pretending the model
    // finished happily.
    let mut idle_timed_out = false;

    // Labeled outer loop so we can `break 'outer` from the inner SSE
    // parser the moment we see `[DONE]` instead of looping back to
    // `resp.chunk().await` for one more (always empty) read. That
    // extra read shows up in some servers' logs as "Client
    // disconnected. Stopping generation" — alarming the user even
    // though the run completed cleanly. Breaking immediately keeps
    // the close-handshake one-sided and the logs clean.
    'outer: loop {
        // Decide how long to wait for the next byte. Three regimes:
        //
        //   * Post-finish (we've seen `finish_reason`): cap at the
        //     remaining grace window; bail immediately when exhausted.
        //     Keeps hung post-finish servers from blocking the UI.
        //   * Pre-finish: cap at the remaining content-progress
        //     budget — `(ACTIVE_)IDLE_TIMEOUT - elapsed_since_progress`.
        //     If that's already <= 0 we declare a stall right away.
        //
        // The content-progress regime survives keepalives: each
        // keepalive byte returns from `chunk()` and gets parsed,
        // but doesn't update `last_progress_at`, so the next call
        // to this branch sees less remaining budget. Eventually
        // the budget hits zero and we bail.
        let bytes_opt = match finish_seen_at {
            None => {
                let budget = idle_budget(answer_started);
                let elapsed = last_progress_at.elapsed();
                if elapsed >= budget {
                    tracing::debug!(
                        stream_id = %stream_id,
                        budget_ms = budget.as_millis() as u64,
                        elapsed_ms = elapsed.as_millis() as u64,
                        answer_started,
                        body_len = accumulated.len(),
                        reasoning_len = accumulated_reasoning.len(),
                        "ai.stream.idle_timeout (entry)",
                    );
                    idle_timed_out = true;
                    break 'outer;
                }
                let remaining = budget - elapsed;
                match tokio::time::timeout(remaining, resp.chunk()).await {
                    Ok(Ok(opt)) => opt,
                    Ok(Err(e)) => {
                        tracing::warn!(
                            stream_id = %stream_id,
                            error = %e,
                            "ai.stream.read_error",
                        );
                        return Err(AppError::Other(format!("streaming read failed: {e}")));
                    }
                    Err(_) => {
                        tracing::debug!(
                            stream_id = %stream_id,
                            remaining_ms = remaining.as_millis() as u64,
                            answer_started,
                            body_len = accumulated.len(),
                            reasoning_len = accumulated_reasoning.len(),
                            "ai.stream.idle_timeout (chunk wait)",
                        );
                        idle_timed_out = true;
                        break 'outer;
                    }
                }
            }
            Some(seen) => {
                let elapsed = seen.elapsed();
                if elapsed >= FINISH_GRACE {
                    tracing::debug!(
                        stream_id = %stream_id,
                        elapsed_ms = elapsed.as_millis() as u64,
                        "ai.stream.finish_grace_expired (entry)",
                    );
                    break 'outer;
                }
                let remaining = FINISH_GRACE - elapsed;
                match tokio::time::timeout(remaining, resp.chunk()).await {
                    Ok(Ok(opt)) => opt,
                    Ok(Err(e)) => {
                        tracing::warn!(
                            stream_id = %stream_id,
                            error = %e,
                            "ai.stream.read_error (post-finish)",
                        );
                        return Err(AppError::Other(format!("streaming read failed: {e}")));
                    }
                    // Grace expired with no further bytes: server
                    // is hung post-finish. Bail with what we have.
                    Err(_) => {
                        tracing::debug!(
                            stream_id = %stream_id,
                            "ai.stream.finish_grace_expired (chunk wait)",
                        );
                        break 'outer;
                    }
                }
            }
        };
        let bytes = match bytes_opt {
            Some(b) => b,
            // Stream ended cleanly (TCP close) — exit the loop and
            // run the normal flush path below.
            None => {
                tracing::debug!(
                    stream_id = %stream_id,
                    body_len = accumulated.len(),
                    reasoning_len = accumulated_reasoning.len(),
                    finish_reason = ?finish_reason,
                    "ai.stream.tcp_close",
                );
                break 'outer;
            }
        };
        tracing::trace!(
            stream_id = %stream_id,
            byte_count = bytes.len(),
            "ai.stream.bytes",
        );
        buf.extend_from_slice(&bytes);

        while let Some((event_end, sep_len)) = find_event_boundary(&buf) {
            let event_bytes: Vec<u8> = buf.drain(..event_end).collect();
            buf.drain(..sep_len);

            let event = match std::str::from_utf8(&event_bytes) {
                Ok(s) => s,
                Err(_) => continue, // skip malformed chunk rather than tearing down the stream
            };

            // An SSE event is one or more `data:` lines (concatenated
            // by the spec) plus comment lines starting with `:`. We
            // accept either format and stitch multi-line `data:`
            // payloads back together with `\n` separators.
            let mut data = String::new();
            for line in event.lines() {
                if line.starts_with(':') || line.is_empty() {
                    continue;
                }
                if let Some(rest) = line.strip_prefix("data:") {
                    let v = rest.strip_prefix(' ').unwrap_or(rest);
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(v);
                }
            }
            if data.is_empty() {
                continue;
            }
            if data.trim() == "[DONE]" {
                tracing::debug!(
                    stream_id = %stream_id,
                    body_len = accumulated.len(),
                    reasoning_len = accumulated_reasoning.len(),
                    finish_reason = ?finish_reason,
                    "ai.stream.done_marker",
                );
                break 'outer;
            }
            let parsed: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(e) => {
                    tracing::trace!(
                        stream_id = %stream_id,
                        error = %e,
                        sample = %data.chars().take(120).collect::<String>(),
                        "ai.stream.parse_skip",
                    );
                    continue;
                }
            };

            // OpenAI compatibility note: a single chunk can include
            // both a `delta.content` token AND the final `usage`
            // block (when `include_usage: true`). We don't `continue`
            // after extracting one — both fields below are independent
            // best-effort reads.
            let delta = parsed
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("delta"));

            // Reasoning emitted on a separate field, the well-behaved
            // path. DeepSeek and GLM use `reasoning_content`; OpenAI
            // o-series and OpenRouter's normalised stream use
            // `reasoning`. We accept either.
            for key in ["reasoning_content", "reasoning"] {
                if let Some(r) = delta.and_then(|d| d.get(key)).and_then(|c| c.as_str()) {
                    if !r.is_empty() {
                        accumulated_reasoning.push_str(r);
                        // Reasoning is genuine forward progress —
                        // refresh the idle timer so a long `<think>`
                        // phase doesn't get killed by the pre-answer
                        // window.
                        last_progress_at = Instant::now();
                        on_chunk(StreamChunk::Reasoning {
                            text: r.to_string(),
                        });
                    }
                }
            }

            if let Some(content) = delta
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
            {
                if !content.is_empty() {
                    // Split the chunk into reasoning vs. answer based
                    // on `<think>...</think>` markers. For models that
                    // don't use `<think>` this is a pass-through
                    // (everything ends up as `Delta`). Stateful: tags
                    // can split across chunks.
                    let parts = think.feed(content);
                    for part in parts {
                        match part {
                            ThinkPart::Reasoning(s) if !s.is_empty() => {
                                accumulated_reasoning.push_str(&s);
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::Reasoning { text: s });
                            }
                            ThinkPart::Answer(s) if !s.is_empty() => {
                                accumulated.push_str(&s);
                                answer_started = true;
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::Delta { text: s });
                            }
                            ThinkPart::ReclassifyAsReasoning => {
                                // Move everything we've emitted as
                                // an answer so far into the
                                // reasoning bucket. Frontend mirrors
                                // this exact transformation. Counts
                                // as progress: the model is mutating
                                // its previous output, which is
                                // forward motion even if no new
                                // tokens were produced this iteration.
                                accumulated_reasoning.push_str(&accumulated);
                                accumulated.clear();
                                last_progress_at = Instant::now();
                                on_chunk(StreamChunk::ReclassifyAsReasoning);
                            }
                            _ => {}
                        }
                    }
                }
            }

            if model.is_none() {
                if let Some(m) = parsed.get("model").and_then(|m| m.as_str()) {
                    model = Some(m.to_string());
                }
            }
            // `finish_reason` lives on `choices[0]` (NOT inside
            // `delta`). It's `null` on every chunk except the final
            // one. We keep the most recent non-null value, since
            // some providers re-emit it on a trailing usage chunk.
            //
            // The first non-null `finish_reason` also arms the
            // grace timer that bounds how long we'll wait for the
            // post-finish `usage` + `[DONE]` chunks. Without this,
            // a hung-but-finished local server would leave us
            // blocked on the next `resp.chunk()` call indefinitely.
            if let Some(fr) = parsed
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("finish_reason"))
                .and_then(|v| v.as_str())
            {
                if !fr.is_empty() {
                    let was_seen = finish_seen_at.is_some();
                    finish_reason = Some(fr.to_string());
                    if !was_seen {
                        finish_seen_at = Some(Instant::now());
                        tracing::debug!(
                            stream_id = %stream_id,
                            finish_reason = %fr,
                            body_len = accumulated.len(),
                            reasoning_len = accumulated_reasoning.len(),
                            "ai.stream.finish_reason_seen",
                        );
                    }
                }
            }
            if let Some(usage) = parsed.get("usage") {
                if let Some(p) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                    prompt_tokens = Some(p as u32);
                }
                if let Some(c) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                    completion_tokens = Some(c as u32);
                }
            }
        }
    }

    // Flush any leftover characters held in the `<think>` look-ahead
    // buffer. This handles the rare case where a model closes the
    // stream without emitting `</think>` — we still surface what we
    // captured so the UI doesn't silently lose tokens.
    if let Some(tail) = think.flush() {
        match tail {
            ThinkPart::Reasoning(s) if !s.is_empty() => {
                accumulated_reasoning.push_str(&s);
                on_chunk(StreamChunk::Reasoning { text: s });
            }
            ThinkPart::Answer(s) if !s.is_empty() => {
                accumulated.push_str(&s);
                on_chunk(StreamChunk::Delta { text: s });
            }
            // Flush should never produce Reclassify (it's emitted
            // mid-stream when </think> is seen), but cover it for
            // exhaustiveness.
            ThinkPart::ReclassifyAsReasoning => {
                accumulated_reasoning.push_str(&accumulated);
                accumulated.clear();
                on_chunk(StreamChunk::ReclassifyAsReasoning);
            }
            _ => {}
        }
    }

    let reasoning_summary = if accumulated_reasoning.is_empty() {
        None
    } else {
        Some(accumulated_reasoning.clone())
    };
    // If we bailed via the idle-timeout escape hatch and the server
    // never sent its own `finish_reason`, synthesise one. This is
    // the signal that drives the UI's "stream stalled" affordance —
    // distinct from a clean `"stop"` so the user knows whether to
    // re-prompt vs. trust the partial answer.
    let effective_finish_reason = match finish_reason.clone() {
        Some(fr) => Some(fr),
        None if idle_timed_out => Some("timeout".to_string()),
        None => None,
    };
    tracing::debug!(
        stream_id = %stream_id,
        finish_reason = ?effective_finish_reason,
        body_len = accumulated.len(),
        reasoning_len = accumulated_reasoning.len(),
        prompt_tokens = ?prompt_tokens,
        completion_tokens = ?completion_tokens,
        idle_timed_out,
        "ai.stream.end",
    );
    on_chunk(StreamChunk::Done {
        content: accumulated.clone(),
        reasoning: reasoning_summary,
        model: model.clone(),
        prompt_tokens,
        completion_tokens,
        finish_reason: effective_finish_reason,
    });

    Ok(ChatResponse {
        content: accumulated,
        model,
        prompt_tokens,
        completion_tokens,
    })
}

/// One slice of a `<think>`-aware split: either reasoning text,
/// answer text, or a marker that everything previously classified
/// as answer was actually reasoning. Strings are owned because the
/// splitter has to hold them across stream chunks anyway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThinkPart {
    Reasoning(String),
    Answer(String),
    /// "Naked close" marker: we saw `</think>` without ever seeing
    /// a matching `<think>`. The caller should treat all content
    /// emitted as `Answer` up to this point as reasoning instead.
    /// Common pattern in reasoning models routed through proxies
    /// that strip the opener (OpenRouter normalisation, certain
    /// vLLM deployments) but pass the closer through unchanged.
    ReclassifyAsReasoning,
}

/// Stateful splitter that consumes streamed `delta.content` strings
/// and yields [`ThinkPart`]s, separating any `<think>...</think>`
/// blocks from the surrounding answer text.
///
/// Why stateful: a single `<think>` open or `</think>` close tag can
/// straddle two streamed chunks (`<thi` then `nk>`), so a naive
/// per-chunk find/replace would leak the angle brackets into the
/// rendered answer. We keep at most a handful of bytes in `pending`
/// to survive that look-ahead while never holding back legitimate
/// content longer than necessary.
#[derive(Debug, Default)]
pub struct ThinkState {
    in_think: bool,
    /// True once we've seen any `<think>` opener (or already fired
    /// the naked-close reclassification). Used to gate the naked
    /// close behaviour so it triggers at most once per stream.
    seen_open: bool,
    /// True once we've fired a SCRATCHPAD-marker reclassification.
    /// Some smaller models ignore the "no internal monologue"
    /// directive and dump their planning into the answer with
    /// headings like `Drafting the Response`, `Internal Monologue`,
    /// or a leading `Final Answer:` line. The first time we spot
    /// one of those markers we reclassify everything before it as
    /// reasoning. We only fire once per stream because the same
    /// phrase can recur naturally inside a long answer (e.g. a
    /// retrospective bullet that quotes the marker), and we don't
    /// want to delete real content the second time around.
    seen_scratchpad: bool,
    /// Buffered tail of the most recent chunk that *might* be the
    /// start of an open/close tag. Flushed downstream once we know
    /// it isn't (or once a tag completes).
    pending: String,
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Phrases that strongly signal the model is still in scratchpad
/// mode and is about to (or did) emit the actual answer below.
/// Matched case-insensitively. Each entry is rare enough in genuine
/// engineering prose that hitting one is overwhelming evidence the
/// prefix above it was the model thinking out loud.
///
/// We deliberately list "drafting the …" with several object words
/// rather than relying on a single canonical phrase: small models
/// freely substitute the noun (`Response` → `Content` / `Standup` /
/// `Answer` / `Explanation` / `Output`) while keeping the same
/// scratchpad template. Any one of these variants triggers the same
/// reclassification, so the user sees the same clean answer flow no
/// matter which noun the model picked today.
const SCRATCHPAD_MARKERS: &[&str] = &[
    // "Drafting the …" family — most common scratchpad-end heading
    // emitted by 3B-class instruct models walking through a plan.
    "drafting the response",
    "drafting the content",
    "drafting the answer",
    "drafting the standup",
    "drafting the explanation",
    "drafting the triage",
    "drafting the output",
    "drafting the message",
    "drafting the reply",
    "drafting response",
    // Bare "Drafting:" / explicit monologue label.
    "drafting:",
    "internal monologue",
    // Explicit "this is the final answer" labels — rare in good
    // prose, common as a scratchpad-to-answer hinge.
    "final answer:",
    "**final answer:**",
    "**final answer**",
];

/// Locate the earliest scratchpad marker in `buf` (case-insensitive).
/// Returns the byte offset and length of the matched marker in the
/// ORIGINAL casing, since we slice back into `buf` with that offset.
fn find_scratchpad_marker(buf: &str) -> Option<(usize, usize)> {
    // Lowercase the buffer once, but track byte offsets that map back
    // 1:1 to the original because `to_lowercase()` can change byte
    // lengths for non-ASCII chars. The markers are pure ASCII, so we
    // cheat: do an ASCII-lower compare per byte instead of allocating.
    // This keeps offsets identical between the search view and `buf`.
    let bytes = buf.as_bytes();
    let mut best: Option<(usize, usize)> = None;
    for marker in SCRATCHPAD_MARKERS {
        let m = marker.as_bytes();
        if m.len() > bytes.len() {
            continue;
        }
        for i in 0..=bytes.len() - m.len() {
            let mut hit = true;
            for j in 0..m.len() {
                if bytes[i + j].to_ascii_lowercase() != m[j] {
                    hit = false;
                    break;
                }
            }
            if hit {
                if best.map_or(true, |(b, _)| i < b) {
                    best = Some((i, m.len()));
                }
                break;
            }
        }
    }
    best
}

impl ThinkState {
    /// Feed the next streamed content slice and receive zero or more
    /// classified parts. The slice is consumed in order; partial tag
    /// fragments are held in `self.pending` until they either
    /// complete or are disproven.
    pub fn feed(&mut self, chunk: &str) -> Vec<ThinkPart> {
        let mut buf = std::mem::take(&mut self.pending);
        buf.push_str(chunk);
        let mut out: Vec<ThinkPart> = Vec::new();

        loop {
            if self.in_think {
                // Looking for </think>. Emit everything up to (but
                // not including) the close tag as Reasoning.
                if let Some(idx) = buf.find(THINK_CLOSE) {
                    if idx > 0 {
                        out.push(ThinkPart::Reasoning(buf[..idx].to_string()));
                    }
                    buf = buf[idx + THINK_CLOSE.len()..].to_string();
                    self.in_think = false;
                    continue;
                }
                // No close yet — emit what we have, but withhold the
                // last few chars in case they're a partial `</think>`.
                let safe = safe_emit_len(&buf, THINK_CLOSE);
                if safe > 0 {
                    out.push(ThinkPart::Reasoning(buf[..safe].to_string()));
                    buf = buf[safe..].to_string();
                }
                break;
            } else {
                // Scratchpad-marker reclassification (fires once).
                // Some small models ignore the "no monologue" prompt
                // directive and dump their planning into the answer
                // body with headings like `Drafting the Response` or
                // `Final Answer:`. When we spot one we move every
                // emitted-as-answer chunk so far into the reasoning
                // bucket and drop the marker line itself, so the
                // user sees only the actual answer that comes next.
                //
                // We do this BEFORE the <think> tag scan because the
                // marker signals "the answer starts now" — there's
                // no point waiting around for a `<think>` opener that
                // the model is never going to emit.
                if !self.seen_scratchpad {
                    if let Some((m_idx, m_len)) = find_scratchpad_marker(&buf) {
                        let after_marker = &buf[m_idx + m_len..];
                        if let Some(nl_idx) = after_marker.find('\n') {
                            // Full marker line in the buffer. Push
                            // any pre-marker prose as Answer (so the
                            // caller's accumulated answer covers it
                            // before the reclassify fires), signal
                            // reclassify, then skip the entire
                            // marker line — including any trailing
                            // parenthetical the model added (e.g.
                            // `(Internal Monologue/Drafting):`).
                            if m_idx > 0 {
                                out.push(ThinkPart::Answer(buf[..m_idx].to_string()));
                            }
                            out.push(ThinkPart::ReclassifyAsReasoning);
                            buf = buf[m_idx + m_len + nl_idx + 1..].to_string();
                            self.seen_scratchpad = true;
                            // Suppress naked-close: the model has
                            // already given us its "scratchpad ends
                            // here" signal via this marker, and a
                            // later spurious `</think>` should not
                            // wipe out the answer we just rescued.
                            self.seen_open = true;
                            continue;
                        } else {
                            // Marker found but its line is still
                            // streaming. Emit pre-marker prose as
                            // answer (cheap to reclassify later if
                            // needed) and hold the marker fragment
                            // until the newline arrives.
                            if m_idx > 0 {
                                out.push(ThinkPart::Answer(buf[..m_idx].to_string()));
                                buf = buf[m_idx..].to_string();
                            }
                            break;
                        }
                    }
                }
                // Outside a <think> block. Look for whichever of
                // <think> or </think> appears first in this buffer.
                // The </think>-without-opener case is the "naked
                // close" pattern (proxy stripped the opener) — we
                // honour it by retroactively reclassifying.
                let open_idx = buf.find(THINK_OPEN);
                let close_idx = buf.find(THINK_CLOSE);
                let next = match (open_idx, close_idx) {
                    (Some(o), Some(c)) => {
                        if o < c {
                            Some((o, true))
                        } else {
                            Some((c, false))
                        }
                    }
                    (Some(o), None) => Some((o, true)),
                    (None, Some(c)) => Some((c, false)),
                    (None, None) => None,
                };

                if let Some((idx, is_open)) = next {
                    if is_open {
                        // <think> opener: prose before it is answer,
                        // we flip into reasoning for what follows.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        buf = buf[idx + THINK_OPEN.len()..].to_string();
                        self.seen_open = true;
                        self.in_think = true;
                        continue;
                    } else if !self.seen_open {
                        // </think> with no prior <think> — naked
                        // close. Push any pending text as answer
                        // first (so the reclassification covers it
                        // along with everything the caller already
                        // emitted), then signal reclassify, then
                        // resume in answer mode for content after.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        out.push(ThinkPart::ReclassifyAsReasoning);
                        buf = buf[idx + THINK_CLOSE.len()..].to_string();
                        self.seen_open = true;
                        continue;
                    } else {
                        // Stray </think> with the opener already
                        // consumed earlier in the stream. Drop the
                        // tag so it doesn't leak into the answer,
                        // emit surrounding prose as answer.
                        if idx > 0 {
                            out.push(ThinkPart::Answer(buf[..idx].to_string()));
                        }
                        buf = buf[idx + THINK_CLOSE.len()..].to_string();
                        continue;
                    }
                }

                // No tag found yet. Hold back any trailing bytes
                // that could be the start of either tag OR a
                // scratchpad marker (`Final Answer:`, `Drafting the
                // Response`, …). Without the marker holdback we'd
                // happily emit "Hello world\nFinal Answ" as answer
                // and only realise it was a marker on the next
                // chunk — too late to suppress the preview flash.
                let mut safe =
                    safe_emit_len(&buf, THINK_OPEN).min(safe_emit_len(&buf, THINK_CLOSE));
                if !self.seen_scratchpad {
                    safe = safe.saturating_sub(ends_with_partial_marker_ci(&buf[..safe]));
                }
                if safe > 0 {
                    out.push(ThinkPart::Answer(buf[..safe].to_string()));
                    buf = buf[safe..].to_string();
                }
                break;
            }
        }

        self.pending = buf;
        out
    }

    /// End-of-stream flush. Emits whatever's left in `pending` as
    /// either reasoning (if we were inside a `<think>` block when the
    /// stream closed) or answer (otherwise). Used to recover when a
    /// model forgets to emit a closing tag.
    pub fn flush(&mut self) -> Option<ThinkPart> {
        let tail = std::mem::take(&mut self.pending);
        if tail.is_empty() {
            return None;
        }
        Some(if self.in_think {
            ThinkPart::Reasoning(tail)
        } else {
            ThinkPart::Answer(tail)
        })
    }
}

/// How many bytes from the start of `buf` are safe to emit without
/// risking that we'd hand off a partial copy of `tag`. The pessimistic
/// answer: hold back up to `tag.len() - 1` trailing bytes that could
/// form a prefix of `tag`. We narrow this with an `ends_with_partial`
/// check so most chunks pass through unbuffered.
fn safe_emit_len(buf: &str, tag: &str) -> usize {
    let max_hold = tag.len().saturating_sub(1);
    if buf.len() <= max_hold {
        // The whole buffer might be a partial tag — hold all of it.
        if ends_with_partial(buf, tag) {
            return 0;
        }
        return buf.len();
    }
    // CRITICAL UTF-8 SAFETY: `buf` is model output and may contain
    // multi-byte characters (em-dash, smart quotes, emoji, CJK, etc.).
    // Slicing `&buf[buf.len() - max_hold..]` with a raw byte index
    // panics if that index lands in the middle of a UTF-8 codepoint.
    // We had a real-world panic on the input ` — dep` where max_hold
    // landed inside the em-dash (3 bytes), killing the tokio worker
    // and silently dropping the rest of the stream. Round the split
    // down to the nearest char boundary; this only ever holds back
    // *more* bytes than strictly necessary, never less, so tag-prefix
    // detection stays sound.
    let mut split = buf.len() - max_hold;
    while split > 0 && !buf.is_char_boundary(split) {
        split -= 1;
    }
    let candidate = &buf[split..];
    if ends_with_partial(candidate, tag) {
        split
    } else {
        buf.len()
    }
}

/// Number of trailing bytes in `s` that could be the leading prefix
/// of any [`SCRATCHPAD_MARKERS`] entry (case-insensitive). Returns 0
/// when no partial match is found, otherwise the longest matching
/// prefix length so the caller can hold back exactly those bytes.
///
/// We *require* the partial match to start at a word boundary — the
/// byte before the candidate must be ASCII whitespace, or the
/// candidate must be at the start of the buffer. Without this rule,
/// a buffer ending in "world" would match the 1-byte prefix "d" of
/// "drafting…" and we'd hold a byte back on every chunk forever,
/// breaking streaming. Real-world scratchpad markers always sit at
/// line start in model output, so the boundary check has no false
/// negatives in practice.
///
/// ASCII-only markers, so we lower per-byte without allocating.
fn ends_with_partial_marker_ci(s: &str) -> usize {
    if s.is_empty() {
        return 0;
    }
    let bytes = s.as_bytes();
    let mut max_hold = 0usize;
    for marker in SCRATCHPAD_MARKERS {
        let m = marker.as_bytes();
        // Cap the partial length at marker.len() - 1 — a full match
        // is the find_scratchpad_marker job, not the holdback path.
        let limit = m.len().saturating_sub(1).min(bytes.len());
        for n in (1..=limit).rev() {
            let tail_start = bytes.len() - n;
            // Word-boundary gate: candidate must begin at start of
            // buffer or immediately after whitespace.
            if tail_start > 0 && !bytes[tail_start - 1].is_ascii_whitespace() {
                continue;
            }
            let tail = &bytes[tail_start..];
            let mut hit = true;
            for j in 0..n {
                if tail[j].to_ascii_lowercase() != m[j] {
                    hit = false;
                    break;
                }
            }
            if hit {
                if n > max_hold {
                    max_hold = n;
                }
                break;
            }
        }
    }
    max_hold
}

/// True iff `s` ends with a non-empty proper prefix of `tag`. We
/// don't include the full `tag` here on purpose — a fully matched
/// tag is handled by the caller via `find`, so this only triggers
/// in the "could-still-grow-into-a-tag" look-ahead path.
fn ends_with_partial(s: &str, tag: &str) -> bool {
    let max = tag.len().min(s.len());
    for n in (1..=max).rev() {
        if s.ends_with(&tag[..n]) && &tag[..n] != tag {
            return true;
        }
    }
    false
}

/// Locate the end of the next complete SSE event in `buf`.
///
/// Returns `(event_end, separator_len)` such that `buf[..event_end]` is
/// the event payload (without the trailing blank-line separator) and
/// the next `separator_len` bytes are the separator itself. We match
/// both `\n\n` and `\r\n\r\n` because some HTTP intermediaries
/// (proxies, dev gateways) coerce LF to CRLF; missing the CRLF case
/// would silently buffer the entire stream.
fn find_event_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let len = buf.len();
    let mut i = 0;
    while i < len {
        if i + 4 <= len && &buf[i..i + 4] == b"\r\n\r\n" {
            return Some((i, 4));
        }
        if i + 2 <= len && &buf[i..i + 2] == b"\n\n" {
            return Some((i, 2));
        }
        i += 1;
    }
    None
}

// ---------------------------------------------------------------------------
// Prompt builders for non-commit surfaces
// ---------------------------------------------------------------------------

/// Char budget for a diff sent to the explainer. Smaller than the
/// commit-message budget because diff explanations don't need every
/// hunk to produce a useful summary; we'd rather drop late hunks than
/// blow past `max_tokens` and lose the response.
const MAX_EXPLAIN_DIFF_CHARS: usize = 12_000;
/// Char budget for a log-triage payload (focused error window). Logs
/// are line-noisy, so this is intentionally tight.
const MAX_LOG_TRIAGE_CHARS: usize = 6_000;
/// Char budget for the rendered advisory list passed to the triage
/// prompt. A scanned monorepo can easily produce 60+ advisories
/// (the user's `belgehub-mobile` had 64 in the canonical screenshot)
/// — at ~120 chars per row that's 7-8K of payload, comfortably
/// inside any modern model's context window. The cap exists so a
/// pathological 500-advisory result doesn't blow the budget for
/// wrapper text + reasoning room. We trim by *severity priority*
/// (critical/high first) when over budget so the model sees the
/// rows that matter most.
const MAX_ADVISORY_TRIAGE_CHARS: usize = 9_000;
/// Hard cap on advisories sent to the model regardless of char
/// budget. Keeps the worst-case prompt cost predictable on
/// pay-per-token hosted providers (60 rows * ~120 chars ≈ 7K chars
/// ≈ 1.8K tokens).
const MAX_ADVISORY_TRIAGE_ROWS: usize = 60;
/// Char budget for the workspace-analysis JSON facts blob. Each
/// project line is ~250-400 chars (name, runtime, status, CVE
/// counts, outdated counts, git, activity); 12K chars covers a
/// 30-40 project portfolio comfortably. Anything bigger and we
/// trust the frontend to have already trimmed via a "first N
/// projects by risk" pass — see `buildWorkspaceFacts`.
const MAX_WORKSPACE_FACTS_CHARS: usize = 12_000;

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
const NO_SCRATCHPAD_DIRECTIVE: &str = " \
    Output the final answer directly — no preamble, no analysis steps, no scratchpad. \
    Never write headings or bullets named \"Drafting the Response\", \"Drafting the Content\", \
    \"Drafting the Standup\", \"Drafting the Answer\", \"Drafting the Output\", \
    \"Internal Monologue\", \"Inference:\", \"Final Answer:\", \"Step 1:\", \
    \"Reasoning:\", \"Analysis:\", or \"Plan:\". \
    Never enumerate planning steps such as \"1. Reading the input\" or \"2. Identifying the change\". \
    Never narrate what you are about to do — just do it. \
    The very first character of your response must be the start of the actual answer.";

fn truncate_with_marker(s: &str, max: usize, marker: &str) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut out = s[..max].to_string();
    out.push_str("\n\n");
    out.push_str(marker);
    out
}

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

/// Compact representation of a security advisory for the triage
/// prompt. We deliberately don't reuse the dashboard's `Advisory`
/// type from `scanner` here — the prompt builder shouldn't depend
/// on the scanner crate, and frontend ships the rows over IPC anyway.
/// Field set is the union of "things the model needs to grade real
/// risk and propose a fix path": severity (importance), title (what
/// it actually does), package (where it sits in the dep graph),
/// vulnerable_range / fix_version (the upgrade math), id (so the
/// model can name the advisory in its answer).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AdvisoryBrief {
    /// `GHSA-…` / `CVE-…` identifier when the scanner has one.
    /// Optional because some pnpm/yarn scanners emit unidentified
    /// advisories — we still want to triage them.
    pub id: Option<String>,
    pub package: String,
    /// Lowercase severity (`critical`/`high`/`medium`/`low`/`info`),
    /// matching the dashboard's vocabulary. The prompt sorts on this.
    pub severity: String,
    pub title: String,
    pub vulnerable_range: Option<String>,
    pub fix_version: Option<String>,
}

impl AdvisoryBrief {
    /// One-line markdown rendering for the prompt body. Format pinned
    /// here so prompt + char-budget math stay aligned: changing the
    /// shape forces a corresponding `MAX_ADVISORY_TRIAGE_CHARS`
    /// recheck. Roughly 80–140 chars per row in practice.
    fn to_markdown_line(&self) -> String {
        let mut s = String::new();
        s.push_str("- ");
        s.push_str(&self.severity.to_uppercase());
        s.push_str(" · `");
        s.push_str(&self.package);
        s.push('`');
        if let Some(r) = self.vulnerable_range.as_deref() {
            if !r.is_empty() {
                s.push_str(" (vuln ");
                s.push_str(r);
                s.push(')');
            }
        }
        s.push_str(" — ");
        s.push_str(self.title.trim());
        let mut tail = Vec::<String>::new();
        if let Some(fv) = self.fix_version.as_deref() {
            if !fv.is_empty() {
                tail.push(format!("fix {fv}"));
            }
        }
        if let Some(id) = self.id.as_deref() {
            if !id.is_empty() {
                tail.push(id.to_string());
            }
        }
        if !tail.is_empty() {
            s.push_str(" [");
            s.push_str(&tail.join(", "));
            s.push(']');
        }
        s
    }
}

/// Severity rank for sorting. Returns a smaller number for "more
/// important" so the natural ascending sort puts criticals at the
/// top. Unknown severities sort last (5).
fn severity_rank(s: &str) -> u8 {
    match s.to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        "medium" | "moderate" => 2,
        "low" => 3,
        "info" | "informational" => 4,
        _ => 5,
    }
}

/// Prompt the model to triage a list of security advisories: which
/// ones are *actually* dangerous in this project's context, in what
/// order to fix them, and what to paste into the terminal. The user's
/// pain point with raw `npm audit` output is exactly the missing
/// signal-to-noise: a 64-row list with one CRITICAL buried under 41
/// HIGHs gives no actionable read. The model's job here is to rank
/// and group, not to invent CVE details — every fact in the answer
/// must come from the rows we send.
///
/// Trimming policy: when the rendered list exceeds either
/// [`MAX_ADVISORY_TRIAGE_ROWS`] or [`MAX_ADVISORY_TRIAGE_CHARS`], we
/// keep the highest-severity rows and drop the tail. The user
/// already filters by severity tile in the UI, so a "trimmed" payload
/// usually still contains the rows they cared about; the prompt
/// surfaces the trim explicitly so the model never claims to have
/// seen the whole list.
pub fn build_advisory_triage_prompt(
    advisories: &[AdvisoryBrief],
    project_name: Option<&str>,
    runtime: Option<&str>,
) -> Vec<ChatMessage> {
    let system_base = "You are a senior application-security engineer triaging a `npm audit`/`pip-audit`/`cargo audit` result for a working developer. \
                  Answer in GitHub-flavoured Markdown. Lead with **TL;DR** in one or two sentences naming the single most urgent action. \
                  Follow with a **Fix order** numbered list of at most six items; each item names the package, why it matters in plain English (DoS vs RCE vs prototype pollution vs path traversal — be specific to the advisory), and the exact upgrade or mitigation in backticks. \
                  Group multiple advisories on the same package into one item. \
                  If many advisories share a transitive parent, say so and recommend bumping the parent rather than each leaf. \
                  Add a final **Likely noise** section (one line) only when one or more rows are genuinely safe to defer (dev-only deps with no exposure, info-severity, etc.); otherwise omit the section. \
                  Never invent CVE details, packages, or fix versions that aren't in the supplied rows. \
                  When evidence is thin (no fix version, range unspecified) say so in one phrase rather than guessing. \
                  Keep total length under 300 words.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    // Sort by severity rank ascending (critical first) so when we
    // trim the tail, the dropped rows are the lowest-severity ones.
    // Stable sort preserves the scanner's original order within a
    // severity bucket — useful because `npm audit` already groups by
    // package and the model gets a slightly more coherent view.
    let mut sorted: Vec<AdvisoryBrief> = advisories.to_vec();
    sorted.sort_by_key(|a| severity_rank(&a.severity));

    // Apply the row cap before the char cap so a runaway scan
    // (1000+ advisories on a yarn-classic project) doesn't quadratic
    // its way through string allocation.
    let row_cap_hit = sorted.len() > MAX_ADVISORY_TRIAGE_ROWS;
    if row_cap_hit {
        sorted.truncate(MAX_ADVISORY_TRIAGE_ROWS);
    }

    // Render and apply char budget. We measure as we build so a
    // single oversized row (rare — title fields are usually short)
    // doesn't push us into a single-row payload that loses every
    // other CVE.
    let mut body = String::new();
    let mut included: usize = 0;
    let mut char_cap_hit = false;
    for adv in &sorted {
        let line = adv.to_markdown_line();
        if !body.is_empty() && body.len() + 1 + line.len() > MAX_ADVISORY_TRIAGE_CHARS {
            char_cap_hit = true;
            break;
        }
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(&line);
        included += 1;
    }

    let total = advisories.len();
    let mut user = String::new();
    user.push_str("Triage these dependency advisories.\n\n");
    if let Some(p) = project_name {
        if !p.is_empty() {
            user.push_str(&format!("Project: `{p}`\n"));
        }
    }
    if let Some(rt) = runtime {
        if !rt.is_empty() {
            user.push_str(&format!("Runtime: `{rt}`\n"));
        }
    }
    user.push_str(&format!("Advisories: {included}"));
    if included < total {
        user.push_str(&format!(
            " of {total} (lower-severity rows trimmed for length — your \
             ranking should explicitly note that the trimmed tail wasn't reviewed)"
        ));
    }
    if row_cap_hit {
        user.push_str(" [row cap]");
    }
    if char_cap_hit {
        user.push_str(" [char cap]");
    }
    user.push_str("\n\n```\n");
    user.push_str(&body);
    user.push_str("\n```\n\nNow rank and recommend.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

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
fn strip_message_artifacts(raw: &str) -> String {
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

#[cfg(test)]
mod tests {
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

    #[test]
    fn explain_diff_prompt_truncates_oversized_payload() {
        let big = "+".repeat(MAX_EXPLAIN_DIFF_CHARS + 5_000);
        let msgs = build_explain_diff_prompt(&big, Some("src/a.rs"), false);
        assert_eq!(msgs.len(), 2);
        let body = &msgs[1].content;
        assert!(body.contains("src/a.rs"));
        assert!(body.contains("[diff truncated"));
    }

    fn ad(sev: &str, pkg: &str) -> AdvisoryBrief {
        AdvisoryBrief {
            id: Some(format!("GHSA-{pkg}")),
            package: pkg.into(),
            severity: sev.into(),
            title: format!("{pkg} has a {sev} issue"),
            vulnerable_range: Some("<1.0.0".into()),
            fix_version: Some("1.0.0".into()),
        }
    }

    #[test]
    fn advisory_triage_prompt_sorts_critical_first() {
        let rows = vec![
            ad("low", "left-pad"),
            ad("critical", "lodash"),
            ad("medium", "axios"),
            ad("high", "ws"),
        ];
        let msgs = build_advisory_triage_prompt(&rows, Some("api"), Some("node"));
        assert_eq!(msgs.len(), 2);
        let body = &msgs[1].content;
        let critical_at = body.find("`lodash`").expect("critical row");
        let high_at = body.find("`ws`").expect("high row");
        let medium_at = body.find("`axios`").expect("medium row");
        let low_at = body.find("`left-pad`").expect("low row");
        // Severity ordering is the entire point — pin it.
        assert!(critical_at < high_at, "critical must precede high");
        assert!(high_at < medium_at, "high must precede medium");
        assert!(medium_at < low_at, "medium must precede low");
        assert!(body.contains("Project: `api`"));
        assert!(body.contains("Runtime: `node`"));
    }

    #[test]
    fn advisory_triage_prompt_trims_excess_rows_and_announces_it() {
        // 80 low-severity rows — well over MAX_ADVISORY_TRIAGE_ROWS.
        // We expect trim + an explicit "[row cap]" surface to the model.
        let rows: Vec<AdvisoryBrief> = (0..80).map(|i| ad("low", &format!("pkg-{i}"))).collect();
        let msgs = build_advisory_triage_prompt(&rows, None, None);
        let body = &msgs[1].content;
        assert!(body.contains("[row cap]"));
        // The header reports `Advisories: <included> of <total>` so
        // the model knows the prompt is partial. We don't pin the
        // exact `included` value — only that it's smaller than the
        // total and the "of 80" total is mentioned.
        assert!(body.contains("of 80"));
    }

    #[test]
    fn advisory_triage_prompt_handles_empty_input() {
        let msgs = build_advisory_triage_prompt(&[], None, None);
        // Even with zero rows we want a well-formed pair of
        // messages, not a panic. The downstream UI gates the call
        // on `advisories.len() > 0`, but defending against an empty
        // payload here is cheap insurance.
        assert_eq!(msgs.len(), 2);
        let body = &msgs[1].content;
        assert!(body.contains("Advisories: 0"));
    }

    #[test]
    fn workspace_report_prompt_carries_facts_blob() {
        let facts = r#"{"workspace":{"project_count":3,"running":1,"cve_critical":2},"projects":[{"name":"api","status":"running"}]}"#;
        let msgs = build_workspace_report_prompt(facts);
        assert_eq!(msgs.len(), 2);
        // System prompt must lock the four-section layout — that's
        // the contract the dashboard UI is building muscle memory
        // around. Reordering or renaming any of these would
        // silently regress the report's scanability.
        let sys = &msgs[0].content;
        assert!(sys.contains("**TL;DR**"));
        assert!(sys.contains("**Risk hotspots**"));
        assert!(sys.contains("**Quick wins**"));
        assert!(sys.contains("**Steady state**"));
        // User message must include the JSON blob inside a fenced
        // code block so the model sees it as a literal data
        // payload, not free prose.
        let user = &msgs[1].content;
        assert!(user.contains("```json"));
        assert!(user.contains("\"project_count\":3"));
    }

    #[test]
    fn workspace_report_prompt_truncates_oversized_facts() {
        // Build a payload safely above the 12K-char ceiling. The
        // tail-trim path is what saves the prompt from blowing the
        // model's context window on monorepo workspaces; a
        // regression here would mean a 200-project user pays
        // the full token bill on every regenerate.
        let big = format!("{{\"junk\":\"{}\"}}", "x".repeat(20_000));
        let msgs = build_workspace_report_prompt(&big);
        let user = &msgs[1].content;
        assert!(user.contains("[snapshot truncated"));
        // Sanity: we shouldn't be emitting a runaway prompt.
        // 12K facts + ~600 chars of framing fits comfortably under
        // 14K total — anything dramatically larger means the cap
        // wasn't applied.
        assert!(user.len() < 14_000, "user message length: {}", user.len());
    }

    #[test]
    fn log_triage_prompt_includes_service_and_runtime() {
        let msgs = build_log_triage_prompt(
            "ECONNREFUSED 127.0.0.1:5432",
            &["earlier line".to_string()],
            Some("node"),
            Some("api-svc"),
        );
        assert_eq!(msgs.len(), 2);
        let body = &msgs[1].content;
        assert!(body.contains("api-svc"));
        assert!(body.contains("node"));
        assert!(body.contains("ECONNREFUSED"));
    }

    #[test]
    fn language_directive_handles_known_codes_and_falls_back() {
        let p = |lang: Option<&str>| AiProvider {
            id: "x".into(),
            name: "x".into(),
            kind: AiProviderKind::Openai,
            base_url: "https://x".into(),
            api_key: String::new(),
            model: "m".into(),
            default: false,
            response_language: lang.map(|s| s.to_string()),
            max_output_tokens: None,
            context_window: None,
            created_at_ms: 0,
        };
        assert!(p(None).language_directive().is_none());
        assert!(p(Some("auto")).language_directive().is_none());
        assert!(p(Some("")).language_directive().is_none());
        assert!(p(Some("en"))
            .language_directive()
            .unwrap()
            .contains("English"));
        assert!(p(Some("tr"))
            .language_directive()
            .unwrap()
            .contains("Türkçe"));
        assert!(p(Some("Klingon"))
            .language_directive()
            .unwrap()
            .contains("Klingon"));
    }

    #[test]
    fn resolve_max_tokens_picks_smaller_or_only_set() {
        let make = |provider_cap: Option<u32>| AiProvider {
            id: "x".into(),
            name: "x".into(),
            kind: AiProviderKind::Openai,
            base_url: "https://x".into(),
            api_key: String::new(),
            model: "m".into(),
            default: false,
            response_language: None,
            max_output_tokens: provider_cap,
            context_window: None,
            created_at_ms: 0,
        };
        // Both `None` → no cap on the wire.
        assert_eq!(make(None).resolve_max_tokens(None), None);
        // Only the surface speaks → its value flows through unchanged.
        assert_eq!(make(None).resolve_max_tokens(Some(1500)), Some(1500));
        // Only the provider speaks → its cap applies even when the
        // surface deliberately said "no opinion" (this is the new
        // behaviour we just shipped: previously surfaces silently won).
        assert_eq!(make(Some(2048)).resolve_max_tokens(None), Some(2048));
        // Both speak: smaller wins. Surface tighter than provider.
        assert_eq!(make(Some(8000)).resolve_max_tokens(Some(1500)), Some(1500));
        // Both speak: smaller wins. Provider tighter than surface.
        assert_eq!(make(Some(512)).resolve_max_tokens(Some(2000)), Some(512));
        // Equal values → either, the min is unambiguous.
        assert_eq!(make(Some(2000)).resolve_max_tokens(Some(2000)), Some(2000));
    }

    #[test]
    fn apply_language_directive_appends_to_existing_system() {
        let mut msgs = vec![
            ChatMessage::system("You are helpful."),
            ChatMessage::user("hi"),
        ];
        apply_language_directive(&mut msgs, "Respond in Turkish.");
        assert!(msgs[0].content.contains("You are helpful."));
        assert!(msgs[0].content.contains("Respond in Turkish."));
        assert_eq!(msgs[1].content, "hi");
    }

    #[test]
    fn apply_language_to_vec_inserts_when_missing() {
        let mut msgs = vec![ChatMessage::user("hi")];
        apply_language_to_vec(&mut msgs, "Respond in Turkish.");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "system");
        assert!(msgs[0].content.contains("Respond in Turkish."));
    }

    #[test]
    fn think_state_splits_clean_block() {
        let mut s = ThinkState::default();
        let parts = s.feed("Hello <think>I should be polite</think> world");
        assert_eq!(
            parts,
            vec![
                ThinkPart::Answer("Hello ".to_string()),
                ThinkPart::Reasoning("I should be polite".to_string()),
                ThinkPart::Answer(" world".to_string()),
            ]
        );
        assert!(s.flush().is_none());
    }

    /// Concatenate consecutive parts of the same kind so split-chunk
    /// streams compare equal to single-shot streams. The streaming
    /// API allows adjacent same-kind emits (frontend just appends),
    /// but it makes the assertions in these tests noisy.
    fn coalesce(parts: Vec<ThinkPart>) -> Vec<ThinkPart> {
        let mut out: Vec<ThinkPart> = Vec::new();
        for part in parts {
            match (out.last_mut(), &part) {
                (Some(ThinkPart::Answer(prev)), ThinkPart::Answer(s)) => prev.push_str(s),
                (Some(ThinkPart::Reasoning(prev)), ThinkPart::Reasoning(s)) => prev.push_str(s),
                _ => out.push(part),
            }
        }
        // Trim empty-string parts that the splitter sometimes
        // produces around tag boundaries. Helps the assertions stay
        // readable.
        out.retain(|p| match p {
            ThinkPart::Answer(s) | ThinkPart::Reasoning(s) => !s.is_empty(),
            ThinkPart::ReclassifyAsReasoning => true,
        });
        out
    }

    #[test]
    fn think_state_handles_split_open_tag_across_chunks() {
        let mut s = ThinkState::default();
        let a = s.feed("Hello <thi");
        let b = s.feed("nk>secret</think> world");
        let mut all = a;
        all.extend(b);
        assert_eq!(
            coalesce(all),
            vec![
                ThinkPart::Answer("Hello ".to_string()),
                ThinkPart::Reasoning("secret".to_string()),
                ThinkPart::Answer(" world".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_handles_split_close_tag_across_chunks() {
        let mut s = ThinkState::default();
        let a = s.feed("<think>step 1</thi");
        let b = s.feed("nk>answer here");
        let mut all = a;
        all.extend(b);
        assert_eq!(
            coalesce(all),
            vec![
                ThinkPart::Reasoning("step 1".to_string()),
                ThinkPart::Answer("answer here".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_naked_close_emits_reclassify_marker() {
        // Reasoning model whose proxy stripped the opening tag.
        // Stream looks like: "step 1\nstep 2\n</think>actual answer".
        let mut s = ThinkState::default();
        let parts = s.feed("step 1\nstep 2\n</think>actual answer");
        assert_eq!(
            parts,
            vec![
                ThinkPart::Answer("step 1\nstep 2\n".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("actual answer".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_naked_close_split_across_chunks() {
        let mut s = ThinkState::default();
        let mut all = s.feed("step 1\nstep 2");
        all.extend(s.feed(" more thinking</thi"));
        all.extend(s.feed("nk>real answer"));
        let coalesced = coalesce(all);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("step 1\nstep 2 more thinking".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("real answer".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_naked_close_only_fires_once() {
        // Even if the model emits a second </think> later (unlikely
        // but possible), we shouldn't reclassify a second time.
        let mut s = ThinkState::default();
        let parts = s.feed("plan</think>answer with stray </think> in middle");
        let coalesced = coalesce(parts);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("plan".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("answer with stray  in middle".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_unclosed_block_flushes_as_reasoning() {
        let mut s = ThinkState::default();
        let parts = s.feed("<think>I never got to finish");
        assert_eq!(
            parts,
            vec![ThinkPart::Reasoning("I never got to finish".to_string())]
        );
        assert!(s.flush().is_none()); // already drained
    }

    #[test]
    fn think_state_passes_through_plain_text() {
        let mut s = ThinkState::default();
        let parts = s.feed("plain answer with no tags");
        assert_eq!(
            parts,
            vec![ThinkPart::Answer("plain answer with no tags".to_string())]
        );
    }

    #[test]
    fn think_state_does_not_swallow_lt_in_answer() {
        // "if x < 5" should pass through eventually even if `<` looks
        // like it could grow into `<think>`. We allow one chunk of
        // delay, but the content must arrive.
        let mut s = ThinkState::default();
        let mut all = s.feed("if x < ");
        all.extend(s.feed("5 then"));
        let combined: String = all
            .iter()
            .filter_map(|p| match p {
                ThinkPart::Answer(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(combined, "if x < 5 then");
    }

    #[test]
    fn polish_standup_keeps_input_inline() {
        let raw = "## RunHQ\n\n### api-svc\n- 09:32 commit \"fix\"\n";
        let msgs = build_polish_standup_prompt(raw);
        assert_eq!(msgs.len(), 2);
        assert!(msgs[1].content.contains("api-svc"));
    }

    #[test]
    fn think_state_scratchpad_marker_reclassifies_prefix() {
        // Mirrors the user's screenshot: model dumps numbered analysis
        // steps, then writes "Drafting the Response" as a header, then
        // the actual answer. Everything before "Drafting the Response"
        // (including the trailing parenthetical and colon) should be
        // moved to the reasoning bucket; only the body remains as the
        // answer.
        let mut s = ThinkState::default();
        let parts = s.feed(
            "1. Reading the diff...\n2. Identifying the change...\n\
             3. Drafting the Response (Internal Monologue/Drafting):\n\
             **Summary:** The comment changed.",
        );
        let coalesced = coalesce(parts);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer(
                    "1. Reading the diff...\n2. Identifying the change...\n3. ".to_string()
                ),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("**Summary:** The comment changed.".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_scratchpad_marker_handles_final_answer_label() {
        let mut s = ThinkState::default();
        let parts = s.feed("Step 1: parse.\nStep 2: synthesise.\nFinal Answer:\nThe fix is X.");
        let coalesced = coalesce(parts);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("Step 1: parse.\nStep 2: synthesise.\n".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("The fix is X.".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_scratchpad_marker_split_across_chunks() {
        // The marker straddles a chunk boundary — the splitter must
        // hold back the partial bytes rather than emit "Final Answ"
        // as answer text that the user briefly sees in the response.
        let mut s = ThinkState::default();
        let mut all = s.feed("scratchpad bullets\nFinal An");
        all.extend(s.feed("swer:\nthe answer"));
        let coalesced = coalesce(all);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("scratchpad bullets\n".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("the answer".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_scratchpad_marker_only_fires_once() {
        // Once a reclassify has fired, a second occurrence of the same
        // marker (e.g. the model later quotes "Final Answer:" as part
        // of a legitimate explanation) must pass through untouched.
        let mut s = ThinkState::default();
        let parts = s.feed(
            "plan\nFinal Answer:\nbody starts here.\n\
             Then I noted Final Answer: as a heading.",
        );
        let coalesced = coalesce(parts);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("plan\n".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer(
                    "body starts here.\nThen I noted Final Answer: as a heading.".to_string()
                ),
            ]
        );
    }

    #[test]
    fn think_state_scratchpad_marker_drafting_variants() {
        // Smaller models swap the noun (Response → Content / Standup
        // / Answer …). All variants must trigger reclassification.
        for noun in [
            "content",
            "answer",
            "standup",
            "explanation",
            "triage",
            "output",
            "message",
        ] {
            let mut s = ThinkState::default();
            let input = format!(
                "1. Reading.\n2. Inference.\n3. Drafting the {noun} (Internal \
                 Monologue/Drafting):\n**Body** here."
            );
            let parts = s.feed(&input);
            let coalesced = coalesce(parts);
            // Must contain a reclassify followed by the answer body.
            let saw_reclassify = coalesced
                .iter()
                .any(|p| matches!(p, ThinkPart::ReclassifyAsReasoning));
            assert!(
                saw_reclassify,
                "expected reclassify for noun `{noun}`, got {coalesced:?}"
            );
            let answer_after: String = coalesced
                .iter()
                .skip_while(|p| !matches!(p, ThinkPart::ReclassifyAsReasoning))
                .skip(1)
                .filter_map(|p| match p {
                    ThinkPart::Answer(s) => Some(s.as_str()),
                    _ => None,
                })
                .collect();
            assert_eq!(
                answer_after, "**Body** here.",
                "answer-after-marker mismatch for noun `{noun}`"
            );
        }
    }

    #[test]
    fn think_state_scratchpad_marker_case_insensitive() {
        let mut s = ThinkState::default();
        let parts = s.feed("noise\nDRAFTING THE RESPONSE\nthe answer");
        let coalesced = coalesce(parts);
        assert_eq!(
            coalesced,
            vec![
                ThinkPart::Answer("noise\n".to_string()),
                ThinkPart::ReclassifyAsReasoning,
                ThinkPart::Answer("the answer".to_string()),
            ]
        );
    }

    #[test]
    fn think_state_no_marker_passes_clean_answer_through() {
        // Sanity: a normal answer that doesn't trip any marker keeps
        // its full content, including the literal substring "answer"
        // which is part of `final answer:` but not the full marker.
        let mut s = ThinkState::default();
        let parts = s.feed("Here is the answer to your question.");
        assert_eq!(
            coalesce(parts),
            vec![ThinkPart::Answer(
                "Here is the answer to your question.".to_string()
            )]
        );
    }
}
