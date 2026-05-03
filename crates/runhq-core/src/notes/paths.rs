use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{anyhow, Context, Result};

use crate::paths;

use super::constants::MAX_FILENAME_LEN;

pub(super) fn notes_root() -> Result<PathBuf> {
    let dir = paths::runhq_home()?.join("notes");
    fs::create_dir_all(&dir).ok();
    Ok(dir)
}

pub(super) fn sanitise_component(input: &str, what: &str) -> Result<String> {
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

pub(super) fn service_dir(service_id: &str) -> Result<PathBuf> {
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    Ok(root.join(safe))
}

pub(super) fn migrate_legacy_if_needed(service_id: &str) -> Result<()> {
    let root = notes_root()?;
    let safe = sanitise_component(service_id, "service id")?;
    let legacy_path = root.join(format!("{safe}.md"));
    if !legacy_path.exists() || !legacy_path.is_file() {
        return Ok(());
    }
    let new_dir = root.join(&safe);
    let new_index = new_dir.join("index.md");
    if new_dir.exists() {
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

pub(super) fn note_path(service_id: &str, name: &str) -> Result<PathBuf> {
    let dir = service_dir(service_id)?;
    let safe = sanitise_component(name, "note name")?;
    Ok(dir.join(format!("{safe}.md")))
}

pub(super) fn mtime_ms(path: &Path) -> u64 {
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
