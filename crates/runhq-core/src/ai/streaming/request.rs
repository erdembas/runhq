use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};

use super::super::client::build_headers;
use super::super::provider::AiProvider;
use super::super::types::{ChatMessage, ChatOptions, StreamChunk};

pub(super) async fn open_stream<F>(
    provider: &AiProvider,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    stream_id: &str,
    on_chunk: &mut F,
) -> AppResult<reqwest::Response>
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

    tracing::debug!(
        stream_id = %stream_id,
        provider = %provider.name,
        model = %provider.model,
        message_count = messages.len(),
        max_tokens = ?provider.resolve_max_tokens(options.max_tokens),
        "ai.stream.begin",
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Other(format!("http client init failed: {e}")))?;

    let body = build_stream_body(provider, messages, options);
    let url = provider.chat_url();
    let resp = client
        .post(&url)
        .headers(build_headers(provider)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request to {url} failed: {e}")))?;

    if resp.status().is_success() {
        return Ok(resp);
    }

    let status = resp.status();
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
    Err(AppError::Other(message))
}

fn build_stream_body(
    provider: &AiProvider,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
) -> serde_json::Value {
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
    body["stream_options"] = serde_json::json!({ "include_usage": true });

    let base_lower = provider.base_url.to_lowercase();
    if base_lower.contains("openrouter.ai") {
        body["include_reasoning"] = serde_json::json!(true);
        body["reasoning"] = serde_json::json!({ "exclude": false });
    }
    body
}
