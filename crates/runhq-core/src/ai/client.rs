use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;

use crate::error::{AppError, AppResult};

use super::provider::AiProvider;
use super::types::{ChatMessage, ChatOptions, ChatResponse, TestResult};

pub(super) fn build_headers(provider: &AiProvider) -> AppResult<HeaderMap> {
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
