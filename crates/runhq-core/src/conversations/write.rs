use rusqlite::params;

use crate::error::{AppError, AppResult};

use super::db::ConversationsDb;
use super::types::{AppendMessageInput, CreateConversationInput};

impl ConversationsDb {
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

    /// Toggle the favorite (star) flag. Deliberately does NOT bump
    /// `updated_at_ms` — favoriting an old conversation should NOT
    /// re-sort it to the top of the recency list (we sort by
    /// `pinned, favorite, updated_at_ms` so it floats above non-
    /// favorites of the same pin bucket but stays at its original
    /// recency position within the favorites bucket).
    pub fn favorite_conversation(&self, id: &str, favorite: bool) -> AppResult<()> {
        let n = self
            .conn
            .execute(
                "UPDATE conversations SET favorite = ?1 WHERE id = ?2",
                params![favorite as i64, id],
            )
            .map_err(|e| AppError::Other(format!("favorite conversation: {e}")))?;
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
