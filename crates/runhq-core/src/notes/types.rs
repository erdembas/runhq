use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NoteFile {
    pub name: String,
    pub title: String,
    pub size_bytes: u64,
    pub updated_at_ms: u64,
}
