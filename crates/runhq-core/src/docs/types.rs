use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocKind {
    Readme,
    Changelog,
    Contributing,
    Architecture,
    License,
    Doc,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDoc {
    pub kind: DocKind,
    pub relative_path: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub last_modified_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocContent {
    pub relative_path: String,
    pub base_dir: String,
    pub markdown: String,
    pub size_bytes: u64,
    pub last_modified_ms: i64,
}
