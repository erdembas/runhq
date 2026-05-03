use std::path::Path;
use std::time::SystemTime;

use tokio::fs;

use crate::error::{AppError, AppResult};

use super::limits::MAX_DOC_BYTES;
use super::path::{path_to_forward_slash, safe_join};
use super::DocContent;

pub async fn read_doc(cwd: &Path, relative_path: &str) -> AppResult<DocContent> {
    let abs = safe_join(cwd, relative_path)?;
    let metadata = fs::metadata(&abs)
        .await
        .map_err(|e| AppError::NotFound(format!("doc {relative_path:?}: {e}")))?;
    if !metadata.is_file() {
        return Err(AppError::Invalid(format!(
            "{relative_path} is not a regular file"
        )));
    }
    if metadata.len() > MAX_DOC_BYTES {
        return Err(AppError::Invalid(format!(
            "{relative_path} is {} bytes — larger than the {MAX_DOC_BYTES}-byte cap",
            metadata.len()
        )));
    }
    let bytes = fs::read(&abs)
        .await
        .map_err(|e| AppError::Other(format!("read {relative_path}: {e}")))?;
    let markdown = String::from_utf8(bytes).map_err(|_| {
        AppError::Invalid(format!(
            "{relative_path} is not valid UTF-8 — refusing to render"
        ))
    })?;
    let normalised_rel = path_to_forward_slash(Path::new(relative_path));
    let base_dir = normalised_rel
        .rfind('/')
        .map(|idx| normalised_rel[..idx].to_string())
        .unwrap_or_default();
    Ok(DocContent {
        relative_path: normalised_rel,
        base_dir,
        markdown,
        size_bytes: metadata.len(),
        last_modified_ms: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    })
}
