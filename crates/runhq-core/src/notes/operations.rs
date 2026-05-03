use std::fs;

use anyhow::{anyhow, Context, Result};

use super::constants::{MAX_AI_CONTEXT_CHARS, MAX_NOTE_BYTES};
use super::paths::{
    migrate_legacy_if_needed, mtime_ms, note_path, notes_root, sanitise_component, service_dir,
};
use super::title::{extract_title, first_free_name, slugify};
use super::NoteFile;

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
        if !path.is_file() || stem.starts_with('.') {
            continue;
        }
        let body = fs::read_to_string(&path).unwrap_or_default();
        out.push(NoteFile {
            name: stem.to_string(),
            title: extract_title(&body).unwrap_or_else(|| stem.to_string()),
            size_bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            updated_at_ms: mtime_ms(&path),
        });
    }
    out.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

pub fn read_note(service_id: &str, name: &str) -> Result<String> {
    migrate_legacy_if_needed(service_id)?;
    let path = note_path(service_id, name)?;
    if path.exists() {
        fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
    } else {
        Ok(String::new())
    }
}

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

pub fn delete_note(service_id: &str, name: &str) -> Result<bool> {
    migrate_legacy_if_needed(service_id)?;
    let path = note_path(service_id, name)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path).with_context(|| format!("deleting {}", path.display()))?;
    if let Ok(dir) = service_dir(service_id) {
        if let Ok(mut iter) = fs::read_dir(&dir) {
            if iter.next().is_none() {
                let _ = fs::remove_dir(&dir);
            }
        }
    }
    Ok(true)
}

pub fn delete_all_notes(service_id: &str) -> Result<()> {
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).with_context(|| format!("removing {}", dir.display()))?;
    }
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    let legacy = root.join(format!("{safe}.md"));
    if legacy.exists() && legacy.is_file() {
        let _ = fs::remove_file(&legacy);
    }
    Ok(())
}

pub fn create_note(service_id: &str, requested_name: Option<&str>) -> Result<String> {
    migrate_legacy_if_needed(service_id)?;
    let dir = service_dir(service_id)?;
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let seed_raw = requested_name.unwrap_or("untitled");
    let sanitised = sanitise_component(seed_raw, "note name")?;
    let slug = slugify(&sanitised);
    let base = if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    };
    let candidate = first_free_name(&dir, &base);
    let path = dir.join(format!("{candidate}.md"));
    fs::write(&path, "").with_context(|| format!("creating {}", path.display()))?;
    Ok(candidate)
}

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
            if let Some(id) = fname_str.strip_suffix(".md") {
                ids.push(id.to_string());
            }
        }
    }
    Ok(ids)
}
