use runhq_core::error::{AppError, AppResult};
use runhq_core::git::{self as core_git, CommitSummary, DiffSummary, GitStatus};
use tauri::State;

use super::resolve_cwd;
use crate::AppState;

// ---- Git -----------------------------------------------------------------

// ---- Git Diff -------------------------------------------------------------

#[tauri::command]
pub fn git_diff(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff(&cwd)
}

#[tauri::command]
pub fn git_diff_staged(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_staged(&cwd)
}

#[tauri::command]
pub fn git_diff_file(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_file(&cwd, &file, context)
}

#[tauri::command]
pub fn git_diff_file_staged(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_file_staged(&cwd, &file, context)
}

#[tauri::command]
pub fn git_diff_branches(
    id: String,
    base: String,
    head: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_branches(&cwd, &base, &head)
}

#[tauri::command]
pub fn git_diff_all_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_all_raw(&cwd)
}

#[tauri::command]
pub fn git_diff_staged_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_staged_raw(&cwd)
}

#[tauri::command]
pub fn git_status(id: String, state: State<'_, AppState>) -> AppResult<Option<GitStatus>> {
    let cwd = resolve_cwd(&id, &state)?;
    Ok(core_git::status(&cwd))
}

#[tauri::command]
pub fn git_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::list_branches(&cwd)
}

#[tauri::command]
pub fn git_remote_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::list_remote_branches(&cwd)
}

#[tauri::command]
pub fn git_checkout(id: String, branch: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::checkout(&cwd, &branch)
}

#[tauri::command]
pub fn git_create_branch(id: String, name: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::create_branch(&cwd, &name)
}

#[tauri::command]
pub fn git_delete_branch(
    id: String,
    name: String,
    force: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::delete_branch(&cwd, &name, force)
}

#[tauri::command]
pub async fn git_fetch(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || core_git::fetch(&cwd))
        .await
        .map_err(|e| AppError::Other(format!("fetch task join failed: {e}")))?
}

#[tauri::command]
pub async fn git_pull(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || core_git::pull(&cwd))
        .await
        .map_err(|e| AppError::Other(format!("pull task join failed: {e}")))?
}

#[tauri::command]
pub fn git_stash(id: String, message: Option<String>, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::stash(&cwd, message.as_deref())
}

#[tauri::command]
pub fn git_stash_pop(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::stash_pop(&cwd)
}

#[tauri::command]
pub fn git_undo_last_commit(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::undo_last_commit(&cwd)
}

#[tauri::command]
pub fn git_amend_commit_message(
    id: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::amend_commit_message(&cwd, &message)
}

#[tauri::command]
pub fn git_stage_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::stage_file(&cwd, &path)
}

#[tauri::command]
pub fn git_unstage_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::unstage_file(&cwd, &path)
}

#[tauri::command]
pub fn git_stage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::stage_all(&cwd)
}

#[tauri::command]
pub fn git_unstage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::unstage_all(&cwd)
}

#[tauri::command]
pub fn git_discard_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::discard_file(&cwd, &path)
}

#[tauri::command]
pub fn git_commit(
    id: String,
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::commit(&cwd, &message, amend)
}

#[tauri::command]
pub async fn git_push(
    id: String,
    force_with_lease: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || core_git::push(&cwd, force_with_lease))
        .await
        .map_err(|e| AppError::Other(format!("push task join failed: {e}")))?
}

#[tauri::command]
pub fn git_log(
    id: String,
    branch: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitSummary>> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::log(&cwd, branch.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn git_show_commit(
    id: String,
    hash: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::show_commit(&cwd, &hash)
}

#[tauri::command]
pub fn git_diff_commit_file(
    id: String,
    hash: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    core_git::diff_commit_file(&cwd, &hash, &file, context)
}
