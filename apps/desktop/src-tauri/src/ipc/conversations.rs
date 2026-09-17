use runhq_core::conversations::{
    self as core_conversations, AppendMessageInput, Conversation, ConversationSummary,
    ConversationsDb, CreateConversationInput,
};
use runhq_core::error::AppResult;
use serde::Deserialize;
use tauri::State;

use crate::AppState;

// Message upserts compute their next sequence across multiple SQL statements.
// Keep those transactions ordered when several chat windows save at once.
static CONVERSATIONS_IO: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ---- Conversations (AI chat history) -------------------------------------

fn open_conversations_db(store: &runhq_core::state::Store) -> AppResult<ConversationsDb> {
    let db_path = store
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
pub async fn list_conversations(
    input: ListConversationsInput,
    state: State<'_, AppState>,
) -> AppResult<Vec<ConversationSummary>> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        let lim = input.limit.unwrap_or(200).min(2000);
        db.list_conversations(
            lim,
            input.include_archived,
            input.favorites_only,
            input.query.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_conversation(id: String, state: State<'_, AppState>) -> AppResult<Conversation> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.get_conversation(&id)
    })
    .await
}

#[tauri::command]
pub async fn create_conversation(
    input: CreateConversationInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.create_conversation(input)
    })
    .await
}

#[tauri::command]
pub async fn append_conversation_message(
    input: AppendMessageInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.append_message(input)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct RenameConversationInput {
    pub id: String,
    pub title: String,
}

#[tauri::command]
pub async fn rename_conversation(
    input: RenameConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.rename_conversation(&input.id, &input.title)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct PinConversationInput {
    pub id: String,
    pub pinned: bool,
}

#[tauri::command]
pub async fn pin_conversation(
    input: PinConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.pin_conversation(&input.id, input.pinned)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct FavoriteConversationInput {
    pub id: String,
    pub favorite: bool,
}

#[tauri::command]
pub async fn favorite_conversation(
    input: FavoriteConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.favorite_conversation(&input.id, input.favorite)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct ArchiveConversationInput {
    pub id: String,
    pub archived: bool,
}

#[tauri::command]
pub async fn archive_conversation(
    input: ArchiveConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.archive_conversation(&input.id, input.archived)
    })
    .await
}

#[tauri::command]
pub async fn delete_conversation(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.clone();
    super::serialized_blocking(&CONVERSATIONS_IO, move || {
        let db = open_conversations_db(&store)?;
        db.delete_conversation(&id)
    })
    .await
}

// Force module-use so the unused-import lint stays happy when the
// module exports types we re-export but don't directly call inside ipc.
#[allow(dead_code)]
fn _conversations_module_link() {
    let _ = std::any::type_name::<core_conversations::Message>();
}
