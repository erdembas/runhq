use serde::{Deserialize, Serialize};

/// One row in the `conversations` table. Surface-specific context lives
/// in `context_json` (free-form `serde_json::Value` serialised to text)
/// so we don't need a schema migration every time the dashboard adds
/// another diagnostic column to the Why? popover.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub origin: String,
    pub context_json: Option<String>,
    pub pinned: bool,
    /// User-curated star. Distinct from `pinned`: pin = "always at the
    /// top of the list", favorite = "I want to find this again later".
    /// A conversation can be favorited without being pinned (the typical
    /// "useful reference, but I don't need it sticky" case).
    pub favorite: bool,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub messages: Vec<Message>,
}

/// Lightweight projection used by the History drawer — full message
/// content would balloon a 100-row list to several MBs of JSON over the
/// IPC bridge. The drawer only needs enough to render the row label and
/// pick an icon.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub origin: String,
    pub pinned: bool,
    /// See [`Conversation::favorite`]. Surfaced in the History drawer as
    /// a star toggle separate from the pin badge.
    pub favorite: bool,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub message_count: i64,
    /// First ~200 chars of the latest assistant or user message —
    /// surfaced in the drawer as a one-line preview ("…this commit
    /// fixes the truncation race in the SSE parser…"). NULL when the
    /// conversation has no messages yet (just-created draft from a
    /// surface trigger).
    pub last_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

impl MessageRole {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
        }
    }

    pub(super) fn from_str(s: &str) -> Self {
        match s {
            "assistant" => MessageRole::Assistant,
            _ => MessageRole::User,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    /// Frontend-supplied stable id (the chat panel's `Turn.id`). When
    /// the panel re-persists a turn (continuation, cancel-after-
    /// stream, error → retry success), it ships the same `client_id`
    /// and we upsert in place rather than appending another row —
    /// keeps the reloaded conversation rendering as one bubble per
    /// turn instead of two stitched bubbles per "Continue" click.
    /// `None` for legacy / pre-upsert rows.
    pub client_id: Option<String>,
    pub seq: i64,
    pub role: MessageRole,
    pub content: String,
    pub reasoning: Option<String>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub model_name: Option<String>,
    pub finish_reason: Option<String>,
    pub partial: bool,
    pub error: Option<String>,
    pub created_at_ms: i64,
}

/// Input shape for `append_message` IPC. Mirrors `Message` minus the
/// auto-assigned `id` / `seq` / `created_at_ms`.
#[derive(Debug, Clone, Deserialize)]
pub struct AppendMessageInput {
    pub conversation_id: String,
    /// Optional client-generated stable id. When supplied and a row
    /// already exists with that `client_id`, we update in place
    /// instead of inserting (see [`Message::client_id`]).
    #[serde(default)]
    pub client_id: Option<String>,
    pub role: MessageRole,
    pub content: String,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_name: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub finish_reason: Option<String>,
    #[serde(default)]
    pub partial: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateConversationInput {
    pub title: String,
    pub origin: String,
    #[serde(default)]
    pub context_json: Option<String>,
}
