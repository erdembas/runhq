use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DetectedEditor {
    pub key: String,
    pub name: String,
    pub command: String,
}
