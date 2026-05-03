use std::path::Path;
use std::time::SystemTime;

use tokio::fs;

use crate::error::AppResult;

use super::limits::{MAX_DISCOVERED_DOCS, MAX_DOC_BYTES, MAX_WALK_DEPTH};
use super::path::path_to_forward_slash;
use super::{DocKind, ProjectDoc};

const README_CANDIDATES: &[&str] = &[
    "README.md",
    "Readme.md",
    "readme.md",
    "README.MD",
    "README.markdown",
    "README.mdx",
    "README.rst",
    "README.txt",
    "README",
];

const CHANGELOG_CANDIDATES: &[&str] = &[
    "CHANGELOG.md",
    "Changelog.md",
    "changelog.md",
    "CHANGES.md",
    "HISTORY.md",
    "RELEASES.md",
];

const CONTRIBUTING_CANDIDATES: &[&str] = &[
    "CONTRIBUTING.md",
    "Contributing.md",
    "contributing.md",
    "DEVELOPMENT.md",
    "DEVELOPING.md",
];

const ARCHITECTURE_CANDIDATES: &[&str] = &[
    "ARCHITECTURE.md",
    "Architecture.md",
    "DESIGN.md",
    "RFC.md",
    "TECHNICAL.md",
];

const OTHER_ROOT_CANDIDATES: &[&str] = &[
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "GOVERNANCE.md",
    "ROADMAP.md",
    "USAGE.md",
    "FAQ.md",
];

const LICENSE_CANDIDATES: &[&str] = &[
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "LICENCE.md",
    "COPYING",
];

const DOC_DIRS: &[&str] = &["docs", "documentation", "doc"];
const MARKDOWN_EXTS: &[&str] = &["md", "mdx", "markdown"];

pub async fn discover_docs(cwd: &Path) -> AppResult<Vec<ProjectDoc>> {
    let mut out: Vec<ProjectDoc> = Vec::new();

    for cand in README_CANDIDATES {
        if let Some(doc) = describe_file(cwd, Path::new(cand), DocKind::Readme).await? {
            out.push(doc);
            break;
        }
    }

    push_first_match(cwd, CHANGELOG_CANDIDATES, DocKind::Changelog, &mut out).await?;
    push_first_match(
        cwd,
        CONTRIBUTING_CANDIDATES,
        DocKind::Contributing,
        &mut out,
    )
    .await?;
    push_first_match(
        cwd,
        ARCHITECTURE_CANDIDATES,
        DocKind::Architecture,
        &mut out,
    )
    .await?;
    push_first_match(cwd, OTHER_ROOT_CANDIDATES, DocKind::Other, &mut out).await?;
    push_first_match(cwd, LICENSE_CANDIDATES, DocKind::License, &mut out).await?;

    for dir_name in DOC_DIRS {
        let dir = cwd.join(dir_name);
        if dir.is_dir() {
            walk_docs_dir(cwd, &dir, 0, &mut out)?;
        }
    }

    if out.len() > MAX_DISCOVERED_DOCS {
        out.truncate(MAX_DISCOVERED_DOCS);
    }
    Ok(out)
}

async fn push_first_match(
    cwd: &Path,
    candidates: &[&str],
    kind: DocKind,
    out: &mut Vec<ProjectDoc>,
) -> AppResult<()> {
    for cand in candidates {
        if let Some(doc) = describe_file(cwd, Path::new(cand), kind).await? {
            out.push(doc);
            return Ok(());
        }
    }
    Ok(())
}

fn walk_docs_dir(cwd: &Path, dir: &Path, depth: usize, out: &mut Vec<ProjectDoc>) -> AppResult<()> {
    if depth > MAX_WALK_DEPTH || out.len() >= MAX_DISCOVERED_DOCS {
        return Ok(());
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            tracing::debug!(?dir, "docs walk read_dir failed: {e}");
            return Ok(());
        }
    };
    let mut sorted: Vec<_> = entries.filter_map(Result::ok).collect();
    sorted.sort_by_key(|e| e.file_name());

    for entry in sorted {
        if out.len() >= MAX_DISCOVERED_DOCS {
            break;
        }
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }

        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if matches!(name, "node_modules" | "target" | "dist" | "build") {
                    continue;
                }
            }
            walk_docs_dir(cwd, &path, depth + 1, out)?;
            continue;
        }

        if !is_markdown_file(&path) {
            continue;
        }
        let metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() > MAX_DOC_BYTES {
            continue;
        }
        let rel = match path.strip_prefix(cwd) {
            Ok(r) => r.to_path_buf(),
            Err(_) => continue,
        };
        out.push(ProjectDoc {
            kind: DocKind::Doc,
            relative_path: path_to_forward_slash(&rel),
            display_name: path_to_forward_slash(&rel),
            size_bytes: metadata.len(),
            last_modified_ms: modified_ms(&metadata),
        });
    }
    Ok(())
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTS.iter().any(|m| m.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

async fn describe_file(
    cwd: &Path,
    relative: &Path,
    kind: DocKind,
) -> AppResult<Option<ProjectDoc>> {
    let abs = cwd.join(relative);
    let metadata = match fs::metadata(&abs).await {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if !metadata.is_file() || metadata.len() > MAX_DOC_BYTES {
        return Ok(None);
    }

    let relative_path = path_to_forward_slash(relative);
    let display_name = match kind {
        DocKind::Doc => relative_path.clone(),
        _ => relative
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(relative_path.as_str())
            .to_string(),
    };
    Ok(Some(ProjectDoc {
        kind,
        relative_path,
        display_name,
        size_bytes: metadata.len(),
        last_modified_ms: modified_ms(&metadata),
    }))
}

fn modified_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
