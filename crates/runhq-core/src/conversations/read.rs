use rusqlite::params;

use crate::error::{AppError, AppResult};

use super::db::ConversationsDb;
use super::types::{Conversation, ConversationSummary, Message, MessageRole};

impl ConversationsDb {
    pub fn list_conversations(
        &self,
        limit: usize,
        include_archived: bool,
        favorites_only: bool,
        query: Option<&str>,
    ) -> AppResult<Vec<ConversationSummary>> {
        // Normalise the search query: trim, lower-case for case-
        // insensitive LIKE, and bail to the no-search path when empty.
        // We do NOT split on spaces — searching for "deploy runbook"
        // should match a title verbatim, not match conversations
        // mentioning "deploy" OR "runbook" (which is much noisier).
        let trimmed = query.map(|q| q.trim()).filter(|q| !q.is_empty());
        let like_pattern = trimmed.map(|q| format!("%{}%", q.to_lowercase()));

        let mut wheres: Vec<&str> = Vec::with_capacity(3);
        if !include_archived {
            wheres.push("c.archived = 0");
        }
        if favorites_only {
            wheres.push("c.favorite = 1");
        }
        // Search clause matches either the title or the body of any
        // message in the conversation. We use a correlated EXISTS
        // subquery rather than a JOIN so each conversation is returned
        // at most once even when multiple messages match. SQLite's
        // LIKE is case-insensitive only for ASCII; we lower() both
        // sides to extend the courtesy to UTF-8 (Türkçe başlıklar için
        // "İ" / "i" eşleşmesi de bu sayede tutuyor — yine de mükemmel
        // değil, ICU yok ama kullanıcı için "iyi yeter" düzeyi).
        if like_pattern.is_some() {
            wheres.push(
                "(LOWER(c.title) LIKE ?2 OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND LOWER(m.content) LIKE ?2))",
            );
        }
        let where_sql = if wheres.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", wheres.join(" AND "))
        };

        // Order: pinned > favorite > recency. Favorite conversations
        // float above non-favorites within the same pinned bucket so
        // the user's "I want to find this again" choices stay near the
        // top — but we don't promote a favorite above a pin, because a
        // pin is the stronger signal ("always at top" beats "I starred
        // this once").
        let sql = format!(
            "SELECT c.id, c.title, c.origin, c.pinned, c.favorite, c.archived, c.created_at_ms, c.updated_at_ms,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                    (SELECT m2.content FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.seq DESC LIMIT 1) AS last_preview
             FROM conversations c
             {where_sql}
             ORDER BY c.pinned DESC, c.favorite DESC, c.updated_at_ms DESC
             LIMIT ?1"
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AppError::Other(format!("prepare list_conversations: {e}")))?;
        // rusqlite's `params!` doesn't play nicely with conditional
        // bindings, so we go through the `query` API explicitly.
        let bound: Box<dyn Iterator<Item = Box<dyn rusqlite::ToSql>>> =
            if let Some(p) = like_pattern.as_ref() {
                Box::new(
                    [
                        Box::new(limit as i64) as Box<dyn rusqlite::ToSql>,
                        Box::new(p.clone()) as Box<dyn rusqlite::ToSql>,
                    ]
                    .into_iter(),
                )
            } else {
                Box::new([Box::new(limit as i64) as Box<dyn rusqlite::ToSql>].into_iter())
            };
        let collected: Vec<Box<dyn rusqlite::ToSql>> = bound.collect();
        let param_refs: Vec<&dyn rusqlite::ToSql> = collected.iter().map(|p| &**p).collect();
        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let pinned: i64 = row.get(3)?;
                let favorite: i64 = row.get(4)?;
                let archived: i64 = row.get(5)?;
                let preview: Option<String> = row.get(9).ok();
                Ok(ConversationSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    pinned: pinned != 0,
                    favorite: favorite != 0,
                    archived: archived != 0,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                    message_count: row.get(8)?,
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
                "SELECT id, title, origin, context_json, pinned, favorite, archived, created_at_ms, updated_at_ms
                 FROM conversations WHERE id = ?1",
            )
            .map_err(|e| AppError::Other(format!("prepare get_conversation: {e}")))?;
        let mut conv: Conversation = stmt
            .query_row(params![id], |row| {
                let pinned: i64 = row.get(4)?;
                let favorite: i64 = row.get(5)?;
                let archived: i64 = row.get(6)?;
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    context_json: row.get(3)?,
                    pinned: pinned != 0,
                    favorite: favorite != 0,
                    archived: archived != 0,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
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
}
