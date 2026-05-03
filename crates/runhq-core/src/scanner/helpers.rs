use std::fs;
use std::path::Path;

// ---- Helpers -------------------------------------------------------------

pub(crate) fn has_file_pattern(dir: &Path, pattern: &str) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let prefix = pattern.trim_end_matches('*');
    entries.flatten().any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        name.starts_with(prefix) && name.ends_with(".csproj")
    })
}
