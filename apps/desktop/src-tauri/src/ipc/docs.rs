use runhq_core::docs::{self as core_docs, DocContent, ProjectDoc};
use runhq_core::error::{AppError, AppResult};
use tauri::State;

use crate::AppState;

// ---- Project DOCS ---------------------------------------------------------
//
// Backed by `runhq_core::docs`. Every command resolves the service's
// declared `cwd` from the store so the frontend can never spoof a
// path it doesn't already control via the service definition. The
// path-traversal guard inside `runhq_core::core_docs::safe_join` is the
// final defense — `<img src="../../../etc/passwd">` in a README is
// rejected with `AppError::Invalid` long before any read syscall.

/// Discover the documentation files for a service. Returns an empty
/// Vec when the project has no README / docs/ at all — the panel
/// then falls back to its no-docs empty state without surfacing an
/// error. Failures (missing service, permission denied on cwd) DO
/// surface so the user can fix them.
#[tauri::command]
pub async fn discover_project_docs(
    service_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProjectDoc>> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    core_docs::discover_docs(&cwd).await
}

/// Read a single doc by its relative-to-cwd path. Returns the raw
/// Markdown plus the doc's directory (used by the frontend to
/// resolve relative image / intra-doc link references).
#[tauri::command]
pub async fn read_project_doc(
    service_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> AppResult<DocContent> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    core_docs::read_doc(&cwd, &relative_path).await
}

/// Resolve a relative `<img src>` referenced from a doc into a
/// `data:` URI the webview can render. The frontend only calls this
/// for paths that are NOT http(s) URLs — those it loads directly.
///
/// `base_dir` matches `DocContent.base_dir` (the directory portion
/// of the doc's relative path). An empty `base_dir` treats the
/// `src` as anchored at the project root.
#[tauri::command]
pub async fn resolve_doc_image(
    service_id: String,
    base_dir: String,
    src: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    core_docs::resolve_doc_image(&cwd, &base_dir, &src).await
}
