use runhq_core::conversations::{
    self as core_conversations, AppendMessageInput, Conversation, ConversationSummary,
    ConversationsDb, CreateConversationInput,
};
use runhq_core::error::AppResult;
use serde::Deserialize;
use tauri::State;

use crate::AppState;

// ---- Conversations (AI chat history) -------------------------------------

fn open_conversations_db(state: &State<'_, AppState>) -> AppResult<ConversationsDb> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("conversations.db");
    ConversationsDb::open(&db_path)
}

#[derive(Debug, Deserialize)]
pub struct ListConversationsInput {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub include_archived: bool,
    /// When true, restrict the result set to favorited conversations.
    /// Honoured independently from `include_archived` so the user can
    /// browse "favorites + archived" without losing either filter.
    #[serde(default)]
    pub favorites_only: bool,
    /// Optional substring search across title and message content.
    /// Empty/whitespace strings are treated as "no filter".
    #[serde(default)]
    pub query: Option<String>,
}

#[tauri::command]
pub fn list_conversations(
    input: ListConversationsInput,
    state: State<'_, AppState>,
) -> AppResult<Vec<ConversationSummary>> {
    let db = open_conversations_db(&state)?;
    let lim = input.limit.unwrap_or(200).min(2000);
    db.list_conversations(
        lim,
        input.include_archived,
        input.favorites_only,
        input.query.as_deref(),
    )
}

#[tauri::command]
pub fn get_conversation(id: String, state: State<'_, AppState>) -> AppResult<Conversation> {
    let db = open_conversations_db(&state)?;
    db.get_conversation(&id)
}

#[tauri::command]
pub fn create_conversation(
    input: CreateConversationInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = open_conversations_db(&state)?;
    db.create_conversation(input)
}

#[tauri::command]
pub fn append_conversation_message(
    input: AppendMessageInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = open_conversations_db(&state)?;
    db.append_message(input)
}

#[derive(Debug, Deserialize)]
pub struct RenameConversationInput {
    pub id: String,
    pub title: String,
}

#[tauri::command]
pub fn rename_conversation(
    input: RenameConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.rename_conversation(&input.id, &input.title)
}

#[derive(Debug, Deserialize)]
pub struct PinConversationInput {
    pub id: String,
    pub pinned: bool,
}

#[tauri::command]
pub fn pin_conversation(input: PinConversationInput, state: State<'_, AppState>) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.pin_conversation(&input.id, input.pinned)
}

#[derive(Debug, Deserialize)]
pub struct FavoriteConversationInput {
    pub id: String,
    pub favorite: bool,
}

#[tauri::command]
pub fn favorite_conversation(
    input: FavoriteConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.favorite_conversation(&input.id, input.favorite)
}

#[derive(Debug, Deserialize)]
pub struct ArchiveConversationInput {
    pub id: String,
    pub archived: bool,
}

#[tauri::command]
pub fn archive_conversation(
    input: ArchiveConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.archive_conversation(&input.id, input.archived)
}

#[tauri::command]
pub fn delete_conversation(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.delete_conversation(&id)
}

// Force module-use so the unused-import lint stays happy when the
// module exports types we re-export but don't directly call inside ipc.
#[allow(dead_code)]
fn _conversations_module_link() {
    let _ = std::any::type_name::<core_conversations::Message>();
}
