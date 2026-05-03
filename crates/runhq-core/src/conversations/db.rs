use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct ConversationsDb {
    pub(super) conn: Connection,
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
                    favorite INTEGER NOT NULL DEFAULT 0,
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
        // Same pattern for the favorite column. Older installs created
        // the conversations table before the favorite feature shipped;
        // attempt the ADD COLUMN and swallow the duplicate-column
        // error so subsequent SELECTs don't blow up on missing column.
        let _ = self.conn.execute(
            "ALTER TABLE conversations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
            [],
        );
        self.conn
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_conv_favorite ON conversations(favorite);",
            )
            .map_err(|e| AppError::Other(format!("init favorite index: {e}")))?;
        Ok(())
    }

    pub(super) fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    pub(super) fn gen_id(prefix: &str) -> String {
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
}
