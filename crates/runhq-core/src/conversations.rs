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

use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

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
    fn as_str(&self) -> &'static str {
        match self {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
        }
    }

    fn from_str(s: &str) -> Self {
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

pub struct ConversationsDb {
    conn: Connection,
}

impl ConversationsDb {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)
            .map_err(|e| AppError::Other(format!("opening conversations db: {e}")))?;
        // Enforce CASCADE deletes — without this an `archive_conversation`
        // → `delete_conversation` flow would orphan messages rows.
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| AppError::Other(format!("enable foreign_keys: {e}")))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> AppResult<()> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    context_json TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at_ms DESC);
                CREATE INDEX IF NOT EXISTS idx_conv_archived ON conversations(archived);

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    client_id TEXT,
                    seq INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    reasoning TEXT,
                    provider_id TEXT,
                    provider_name TEXT,
                    model_name TEXT,
                    finish_reason TEXT,
                    partial INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    created_at_ms INTEGER NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_msg_conv_seq ON messages(conversation_id, seq);",
            )
            .map_err(|e| AppError::Other(format!("init conversations schema: {e}")))?;
        // Forward-migration for installs that ran the pre-client_id
        // schema. Same trick as `timeline.rs`: SQLite has no
        // "ADD COLUMN IF NOT EXISTS", so we attempt and swallow the
        // duplicate-column error. Without this, an upgrade would
        // fail silently and the upsert path below would always treat
        // every persist as a fresh INSERT.
        let _ = self
            .conn
            .execute("ALTER TABLE messages ADD COLUMN client_id TEXT", []);
        // Index the client_id lookup so the upsert hot path doesn't
        // scan; only after the column is guaranteed to exist.
        self.conn
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_msg_client_id ON messages(conversation_id, client_id);",
            )
            .map_err(|e| AppError::Other(format!("init client_id index: {e}")))?;
        Ok(())
    }

    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn gen_id(prefix: &str) -> String {
        // Timestamp prefix keeps ids roughly sortable in logs; uuid v4
        // tail guarantees uniqueness across concurrent appends (an auto-
        // retry can race a manual continue and emit two assistant rows
        // in the same millisecond). Stringly-typed for trivial frontend
        // interop — JS doesn't have a u64.
        format!(
            "{}-{}-{}",
            prefix,
            Self::now_ms(),
            uuid::Uuid::new_v4().simple(),
        )
    }

    pub fn create_conversation(&self, input: CreateConversationInput) -> AppResult<String> {
        let id = Self::gen_id("conv");
        let now = Self::now_ms();
        self.conn
            .execute(
                "INSERT INTO conversations (id, title, origin, context_json, pinned, archived, created_at_ms, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5)",
                params![&id, input.title, input.origin, input.context_json, now],
            )
            .map_err(|e| AppError::Other(format!("create conversation: {e}")))?;
        Ok(id)
    }

    pub fn append_message(&self, input: AppendMessageInput) -> AppResult<String> {
        let conv_id = input.conversation_id.clone();
        let now = Self::now_ms();

        // Upsert path: when a `client_id` is supplied AND a row with
        // that client_id already exists in this conversation, update
        // in place. This collapses the "user clicked Continue twice
        // and then cancelled" sequence into one canonical row whose
        // content is the latest snapshot — instead of three rows
        // that re-render as three stitched bubbles on reload.
        if let Some(ref client_id) = input.client_id {
            let existing: Option<String> = self
                .conn
                .query_row(
                    "SELECT id FROM messages WHERE conversation_id = ?1 AND client_id = ?2 LIMIT 1",
                    params![&conv_id, client_id],
                    |row| row.get(0),
                )
                .ok();
            if let Some(existing_id) = existing {
                self.conn
                    .execute(
                        "UPDATE messages SET
                            role = ?1,
                            content = ?2,
                            reasoning = ?3,
                            provider_id = ?4,
                            provider_name = ?5,
                            model_name = ?6,
                            finish_reason = ?7,
                            partial = ?8,
                            error = ?9
                         WHERE id = ?10",
                        params![
                            input.role.as_str(),
                            &input.content,
                            &input.reasoning,
                            &input.provider_id,
                            &input.provider_name,
                            &input.model_name,
                            &input.finish_reason,
                            input.partial as i32,
                            &input.error,
                            &existing_id,
                        ],
                    )
                    .map_err(|e| AppError::Other(format!("update message: {e}")))?;
                self.conn
                    .execute(
                        "UPDATE conversations SET updated_at_ms = ?1 WHERE id = ?2",
                        params![now, &conv_id],
                    )
                    .ok();
                return Ok(existing_id);
            }
        }

        // Insert path. Compute next `seq` server-side so concurrent
        // calls (auto-retry racing with manual continue) can't
        // interleave their seqs.
        let seq: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
                params![&conv_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Other(format!("compute next seq: {e}")))?;
        let id = Self::gen_id("msg");
        self.conn
            .execute(
                "INSERT INTO messages (id, conversation_id, client_id, seq, role, content, reasoning, provider_id, provider_name, model_name, finish_reason, partial, error, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    &id,
                    &conv_id,
                    &input.client_id,
                    seq,
                    input.role.as_str(),
                    &input.content,
                    &input.reasoning,
                    &input.provider_id,
                    &input.provider_name,
                    &input.model_name,
                    &input.finish_reason,
                    input.partial as i32,
                    &input.error,
                    now,
                ],
            )
            .map_err(|e| AppError::Other(format!("append message: {e}")))?;
        // Bump conversation's `updated_at_ms` so the History drawer
        // re-orders correctly without a separate index sweep.
        self.conn
            .execute(
                "UPDATE conversations SET updated_at_ms = ?1 WHERE id = ?2",
                params![now, &conv_id],
            )
            .ok();
        Ok(id)
    }

    pub fn list_conversations(
        &self,
        limit: usize,
        include_archived: bool,
    ) -> AppResult<Vec<ConversationSummary>> {
        let where_clause = if include_archived {
            ""
        } else {
            "WHERE c.archived = 0"
        };
        // We keep pinned conversations always at the top regardless of
        // recency — same convention as Slack / Linear / Apple Mail. A
        // pinned 3-month-old "deploy runbook" conversation would sink
        // off the list under pure recency sort and the user would have
        // to scroll for it.
        let sql = format!(
            "SELECT c.id, c.title, c.origin, c.pinned, c.archived, c.created_at_ms, c.updated_at_ms,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                    (SELECT m2.content FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.seq DESC LIMIT 1) AS last_preview
             FROM conversations c
             {where_clause}
             ORDER BY c.pinned DESC, c.updated_at_ms DESC
             LIMIT ?1"
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AppError::Other(format!("prepare list_conversations: {e}")))?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                let pinned: i64 = row.get(3)?;
                let archived: i64 = row.get(4)?;
                let preview: Option<String> = row.get(8).ok();
                Ok(ConversationSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    pinned: pinned != 0,
                    archived: archived != 0,
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                    message_count: row.get(7)?,
                    last_preview: preview.map(|s| {
                        // Cap preview at 200 chars — enough to disambiguate,
                        // short enough to fit on one line in the drawer.
                        if s.chars().count() > 200 {
                            s.chars().take(200).collect::<String>() + "…"
                        } else {
                            s
                        }
                    }),
                })
            })
            .map_err(|e| AppError::Other(format!("query list_conversations: {e}")))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_conversation(&self, id: &str) -> AppResult<Conversation> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, origin, context_json, pinned, archived, created_at_ms, updated_at_ms
                 FROM conversations WHERE id = ?1",
            )
            .map_err(|e| AppError::Other(format!("prepare get_conversation: {e}")))?;
        let mut conv: Conversation = stmt
            .query_row(params![id], |row| {
                let pinned: i64 = row.get(4)?;
                let archived: i64 = row.get(5)?;
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    context_json: row.get(3)?,
                    pinned: pinned != 0,
                    archived: archived != 0,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                    messages: Vec::new(),
                })
            })
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("conversation {id}"))
                }
                other => AppError::Other(format!("query conversation: {other}")),
            })?;

        let mut msg_stmt = self
            .conn
            .prepare(
                "SELECT id, conversation_id, client_id, seq, role, content, reasoning, provider_id, provider_name, model_name, finish_reason, partial, error, created_at_ms
                 FROM messages WHERE conversation_id = ?1 ORDER BY seq ASC",
            )
            .map_err(|e| AppError::Other(format!("prepare messages query: {e}")))?;
        let rows = msg_stmt
            .query_map(params![id], |row| {
                let role_s: String = row.get(4)?;
                let partial: i64 = row.get(11)?;
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    client_id: row.get(2)?,
                    seq: row.get(3)?,
                    role: MessageRole::from_str(&role_s),
                    content: row.get(5)?,
                    reasoning: row.get(6)?,
                    provider_id: row.get(7)?,
                    provider_name: row.get(8)?,
                    model_name: row.get(9)?,
                    finish_reason: row.get(10)?,
                    partial: partial != 0,
                    error: row.get(12)?,
                    created_at_ms: row.get(13)?,
                })
            })
            .map_err(|e| AppError::Other(format!("query messages: {e}")))?;
        conv.messages = rows.filter_map(|r| r.ok()).collect();
        Ok(conv)
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> AppResult<()> {
        let now = Self::now_ms();
        let n = self
            .conn
            .execute(
                "UPDATE conversations SET title = ?1, updated_at_ms = ?2 WHERE id = ?3",
                params![title, now, id],
            )
            .map_err(|e| AppError::Other(format!("rename conversation: {e}")))?;
        if n == 0 {
            return Err(AppError::NotFound(format!("conversation {id}")));
        }
        Ok(())
    }

    pub fn pin_conversation(&self, id: &str, pinned: bool) -> AppResult<()> {
        let n = self
            .conn
            .execute(
                "UPDATE conversations SET pinned = ?1 WHERE id = ?2",
                params![pinned as i64, id],
            )
            .map_err(|e| AppError::Other(format!("pin conversation: {e}")))?;
        if n == 0 {
            return Err(AppError::NotFound(format!("conversation {id}")));
        }
        Ok(())
    }

    pub fn archive_conversation(&self, id: &str, archived: bool) -> AppResult<()> {
        let now = Self::now_ms();
        let n = self
            .conn
            .execute(
                "UPDATE conversations SET archived = ?1, updated_at_ms = ?2 WHERE id = ?3",
                params![archived as i64, now, id],
            )
            .map_err(|e| AppError::Other(format!("archive conversation: {e}")))?;
        if n == 0 {
            return Err(AppError::NotFound(format!("conversation {id}")));
        }
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> AppResult<()> {
        let n = self
            .conn
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|e| AppError::Other(format!("delete conversation: {e}")))?;
        if n == 0 {
            return Err(AppError::NotFound(format!("conversation {id}")));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> ConversationsDb {
        // tempfile is a dev-dep but we don't actually need its
        // RAII cleanup here — tests are short-lived and the OS
        // tmpdir is fine. Random suffix prevents parallel-test
        // collisions.
        let path = std::env::temp_dir().join(format!(
            "runhq-conv-test-{}-{}.db",
            std::process::id(),
            uuid::Uuid::new_v4().simple(),
        ));
        ConversationsDb::open(&path).expect("open temp db")
    }

    #[test]
    fn create_then_get_round_trips() {
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "Test conv".into(),
                origin: "free".into(),
                context_json: Some(r#"{"foo":"bar"}"#.into()),
            })
            .unwrap();

        let conv = db.get_conversation(&id).unwrap();
        assert_eq!(conv.title, "Test conv");
        assert_eq!(conv.origin, "free");
        assert_eq!(conv.context_json.as_deref(), Some(r#"{"foo":"bar"}"#));
        assert!(!conv.pinned);
        assert!(!conv.archived);
        assert!(conv.messages.is_empty());
    }

    #[test]
    fn append_messages_assigns_monotonic_seq() {
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "Seq test".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();

        for i in 0..5 {
            db.append_message(AppendMessageInput {
                conversation_id: id.clone(),
                client_id: None,
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("msg {i}"),
                reasoning: None,
                provider_id: None,
                provider_name: None,
                model_name: None,
                finish_reason: None,
                partial: false,
                error: None,
            })
            .unwrap();
        }

        let conv = db.get_conversation(&id).unwrap();
        assert_eq!(conv.messages.len(), 5);
        // Seq is the contract the panel uses to order messages on
        // rehydrate; if it ever drifts the conversation reads as
        // garbled. Lock it down.
        for (i, m) in conv.messages.iter().enumerate() {
            assert_eq!(m.seq, i as i64);
            assert_eq!(m.content, format!("msg {i}"));
        }
    }

    #[test]
    fn list_conversations_orders_by_pin_then_recency() {
        let db = temp_db();
        let a = db
            .create_conversation(CreateConversationInput {
                title: "Old".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        // Tiny sleep so updated_at_ms differs deterministically.
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = db
            .create_conversation(CreateConversationInput {
                title: "Newer".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let c = db
            .create_conversation(CreateConversationInput {
                title: "Pinned but oldest update".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        // Pin C explicitly. Without the pin, C would sit on top by
        // recency anyway; we deliberately bump A's update so C is
        // older-by-update but pinned, validating the pin sort.
        db.pin_conversation(&c, true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        db.append_message(AppendMessageInput {
            conversation_id: a.clone(),
            client_id: None,
            role: MessageRole::User,
            content: "bumping a".into(),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: None,
            partial: false,
            error: None,
        })
        .unwrap();

        let list = db.list_conversations(50, false).unwrap();
        assert_eq!(list.len(), 3);
        // Pinned first.
        assert_eq!(list[0].id, c);
        assert!(list[0].pinned);
        // Then by updated_at_ms desc — A was just bumped.
        assert_eq!(list[1].id, a);
        assert_eq!(list[2].id, b);
    }

    #[test]
    fn delete_cascades_to_messages() {
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "T".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        db.append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: None,
            role: MessageRole::User,
            content: "hi".into(),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: None,
            partial: false,
            error: None,
        })
        .unwrap();
        db.delete_conversation(&id).unwrap();
        // Conversation gone.
        assert!(matches!(
            db.get_conversation(&id).unwrap_err(),
            AppError::NotFound(_)
        ));
        // Messages should also be gone — orphan rows would keep growing
        // the DB over time and confuse `list_conversations`'s
        // `last_preview` subquery on a recreated id.
        let count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
                params![&id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn archive_excludes_from_default_list() {
        let db = temp_db();
        let visible = db
            .create_conversation(CreateConversationInput {
                title: "Visible".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        let hidden = db
            .create_conversation(CreateConversationInput {
                title: "Archived".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        db.archive_conversation(&hidden, true).unwrap();

        let default_list = db.list_conversations(50, false).unwrap();
        assert_eq!(default_list.len(), 1);
        assert_eq!(default_list[0].id, visible);

        let with_archived = db.list_conversations(50, true).unwrap();
        assert_eq!(with_archived.len(), 2);
    }

    #[test]
    fn append_with_client_id_upserts_in_place() {
        // Critical for the chat panel: a single Turn that gets
        // continued/cancelled/retried must collapse to ONE row, not a
        // pile of half-overlapping bubbles on reload. We simulate the
        // sequence "stream first → partial → continue → complete" via
        // three appends sharing a client_id; the final state of the
        // single resulting row must reflect the last write.
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "Upsert".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        let client_id = Some("a-12345".to_string());

        let first = db
            .append_message(AppendMessageInput {
                conversation_id: id.clone(),
                client_id: client_id.clone(),
                role: MessageRole::Assistant,
                content: "first half".into(),
                reasoning: None,
                provider_id: None,
                provider_name: None,
                model_name: None,
                finish_reason: Some("length".into()),
                partial: true,
                error: None,
            })
            .unwrap();

        let second = db
            .append_message(AppendMessageInput {
                conversation_id: id.clone(),
                client_id: client_id.clone(),
                role: MessageRole::Assistant,
                content: "first half AND second half".into(),
                reasoning: None,
                provider_id: None,
                provider_name: None,
                model_name: None,
                finish_reason: Some("stop".into()),
                partial: false,
                error: None,
            })
            .unwrap();

        // Same row id round-trip — we updated in place, didn't insert.
        assert_eq!(first, second);

        let conv = db.get_conversation(&id).unwrap();
        assert_eq!(conv.messages.len(), 1);
        let m = &conv.messages[0];
        assert_eq!(m.content, "first half AND second half");
        assert_eq!(m.finish_reason.as_deref(), Some("stop"));
        assert!(!m.partial);
        assert_eq!(m.client_id.as_deref(), Some("a-12345"));
    }

    #[test]
    fn append_with_unique_client_ids_inserts_separate_rows() {
        // Mirror of the upsert test — confirm we don't collapse rows
        // that *should* be distinct (different turns in the same
        // conversation).
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "Distinct".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        for i in 0..3 {
            db.append_message(AppendMessageInput {
                conversation_id: id.clone(),
                client_id: Some(format!("a-{i}")),
                role: MessageRole::Assistant,
                content: format!("turn {i}"),
                reasoning: None,
                provider_id: None,
                provider_name: None,
                model_name: None,
                finish_reason: Some("stop".into()),
                partial: false,
                error: None,
            })
            .unwrap();
        }
        let conv = db.get_conversation(&id).unwrap();
        assert_eq!(conv.messages.len(), 3);
        for (i, m) in conv.messages.iter().enumerate() {
            assert_eq!(m.client_id.as_deref(), Some(format!("a-{i}").as_str()));
        }
    }

    #[test]
    fn last_preview_is_capped_at_200_chars() {
        let db = temp_db();
        let id = db
            .create_conversation(CreateConversationInput {
                title: "T".into(),
                origin: "free".into(),
                context_json: None,
            })
            .unwrap();
        let long = "a".repeat(500);
        db.append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: None,
            role: MessageRole::Assistant,
            content: long.clone(),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: None,
            partial: false,
            error: None,
        })
        .unwrap();
        let list = db.list_conversations(10, false).unwrap();
        let preview = list[0].last_preview.as_deref().unwrap();
        // 200 base chars + "…" terminator.
        assert!(preview.ends_with('…'));
        assert_eq!(preview.chars().count(), 201);
    }
}
