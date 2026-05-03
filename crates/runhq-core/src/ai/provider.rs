use serde::{Deserialize, Serialize};

use super::types::ChatMessage;

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
    /// BCP-47-ish language code specifically for AI-generated commit
    /// messages. Kept independent of [`response_language`] because the
    /// two settings serve different audiences: chat replies are read
    /// by the user themselves (their native tongue is fine), but
    /// commit messages enter the project history where conventions
    /// often demand English regardless of the developer's UI
    /// preference. A user might want chat in Turkish while keeping
    /// commits English-only — this field captures that split.
    ///
    /// Resolution rules:
    /// - `None` / empty / `inherit` → fall back to `response_language`.
    /// - `auto` → no language directive at all (the model decides;
    ///   usually matches the diff's existing comment language).
    /// - any other code → forced directive (overrides
    ///   `response_language` for the commit surface only).
    #[serde(default)]
    pub commit_language: Option<String>,
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

    /// Directive for the COMMIT surface specifically. Falls back to
    /// the general response-language setting when `commit_language`
    /// is unset or set to `inherit`, so users who don't care about
    /// the distinction get the existing behaviour for free.
    ///
    /// Behaviour matrix:
    ///
    /// | `commit_language`       | result                                 |
    /// |-------------------------|----------------------------------------|
    /// | `None` / `""` / `inherit` | same as `language_directive()`       |
    /// | `auto`                  | `None` (no directive — model decides)  |
    /// | otherwise               | directive forced for that language     |
    ///
    /// `auto` is meaningful here even though it's a no-op directive:
    /// it lets the user *opt out* of an English-leaning
    /// `response_language` for commits while still letting chat
    /// stay English. Without this carve-out, the "commits should
    /// match diff comments, chat should be in my language" workflow
    /// would have no way to express itself.
    pub fn commit_language_directive(&self) -> Option<String> {
        let raw = self.commit_language.as_deref().map(str::trim).unwrap_or("");
        if raw.is_empty() || raw.eq_ignore_ascii_case("inherit") {
            return self.language_directive();
        }
        if raw.eq_ignore_ascii_case("auto") {
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
