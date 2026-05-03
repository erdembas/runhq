//! Persistent chat history for the AI Chat panel.
//!
//! Each AI surface invocation (Why? popover, log triage, diff explainer,
//! commit message, standup polish, dashboard report, free chat) lands as
//! its own row in `conversations`, with `messages` rows hanging off it.
//! The chat panel reads from this DB to populate the History drawer and
//! to rehydrate a conversation when the user clicks it.
//!
//! Why a separate DB file rather than reusing `timeline.db`?
//! - Different lifecycle: timeline events are short, append-only,
//!   queried by date. Conversations are longer-lived, randomly accessed,
//!   sometimes pinned/archived for months.
//! - Different blast radius: a corrupt timeline shouldn't wipe chat
//!   history and vice versa. SQLite recoverability is per-file.
//! - Future migration to a synced-via-iCloud / cross-device path is
//!   easier when chat history lives in its own file.
//!
//! Schema deliberately stays narrow:
//! - System messages are NOT persisted. `SYSTEM_PROMPT` and any surface-
//!   specific `contextSystemMessage` are reconstructed at runtime, so a
//!   prompt-tweak ships immediately to all old conversations.
//! - Reasoning trace IS persisted because users want to inspect why the
//!   model said what it did weeks later — it's the chat-equivalent of a
//!   git commit's body, not just throwaway noise.

mod db;
mod read;
mod types;
mod write;

pub use db::ConversationsDb;
pub use types::{
    AppendMessageInput, Conversation, ConversationSummary, CreateConversationInput, Message,
    MessageRole,
};

#[cfg(test)]
mod tests;
