use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock, Weak},
};

use parking_lot::Mutex;
use runhq_core::error::{AppError, AppResult};
use runhq_core::git::{self as core_git, CommitSummary, DiffSummary, GitStatus};
use tauri::State;

use super::resolve_cwd;
use crate::AppState;

static GIT_READS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
type MutationGates = HashMap<PathBuf, Weak<tokio::sync::Mutex<()>>>;
static GIT_MUTATIONS: OnceLock<Mutex<MutationGates>> = OnceLock::new();

// A history view can request hundreds of file diffs at once. Wait before
// spawning work so it cannot exhaust the blocking pool or flood the machine
// with git processes while terminals and agents are producing output.
pub(super) async fn read<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let permit = GIT_READS
        .acquire()
        .await
        .map_err(|error| AppError::other(error.to_string()))?;
    super::blocking(move || {
        let _permit = permit;
        task()
    })
    .await
}

async fn mutate<T: Send + 'static>(
    cwd: PathBuf,
    task: impl FnOnce(&Path) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let (cwd, key) = read(move || {
        let key = core_git::common_directory(&cwd)?;
        Ok((cwd, key))
    })
    .await?;
    let gate = {
        let mut gates = GIT_MUTATIONS.get_or_init(Mutex::default).lock();
        gates.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
            gate
        } else {
            let gate = Arc::new(tokio::sync::Mutex::new(()));
            gates.insert(key, Arc::downgrade(&gate));
            gate
        }
    };
    let guard = gate.lock_owned().await;
    super::blocking(move || {
        // Blocking tasks continue after their async caller is cancelled. Keep
        // the guard in the task so another writer still waits for completion.
        let _guard = guard;
        task(&cwd)
    })
    .await
}

// ---- Git -----------------------------------------------------------------

// ---- Git Diff -------------------------------------------------------------

#[tauri::command]
pub async fn git_diff(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff(&cwd)).await
}

#[tauri::command]
pub async fn git_diff_staged(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_staged(&cwd)).await
}

#[tauri::command]
pub async fn git_diff_file(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_file(&cwd, &file, context)).await
}

#[tauri::command]
pub async fn git_diff_file_staged(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_file_staged(&cwd, &file, context)).await
}

#[tauri::command]
pub async fn git_diff_branches(
    id: String,
    base: String,
    head: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_branches(&cwd, &base, &head)).await
}

#[tauri::command]
pub async fn git_diff_all_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_all_raw(&cwd)).await
}

#[tauri::command]
pub async fn git_diff_staged_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_staged_raw(&cwd)).await
}

#[tauri::command]
pub async fn git_status(id: String, state: State<'_, AppState>) -> AppResult<Option<GitStatus>> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || Ok(core_git::status(&cwd))).await
}

#[tauri::command]
pub async fn git_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::list_branches(&cwd)).await
}

#[tauri::command]
pub async fn git_remote_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::list_remote_branches(&cwd)).await
}

#[tauri::command]
pub async fn git_checkout(id: String, branch: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::checkout(cwd, &branch)).await
}

#[tauri::command]
pub async fn git_create_branch(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::create_branch(cwd, &name)).await
}

#[tauri::command]
pub async fn git_delete_branch(
    id: String,
    name: String,
    force: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::delete_branch(cwd, &name, force)).await
}

#[tauri::command]
pub async fn git_fetch(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::fetch).await
}

#[tauri::command]
pub async fn git_pull(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::pull).await
}

#[tauri::command]
pub async fn git_stash(
    id: String,
    message: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::stash(cwd, message.as_deref())).await
}

#[tauri::command]
pub async fn git_stash_pop(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::stash_pop).await
}

#[tauri::command]
pub async fn git_undo_last_commit(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::undo_last_commit).await
}

#[tauri::command]
pub async fn git_amend_commit_message(
    id: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| {
        core_git::amend_commit_message(cwd, &message)
    })
    .await
}

#[tauri::command]
pub async fn git_stage_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::stage_file(cwd, &path)).await
}

#[tauri::command]
pub async fn git_unstage_file(
    id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::unstage_file(cwd, &path)).await
}

#[tauri::command]
pub async fn git_stage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::stage_all).await
}

#[tauri::command]
pub async fn git_unstage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, core_git::unstage_all).await
}

#[tauri::command]
pub async fn git_discard_file(
    id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::discard_file(cwd, &path)).await
}

#[tauri::command]
pub async fn git_commit(
    id: String,
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::commit(cwd, &message, amend)).await
}

#[tauri::command]
pub async fn git_push(
    id: String,
    force_with_lease: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    mutate(cwd, move |cwd| core_git::push(cwd, force_with_lease)).await
}

#[tauri::command]
pub async fn git_log(
    id: String,
    branch: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitSummary>> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::log(&cwd, branch.as_deref(), limit.unwrap_or(100))).await
}

#[tauri::command]
pub async fn git_show_commit(
    id: String,
    hash: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::show_commit(&cwd, &hash)).await
}

#[tauri::command]
pub async fn git_diff_commit_file(
    id: String,
    hash: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    read(move || core_git::diff_commit_file(&cwd, &hash, &file, context)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Repo(PathBuf);

    impl Repo {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("runhq-git-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(path.join("nested")).unwrap();
            let output = std::process::Command::new("git")
                .args(["init", "-q"])
                .current_dir(&path)
                .output()
                .unwrap();
            assert!(output.status.success());
            Self(path)
        }
    }

    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn cancelled_writer_holds_its_repository_gate_until_io_finishes() {
        let first_repo = Repo::new();
        let other_repo = Repo::new();
        let (started, running) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let first = tokio::spawn(mutate(first_repo.0.clone(), move |_| {
            let _ = started.send(());
            wait.recv_timeout(Duration::from_secs(5))
                .map_err(|error| AppError::other(error.to_string()))?;
            Ok(())
        }));
        tokio::time::timeout(Duration::from_secs(5), running)
            .await
            .unwrap()
            .unwrap();
        first.abort();
        assert!(first.await.unwrap_err().is_cancelled());

        let (second_started, mut second_running) = tokio::sync::oneshot::channel();
        let second = tokio::spawn(mutate(first_repo.0.join("nested"), move |_| {
            let _ = second_started.send(());
            Ok(())
        }));
        // An unrelated repository remains usable while the first writer runs.
        tokio::time::timeout(
            Duration::from_secs(2),
            mutate(other_repo.0.clone(), |_| Ok(())),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut second_running)
                .await
                .is_err()
        );
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), second)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        second_running.await.unwrap();
    }
}
