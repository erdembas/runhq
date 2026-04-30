//! Per-project Markdown notes — multi-note edition.
//!
//! Each registered service can carry an arbitrary number of note
//! files at `$RUNHQ_HOME/notes/<service-id>/<note-name>.md`. These
//! notes act as a project-specific scratchpad ("why
//! `--legacy-peer-deps` is needed", "DB seed command before demo",
//! "deployment checklist") and are automatically injected into the
//! AI Chat panel's "Project Q&A" feature, concatenated with H1
//! separators so the model sees one cohesive notebook per project.
//!
//! Storage layout
//! --------------
//! ```text
//! $RUNHQ_HOME/notes/
//!   ├─ <service-id-A>/
//!   │   ├─ index.md
//!   │   ├─ deployment.md
//!   │   └─ on-call.md
//!   └─ <service-id-B>/
//!       └─ index.md
//! ```
//!
//! Legacy migration
//! ----------------
//! v0.10 introduced multi-note. Before that, each service had
//! exactly one note file at `$RUNHQ_HOME/notes/<service-id>.md`.
//! The first time `list_notes(service_id)` is called for a service
//! whose legacy file still exists, we migrate it in-place to
//! `<service-id>/index.md` and proceed normally. The migration is
//! idempotent: if both forms exist (a corrupt sync, say), the
//! directory wins and the loose file is left untouched (we don't
//! silently overwrite directory content with a stale single-file
//! copy).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

use crate::paths;

/// Cap on the on-disk filename derived from a service id or note
/// name. UUIDs we mint are 36 chars, but a hand-edited config could
/// produce longer strings; clamping here protects against `File
/// name too long` (255 bytes on most ext4/HFS+/NTFS deployments).
const MAX_FILENAME_LEN: usize = 200;

/// Maximum number of bytes any single note may carry. Hard cap to
/// prevent a runaway paste (1 GB of base64 image) from filling the
/// home directory or stalling AI context builds. 1 MiB is generous
/// for prose — `War and Peace` is ~3 MB of plain text, no engineer
/// needs that much per-project context.
const MAX_NOTE_BYTES: u64 = 1024 * 1024;

/// Total characters across ALL notes per service that the AI
/// context concatenator will ship. Caps the AI payload size since
/// every note is pulled into every Project Q&A turn — without this
/// limit, a service with 30 deployment runbooks would burn the
/// entire model context window before the user's question even
/// arrives.
const MAX_AI_CONTEXT_CHARS: usize = 8000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NoteFile {
    /// Stable on-disk filename without the `.md` suffix
    /// (e.g. `index`, `deployment`, `on-call`). Used as the key
    /// for `read_note` / `write_note` / `delete_note` calls.
    pub name: String,
    /// Display title — first H1 in the file if present, otherwise
    /// the filename. Computed at list time so the UI doesn't have
    /// to read every file just to render the sub-nav.
    pub title: String,
    /// File size in bytes — surfaced in the sub-nav for "this
    /// note is huge, maybe split it" affordance.
    pub size_bytes: u64,
    /// Last-modified time, milliseconds since unix epoch. Used to
    /// sort the note list (most-recently-edited first) so the
    /// note the user is actively iterating on stays at the top.
    pub updated_at_ms: u64,
}

fn notes_root() -> Result<PathBuf> {
    let dir = paths::runhq_home()?.join("notes");
    fs::create_dir_all(&dir).ok();
    Ok(dir)
}

/// Sanitise a service id into a safe directory name. See module-
/// level rationale for the exact rules; identical to the v0.9
/// behaviour so legacy files keep mapping to the same id-derived
/// path.
fn sanitise_component(input: &str, what: &str) -> Result<String> {
    if input.is_empty() {
        return Err(anyhow!("{what} is empty"));
    }
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{what} is whitespace-only"));
    }
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => out.push('_'),
            c if (c as u32) < 0x20 => out.push('_'),
            c => out.push(c),
        }
    }
    if out == "." || out == ".." {
        return Err(anyhow!("{what} resolves to a path traversal token"));
    }
    let cleaned = out.trim_start_matches(|c: char| c == '.' || c.is_whitespace());
    let cleaned = cleaned.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if cleaned.is_empty() {
        return Err(anyhow!(
            "{what} has no usable characters after sanitisation"
        ));
    }
    let base_upper = cleaned.to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&base_upper.as_str()) {
        return Err(anyhow!(
            "{what} collides with a Windows reserved device name"
        ));
    }
    let truncated: String = if cleaned.len() > MAX_FILENAME_LEN {
        cleaned
            .char_indices()
            .take_while(|(idx, _)| *idx < MAX_FILENAME_LEN)
            .map(|(_, ch)| ch)
            .collect()
    } else {
        cleaned.to_string()
    };
    Ok(truncated)
}

fn service_dir(service_id: &str) -> Result<PathBuf> {
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    Ok(root.join(safe))
}

/// In-place migration of the v0.9 single-file layout to the v0.10
/// directory layout. Called from every list/read entry point so the
/// migration window stays open as long as legacy files exist on
/// disk — we never know when a long-running background user will
/// upgrade. Idempotent: if both forms already exist (mid-migration
/// crash, weird sync state) the directory wins.
fn migrate_legacy_if_needed(service_id: &str) -> Result<()> {
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    let legacy_path = root.join(format!("{safe}.md"));
    if !legacy_path.exists() || !legacy_path.is_file() {
        return Ok(());
    }
    let new_dir = root.join(&safe);
    let new_index = new_dir.join("index.md");
    if new_dir.exists() {
        // Directory already there — assume the user (or a sibling
        // installation) created notes after the migration. Don't
        // clobber; just remove the orphan legacy file so we stop
        // re-checking on every list.
        let _ = fs::remove_file(&legacy_path);
        return Ok(());
    }
    fs::create_dir_all(&new_dir).with_context(|| format!("creating {}", new_dir.display()))?;
    fs::rename(&legacy_path, &new_index).with_context(|| {
        format!(
            "migrating legacy note {} → {}",
            legacy_path.display(),
            new_index.display()
        )
    })?;
    Ok(())
}

fn note_path(service_id: &str, name: &str) -> Result<PathBuf> {
    let dir = service_dir(service_id)?;
    let safe = sanitise_component(name, "note name")?;
    Ok(dir.join(format!("{safe}.md")))
}

/// First H1 in the markdown body, or `None` if the document
/// doesn't lead with one. We match `# title` *only* on the leading
/// line(s) (skipping blank lines); a `# header` halfway down a long
/// note is meant to be a section header inside the doc, not the
/// document's title. Also tolerates `# title` followed by trailing
/// whitespace and the optional `\r` from CRLF files.
fn extract_title(markdown: &str) -> Option<String> {
    for raw_line in markdown.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("# ") {
            let title = rest.trim().trim_end_matches('#').trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
        // First non-blank line wasn't a heading — bail so a `## H2`
        // halfway down doesn't become the title for a leading-prose
        // note.
        return None;
    }
    None
}

fn mtime_ms(path: &Path) -> u64 {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return 0,
    };
    let modified = match meta.modified() {
        Ok(t) => t,
        Err(_) => return 0,
    };
    modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// List every note for a service in display order (most recently
/// edited first). Returns an empty `Vec` when the service has no
/// notes yet — the caller decides whether to show an empty state or
/// auto-create a default note.
pub fn list_notes(service_id: &str) -> Result<Vec<NoteFile>> {
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<NoteFile> = Vec::new();
    for entry in fs::read_dir(&dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        let Some(stem) = fname_str.strip_suffix(".md") else {
            continue;
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Skip hidden / temp atoms (`.foo.md.tmp` from a half-
        // written save). They're an implementation detail of the
        // atomic-rename write, not user-facing notes.
        if stem.starts_with('.') {
            continue;
        }
        let body = fs::read_to_string(&path).unwrap_or_default();
        let title = extract_title(&body).unwrap_or_else(|| stem.to_string());
        let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let updated_at_ms = mtime_ms(&path);
        out.push(NoteFile {
            name: stem.to_string(),
            title,
            size_bytes,
            updated_at_ms,
        });
    }
    out.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

/// Read a single named note. Returns an empty string when the file
/// doesn't exist yet — useful for the editor's first-paint flow
/// (the UI calls read immediately after create + before the user
/// types) without forcing the caller to special-case "not found".
pub fn read_note(service_id: &str, name: &str) -> Result<String> {
    migrate_legacy_if_needed(service_id)?;
    let path = note_path(service_id, name)?;
    if path.exists() {
        fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
    } else {
        Ok(String::new())
    }
}

/// Write (create or overwrite) a named note. Atomic via tmp-file +
/// rename, matching the pattern used by `state.rs`.
pub fn write_note(service_id: &str, name: &str, content: &str) -> Result<()> {
    if content.len() as u64 > MAX_NOTE_BYTES {
        return Err(anyhow!(
            "note exceeds {} byte cap (got {} bytes)",
            MAX_NOTE_BYTES,
            content.len()
        ));
    }
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = note_path(service_id, name)?;
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, &path).with_context(|| format!("renaming into {}", path.display()))?;
    Ok(())
}

/// Delete a single named note. Returns `true` if a file was
/// removed. When the directory is left empty after the delete we
/// also remove it — keeps `list_noted_services()` honest (a
/// directory with zero `.md` files would otherwise still report
/// the service as "noted").
pub fn delete_note(service_id: &str, name: &str) -> Result<bool> {
    migrate_legacy_if_needed(service_id)?;
    let path = note_path(service_id, name)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path).with_context(|| format!("deleting {}", path.display()))?;
    // Cleanup empty service directory.
    if let Ok(dir) = service_dir(service_id) {
        if let Ok(mut iter) = fs::read_dir(&dir) {
            if iter.next().is_none() {
                let _ = fs::remove_dir(&dir);
            }
        }
    }
    Ok(true)
}

/// Delete EVERY note for a service. Used by the service-removal
/// IPC path so a deleted service doesn't leak notes onto the next
/// service that happens to reuse the same id (extremely unlikely
/// with v4 UUIDs, but the cost of cleanup is zero).
pub fn delete_all_notes(service_id: &str) -> Result<()> {
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).with_context(|| format!("removing {}", dir.display()))?;
    }
    // Belt-and-braces: if a stale legacy file somehow lingered
    // (concurrent migration vs. delete race), drop it too.
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    let legacy = root.join(format!("{safe}.md"));
    if legacy.exists() && legacy.is_file() {
        let _ = fs::remove_file(&legacy);
    }
    Ok(())
}

/// Create a new note with a unique, human-readable name. If
/// `requested_name` is `Some`, that's used as the seed; otherwise
/// we default to "untitled". A numeric suffix (`-2`, `-3`, …) is
/// appended until the name doesn't collide with an existing note.
/// Returns the final filename (without extension) so the caller
/// can immediately `read_note` / `write_note` against it.
pub fn create_note(service_id: &str, requested_name: Option<&str>) -> Result<String> {
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let seed_raw = requested_name.unwrap_or("untitled");
    // We sanitise the seed through the SAME pipeline the write
    // path uses, then slugify (lowercase + hyphens) so the on-disk
    // name is predictable across OSes.
    let sanitised = sanitise_component(seed_raw, "note name")?;
    let slug = slugify(&sanitised);
    let base = if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    };
    // Find the first non-colliding `<base>-<n>` (or `<base>` if the
    // bare slug is free).
    let candidate = first_free_name(&dir, &base);
    let path = dir.join(format!("{candidate}.md"));
    // Touch an empty file so subsequent reads/writes have a real
    // inode to point at and `list_notes` returns the new entry
    // immediately.
    fs::write(&path, "").with_context(|| format!("creating {}", path.display()))?;
    Ok(candidate)
}

/// Best-effort filesystem-friendly slug. Lowercases ASCII, replaces
/// runs of non-alphanumeric with `-`, trims edges. Pure-Unicode
/// strings (e.g. `"deploy-üretim"`) survive without dropping the
/// non-ASCII chars — `sanitise_component` already filtered the
/// truly dangerous bytes.
fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
        let lower = ch.to_lowercase().next().unwrap_or(ch);
        if lower.is_alphanumeric() {
            out.push(lower);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn first_free_name(dir: &Path, base: &str) -> String {
    if !dir.join(format!("{base}.md")).exists() {
        return base.to_string();
    }
    for n in 2u32..=9999 {
        let candidate = format!("{base}-{n}");
        if !dir.join(format!("{candidate}.md")).exists() {
            return candidate;
        }
    }
    // Last-ditch: append a timestamp. Astronomically unlikely path,
    // but we'd rather create a weird-named note than panic.
    format!(
        "{base}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

/// Concatenate every note in a service into a single Markdown
/// document, in the same display order `list_notes` returns. Used
/// by the AI context builder so Project Q&A sees the full
/// notebook rather than a single arbitrarily-named file.
///
/// Each note is prefixed with a `## <title>` header so the model
/// can attribute statements to a specific note ("the deployment
/// note says…"). Capped at `MAX_AI_CONTEXT_CHARS` total — when the
/// cap trips, we tail-trim and append a `[notes truncated…]`
/// marker so the model knows it didn't see the full picture.
pub fn read_all_notes(service_id: &str) -> Result<String> {
    let notes = list_notes(service_id)?;
    if notes.is_empty() {
        return Ok(String::new());
    }
    let mut out = String::new();
    for note in &notes {
        let body = read_note(service_id, &note.name).unwrap_or_default();
        if body.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        // Use the user-visible title as the section header so the
        // AI sees the same hierarchy the user does. Single-note
        // workspaces still get a header — gives the model a hook
        // for "the `Index` note says X".
        out.push_str(&format!("## {}\n\n", note.title));
        out.push_str(body.trim_end());
        if out.len() > MAX_AI_CONTEXT_CHARS {
            out.truncate(MAX_AI_CONTEXT_CHARS);
            out.push_str("\n\n[notes truncated by RunHQ — only the first chunk was sent]");
            break;
        }
    }
    Ok(out)
}

/// List service IDs that have at least one note. Used by the AI
/// context builder to decide which projects are "noted" without
/// having to read every file.
pub fn list_noted_services() -> Result<Vec<String>> {
    let root = notes_root()?;
    let mut ids = Vec::new();
    let read = match fs::read_dir(&root) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };
    for entry in read {
        let entry = entry?;
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            // v0.10 layout — service directory. Only count it if
            // it has at least one .md file inside, so an empty
            // directory left over from a delete doesn't show up.
            let has_md = fs::read_dir(&path)
                .map(|it| {
                    it.flatten().any(|e| {
                        e.file_name().to_string_lossy().ends_with(".md")
                            && !e.file_name().to_string_lossy().starts_with('.')
                    })
                })
                .unwrap_or(false);
            if has_md {
                ids.push(fname_str);
            }
        } else if path.is_file() {
            // v0.9 legacy file — still counts. The next access
            // for this service id will trigger an in-place
            // migration.
            if let Some(id) = fname_str.strip_suffix(".md") {
                ids.push(id.to_string());
            }
        }
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// `RUNHQ_HOME` is process-global, so cargo's default parallel
    /// test runner would let two tests stomp on each other's tmp
    /// dirs at random. The mutex serialises tests in THIS module
    /// (other modules in the crate don't touch `runhq_home`, so a
    /// global serial-test crate would be overkill).
    static SERIAL: Mutex<()> = Mutex::new(());

    fn isolated_home(tmp: &tempfile::TempDir) {
        std::env::set_var("RUNHQ_HOME", tmp.path());
    }

    #[test]
    fn create_read_write_delete_roundtrip() {
        let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        isolated_home(&tmp);

        let svc = "service-roundtrip";
        let name = create_note(svc, Some("My First Note")).unwrap();
        assert_eq!(name, "my-first-note");

        write_note(svc, &name, "# Hello\n\nbody").unwrap();
        let body = read_note(svc, &name).unwrap();
        assert_eq!(body, "# Hello\n\nbody");

        let listed = list_notes(svc).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Hello");

        assert!(delete_note(svc, &name).unwrap());
        assert!(list_notes(svc).unwrap().is_empty());
    }

    #[test]
    fn legacy_single_file_migrates_in_place() {
        let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        isolated_home(&tmp);

        let svc = "service-legacy";
        // Hand-craft the v0.9 layout.
        let root = notes_root().unwrap();
        let legacy_path = root.join(format!("{svc}.md"));
        fs::write(&legacy_path, "# Legacy\n\nbody").unwrap();
        assert!(legacy_path.exists());

        let listed = list_notes(svc).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "index");
        assert_eq!(listed[0].title, "Legacy");
        // Legacy file should no longer exist; new directory layout
        // takes over.
        assert!(!legacy_path.exists());
        assert!(root.join(svc).join("index.md").exists());

        // Idempotency: running list a second time is a noop.
        let again = list_notes(svc).unwrap();
        assert_eq!(again.len(), 1);
    }

    #[test]
    fn create_dedupes_collisions() {
        let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        isolated_home(&tmp);

        let svc = "service-dedupe";
        let a = create_note(svc, Some("notes")).unwrap();
        let b = create_note(svc, Some("notes")).unwrap();
        let c = create_note(svc, Some("notes")).unwrap();
        assert_eq!(a, "notes");
        assert_eq!(b, "notes-2");
        assert_eq!(c, "notes-3");
    }

    #[test]
    fn delete_all_wipes_everything() {
        let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        isolated_home(&tmp);

        let svc = "service-wipe";
        let _ = create_note(svc, Some("a")).unwrap();
        let _ = create_note(svc, Some("b")).unwrap();
        delete_all_notes(svc).unwrap();
        assert!(list_notes(svc).unwrap().is_empty());
    }

    #[test]
    fn read_all_notes_concats_with_titles() {
        let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        isolated_home(&tmp);

        let svc = "service-concat";
        let a = create_note(svc, Some("alpha")).unwrap();
        write_note(svc, &a, "# Alpha\n\nfirst body").unwrap();
        let b = create_note(svc, Some("beta")).unwrap();
        write_note(svc, &b, "# Beta\n\nsecond body").unwrap();

        let combined = read_all_notes(svc).unwrap();
        assert!(combined.contains("## Alpha"));
        assert!(combined.contains("## Beta"));
        assert!(combined.contains("first body"));
        assert!(combined.contains("second body"));
    }

    #[test]
    fn extract_title_handles_leading_prose() {
        assert_eq!(extract_title("# Hello"), Some("Hello".to_string()));
        assert_eq!(
            extract_title("\n\n# After Blanks\n\nbody"),
            Some("After Blanks".to_string())
        );
        assert_eq!(extract_title("plain prose first"), None);
        assert_eq!(extract_title(""), None);
        assert_eq!(extract_title("# "), None);
    }
}
