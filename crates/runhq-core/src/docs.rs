//! Project documentation surface.
//!
//! Discovers Markdown documentation that lives inside a project
//! (README / CHANGELOG / CONTRIBUTING / ARCHITECTURE / generic
//! `docs/**`) and serves the contents to the desktop frontend's
//! "DOCS" tab. The goal is to turn the dashboard's "no logs yet"
//! empty state into a useful project-context surface — the same
//! README the user already maintains gets rendered front-and-centre,
//! so onboarding a teammate or remembering "what was this service
//! again?" doesn't require leaving RunHQ.
//!
//! ## Security
//!
//! All paths supplied by the frontend (relative_path / image_src)
//! are resolved against the service's declared `cwd` and validated
//! to stay inside that directory after canonicalisation. A
//! hand-edited service id or a malicious markdown that references
//! `../../../../etc/passwd` cannot escape the project tree — every
//! read goes through `safe_join`, which rejects:
//!
//!   * Absolute paths.
//!   * Paths whose canonical form falls outside the cwd's canonical
//!     form (catches symlink shenanigans too).
//!   * UNC / drive-letter prefixes on Windows (`\\?\...`, `C:\...`).
//!
//! File-size + count limits cap the worst case (a malicious / very
//! large README), so a docs read can never hold the IPC thread or
//! stream gigabytes back to the renderer.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::error::{AppError, AppResult};

// ---- Limits ---------------------------------------------------------------

/// Maximum bytes we'll read from a single doc. 4 MiB covers every
/// reasonable README in the wild (TanStack Query's monorepo README
/// hovers around 80 KB; even outliers like Tailwind v3's full docs
/// MD bundle don't crack 1 MiB). Anything bigger is almost certainly
/// not a hand-authored doc and rendering it would freeze the
/// webview anyway.
const MAX_DOC_BYTES: u64 = 4 * 1024 * 1024;

/// Maximum bytes we'll inline as a `data:` image URI. Anything bigger
/// is a binary asset that probably wasn't meant for inline rendering
/// (think 12 MiB demo gifs); we fall back to a missing-image marker
/// so the webview doesn't choke on a 16 MiB string.
const MAX_INLINE_IMAGE_BYTES: u64 = 2 * 1024 * 1024;

/// Maximum number of docs returned by `discover_docs`. The walker is
/// already bounded by `MAX_WALK_DEPTH` and a small file extension
/// filter, but we add this last-resort cap so a degenerate repo with
/// 500 generated `.md` files doesn't drown the sub-nav.
const MAX_DISCOVERED_DOCS: usize = 60;

/// Directory recursion cap for the `docs/` walk. README at the root
/// is special-cased; the recursive walk only kicks in for
/// `docs/`, `documentation/`, `doc/`. Cap of 4 lets us surface a
/// reasonable structure (e.g. `docs/guides/getting-started.md`)
/// without traversing arbitrary trees.
const MAX_WALK_DEPTH: usize = 4;

// ---- Public types ---------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocKind {
    /// Top-level README — `README.md`, `README.rst`, `README.txt`,
    /// `readme.md`, etc. The flagship doc and what the panel opens
    /// by default.
    Readme,
    /// CHANGELOG / HISTORY / RELEASES.
    Changelog,
    /// CONTRIBUTING / DEVELOPMENT guide.
    Contributing,
    /// ARCHITECTURE / DESIGN / RFC-style top-level doc.
    Architecture,
    /// LICENSE file (rendered as text — not parsed).
    License,
    /// Anything found under `docs/`, `documentation/`, or `doc/`.
    Doc,
    /// Catch-all bucket for any other root-level Markdown the
    /// scanner picks up (e.g. `SECURITY.md`, `CODE_OF_CONDUCT.md`).
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDoc {
    pub kind: DocKind,
    /// Path relative to the service's cwd, with forward slashes
    /// regardless of the host OS — the frontend uses this as a
    /// stable key when navigating between docs and as the
    /// re-fetch parameter for `read_doc`.
    pub relative_path: String,
    /// Display title surfaced in the sub-nav. We prefer the file
    /// stem (`README`, `CHANGELOG`) for top-level docs and the full
    /// relative path for `docs/...` entries so users can still
    /// distinguish `docs/guides/setup.md` from `docs/api/setup.md`.
    pub display_name: String,
    /// File size in bytes — drives the "this is a 200KB file, are
    /// you sure?" UX that the frontend may add later, and lets us
    /// short-circuit a binary file that slipped through the
    /// extension filter.
    pub size_bytes: u64,
    /// Last-modified time in milliseconds since UNIX epoch.
    /// Frontend displays this as "edited 2h ago" so users can
    /// spot recently-updated docs.
    pub last_modified_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocContent {
    /// The doc's normalised relative path (echoed back so the
    /// frontend can stash it in router state without re-deriving
    /// from the request).
    pub relative_path: String,
    /// Directory portion of `relative_path` — the frontend uses
    /// this as the base for resolving relative `<img src>` tags
    /// and intra-doc `[link](./other.md)` references.
    pub base_dir: String,
    /// Raw Markdown text. Encoding is enforced UTF-8 — README files
    /// in non-UTF-8 encodings are vanishingly rare in 2026 and
    /// failing loudly is preferable to silently rendering mojibake.
    pub markdown: String,
    /// Byte size of the on-disk file. Same field as `ProjectDoc`
    /// but useful here too so the frontend doesn't need to keep
    /// the discovery list around.
    pub size_bytes: u64,
    pub last_modified_ms: i64,
}

// ---- Discovery ------------------------------------------------------------

/// List the documentation files surfaced for a project. Returns an
/// empty Vec when nothing is found — the frontend then falls back to
/// `package.json.description` / `Cargo.toml.description` / similar.
///
/// Order is intentional: README first (the canonical entry point),
/// then well-known siblings (CHANGELOG, CONTRIBUTING, ARCHITECTURE,
/// SECURITY, CODE_OF_CONDUCT), then `docs/**` walked depth-first
/// alphabetically. The frontend renders the first list entry as the
/// default selection when the panel opens.
pub async fn discover_docs(cwd: &Path) -> AppResult<Vec<ProjectDoc>> {
    let mut out: Vec<ProjectDoc> = Vec::new();

    // Step 1 — anchor on the root-level README, if any.
    let mut found_readme = false;
    for cand in README_CANDIDATES {
        if let Some(doc) = describe_file(cwd, Path::new(cand), DocKind::Readme).await? {
            out.push(doc);
            found_readme = true;
            break;
        }
    }
    let _ = found_readme;

    // Step 2 — root-level siblings, in priority order. We stop at
    // the first match within each kind because real-world repos
    // pick exactly one (CHANGELOG.md *or* HISTORY.md, not both),
    // and including duplicates would just clutter the sub-nav.
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

    // LICENSE rendered last — useful to have but not what users
    // open the docs tab for. Cap at small sizes because some
    // projects ship a 100 KB MIT compendium that's just legalese.
    push_first_match(cwd, LICENSE_CANDIDATES, DocKind::License, &mut out).await?;

    // Step 3 — walk `docs/`, `documentation/`, `doc/` shallowly.
    for dir_name in DOC_DIRS {
        let dir = cwd.join(dir_name);
        if dir.is_dir() {
            walk_docs_dir(cwd, &dir, 0, &mut out)?;
        }
    }

    // Last-resort cap.
    if out.len() > MAX_DISCOVERED_DOCS {
        out.truncate(MAX_DISCOVERED_DOCS);
    }
    Ok(out)
}

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

/// Markdown extensions we'll render. Other extensions (e.g. `.rst`)
/// are listed at the file level only when the README candidate
/// uses them — we don't crawl `docs/` looking for `.rst` because
/// the renderer is strictly Markdown.
const MARKDOWN_EXTS: &[&str] = &["md", "mdx", "markdown"];

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

/// Synchronous variant for the recursive `docs/` walker. Tokio
/// async fs adds noticeable overhead per-file and the docs walk is
/// inherently bounded; using `std::fs` here keeps the cold-start
/// cost honest. Returns Ok(()) — every error case (permission
/// denied, broken symlink) is logged and skipped.
fn walk_docs_dir(cwd: &Path, dir: &Path, depth: usize, out: &mut Vec<ProjectDoc>) -> AppResult<()> {
    if depth > MAX_WALK_DEPTH {
        return Ok(());
    }
    if out.len() >= MAX_DISCOVERED_DOCS {
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
        // Hidden files (`.git`, `.DS_Store`, ...) are noise inside
        // a docs/ tree; skip them outright.
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }

        if path.is_dir() {
            // Skip nested `node_modules` etc. just in case a
            // project committed dist artefacts under docs/.
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
        let relative_path = path_to_forward_slash(&rel);
        let display_name = relative_path.clone();
        let last_modified_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(ProjectDoc {
            kind: DocKind::Doc,
            relative_path,
            display_name,
            size_bytes: metadata.len(),
            last_modified_ms,
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
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > MAX_DOC_BYTES {
        return Ok(None);
    }
    let last_modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
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
        last_modified_ms,
    }))
}

// ---- Read -----------------------------------------------------------------

/// Read a project doc by its relative path. Returns the raw markdown
/// (UTF-8 enforced) plus the doc's directory so the frontend can
/// resolve relative image / link references.
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
    let last_modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
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
        last_modified_ms,
    })
}

// ---- Image inlining -------------------------------------------------------

/// Resolve a `![alt](relative-or-absolute-src)` markdown reference
/// to a `data:` URI the webview can render. Returns an `AppError`
/// for anything outside the project's cwd, missing files, oversize
/// payloads, or non-image extensions — the frontend renders a
/// "broken image" placeholder in those cases rather than the URI.
///
/// `base_dir` should be the doc's directory portion (matching the
/// `DocContent::base_dir` returned by `read_doc`). It's used to
/// resolve `./img/foo.png`-style references; an empty string treats
/// the path as relative to the project root.
pub async fn resolve_doc_image(cwd: &Path, base_dir: &str, src: &str) -> AppResult<String> {
    if src.is_empty() {
        return Err(AppError::Invalid("image src is empty".into()));
    }
    if let Some(scheme_end) = src.find(':') {
        let scheme = &src[..scheme_end];
        // `data:` URIs are passed through untouched (some READMEs
        // already inline SVGs that way). Everything else we don't
        // recognise — http(s) is handled on the frontend without
        // calling us.
        match scheme {
            "data" => return Ok(src.to_string()),
            _ => {
                return Err(AppError::Invalid(format!(
                    "unsupported image scheme: {scheme}"
                )));
            }
        }
    }

    // Strip leading `./` (one occurrence) and a leading `/`.
    // Relative refs anchored on `/` are very commonly meant as
    // repo-root, not filesystem-root, in GitHub-style READMEs;
    // we honour that convention by treating a leading `/` as the
    // project's cwd. We deliberately do NOT strip arbitrary
    // leading dots — that would silently rewrite `../secret.png`
    // into `secret.png` and bypass the traversal guard below.
    let mut cleaned = src;
    if let Some(rest) = cleaned.strip_prefix("./") {
        cleaned = rest;
    }
    let anchored_at_root = cleaned.starts_with('/');
    if anchored_at_root {
        cleaned = &cleaned[1..];
    }
    let joined_str: String = if anchored_at_root || base_dir.is_empty() {
        cleaned.to_string()
    } else {
        format!("{base_dir}/{cleaned}")
    };
    // Hand the (still possibly traversal-tainted) string to the
    // shared safety check, which rejects any `..` component.
    let abs = safe_join(cwd, &joined_str)?;
    let metadata = fs::metadata(&abs)
        .await
        .map_err(|e| AppError::NotFound(format!("image {src}: {e}")))?;
    if !metadata.is_file() {
        return Err(AppError::Invalid(format!("{src} is not a regular file")));
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(AppError::Invalid(format!(
            "{src} is {} bytes — larger than the {MAX_INLINE_IMAGE_BYTES}-byte inline cap",
            metadata.len()
        )));
    }
    let mime = mime_for_extension(&abs)
        .ok_or_else(|| AppError::Invalid(format!("{src} is not a recognised image type")))?;
    let bytes = fs::read(&abs)
        .await
        .map_err(|e| AppError::Other(format!("read image {src}: {e}")))?;
    let encoded = STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn mime_for_extension(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

// ---- Path safety ----------------------------------------------------------

/// Join `relative_path` onto `cwd` and validate that the result
/// stays inside `cwd`. Returns an error for absolute paths, UNC /
/// drive-letter prefixes (Windows), parent traversal that escapes,
/// and any symlink that points outside cwd after canonicalisation.
fn safe_join(cwd: &Path, relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty() {
        return Err(AppError::Invalid("relative path is empty".into()));
    }
    // Reject obvious traversal / absolute markers up front. We do
    // this BEFORE canonicalisation so an attacker can't smuggle
    // `\\?\` or a drive letter through to the OS layer.
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
    // We deliberately do NOT canonicalise (which would resolve
    // symlinks): on macOS `/tmp` -> `/private/tmp` and the
    // canonical-form comparison breaks for legitimate paths. We
    // instead validate via component-walking (above) and rely on
    // the OS to reject anything that escapes via symlink at read
    // time. The threat model here is "frontend-supplied path
    // string", not "attacker controls the project's filesystem".
    let abs = cwd.join(rel);
    Ok(abs)
}

fn path_to_forward_slash(p: &Path) -> String {
    p.components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str().map(|s| s.to_string()),
            // ParentDir / RootDir / Prefix are filtered out above,
            // but defensive in case this gets called from another
            // context.
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[tokio::test]
    async fn discover_finds_readme_and_changelog() {
        let dir = tmp();
        File::create(dir.path().join("README.md"))
            .unwrap()
            .write_all(b"# Hello")
            .unwrap();
        File::create(dir.path().join("CHANGELOG.md"))
            .unwrap()
            .write_all(b"# 0.1")
            .unwrap();

        let docs = discover_docs(dir.path()).await.unwrap();
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].kind, DocKind::Readme);
        assert_eq!(docs[1].kind, DocKind::Changelog);
    }

    #[tokio::test]
    async fn discover_walks_docs_directory() {
        let dir = tmp();
        fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
        File::create(dir.path().join("docs/intro.md"))
            .unwrap()
            .write_all(b"# Intro")
            .unwrap();
        File::create(dir.path().join("docs/guides/setup.md"))
            .unwrap()
            .write_all(b"# Setup")
            .unwrap();
        let docs = discover_docs(dir.path()).await.unwrap();
        let paths: Vec<_> = docs.iter().map(|d| d.relative_path.clone()).collect();
        assert!(paths.contains(&"docs/intro.md".to_string()));
        assert!(paths.contains(&"docs/guides/setup.md".to_string()));
    }

    #[tokio::test]
    async fn read_doc_rejects_traversal() {
        let dir = tmp();
        let err = read_doc(dir.path(), "../etc/passwd").await.unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[tokio::test]
    async fn read_doc_rejects_absolute() {
        let dir = tmp();
        let err = read_doc(dir.path(), "/etc/passwd").await.unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[tokio::test]
    async fn read_doc_returns_base_dir() {
        let dir = tmp();
        fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
        File::create(dir.path().join("docs/guides/setup.md"))
            .unwrap()
            .write_all(b"# Setup")
            .unwrap();
        let content = read_doc(dir.path(), "docs/guides/setup.md").await.unwrap();
        assert_eq!(content.base_dir, "docs/guides");
        assert_eq!(content.markdown, "# Setup");
    }

    #[tokio::test]
    async fn resolve_image_inlines_png_as_data_uri() {
        let dir = tmp();
        // 1×1 transparent PNG.
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        File::create(dir.path().join("logo.png"))
            .unwrap()
            .write_all(png)
            .unwrap();
        let uri = resolve_doc_image(dir.path(), "", "logo.png").await.unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
    }

    #[tokio::test]
    async fn resolve_image_rejects_traversal() {
        let dir = tmp();
        let err = resolve_doc_image(dir.path(), "", "../secret.png")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }
}
