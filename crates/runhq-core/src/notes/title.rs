use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn extract_title(markdown: &str) -> Option<String> {
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
        return None;
    }
    None
}

pub(super) fn slugify(input: &str) -> String {
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

pub(super) fn first_free_name(dir: &Path, base: &str) -> String {
    if !dir.join(format!("{base}.md")).exists() {
        return base.to_string();
    }
    for n in 2u32..=9999 {
        let candidate = format!("{base}-{n}");
        if !dir.join(format!("{candidate}.md")).exists() {
            return candidate;
        }
    }
    format!(
        "{base}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}
