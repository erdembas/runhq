use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub(super) fn safe_join(cwd: &Path, relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty() {
        return Err(AppError::Invalid("relative path is empty".into()));
    }
    if relative.contains("\\\\") || relative.contains("..\\") {
        return Err(AppError::Invalid(
            "relative path contains rejected backslash sequence".into(),
        ));
    }
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err(AppError::Invalid("absolute paths are not allowed".into()));
    }
    if rel.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir | std::path::Component::RootDir
        )
    }) {
        return Err(AppError::Invalid(
            "parent / root path components are not allowed".into(),
        ));
    }
    Ok(cwd.join(rel))
}

pub(super) fn path_to_forward_slash(p: &Path) -> String {
    p.components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str().map(|s| s.to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}
