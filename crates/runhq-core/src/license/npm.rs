use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::classifier::classify_license;
use super::types::LicenseEntry;

/// Scan a Node.js project's installed dependencies by walking the
/// `node_modules` tree directly.
///
/// Why not `npm ls --json`? Two reasons:
///
/// 1. By default `npm ls` does NOT include the `license` field —
///    you'd need `--long`, which makes npm read every package.json
///    on disk anyway. Reading them ourselves is faster (no
///    subprocess), more reliable (no stderr-leaking-into-stdout
///    parse errors), and works without a Node toolchain.
/// 2. `npm ls` only knows the npm-flavoured layout. pnpm hoists
///    everything under `node_modules/.pnpm/<pkg>@<ver>/...`, which
///    `npm ls` either misreports or skips entirely. The directory
///    walk handles npm, pnpm, and yarn-classic with the same code
///    path — three package managers covered for one implementation.
///
/// Yarn Berry / PnP (zero-installs, `.yarn/cache/*.zip`) is the
/// holdout: there's no `node_modules` to walk. The caller treats
/// an empty result as "scan inconclusive" via `scan_supported`.
pub(super) async fn scan_npm_licenses(cwd: &Path) -> Vec<LicenseEntry> {
    let cwd = cwd.to_path_buf();
    // The walk hits the filesystem hard for any non-trivial repo
    // (a typical React app has 1k+ package.json files). Hand it to
    // a blocking thread so it doesn't tie up the tokio runtime.
    tokio::task::spawn_blocking(move || {
        let nm = cwd.join("node_modules");
        if !nm.exists() {
            return Vec::new();
        }
        let mut entries = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        collect_npm_packages(&nm, &mut entries, &mut seen, 0, false);
        entries
    })
    .await
    .unwrap_or_default()
}

/// Recursively collect `package.json` files under a `node_modules`
/// root, deduplicating by `name@version` so symlink-heavy pnpm
/// graphs don't double-count the same package.
///
/// `in_pnpm_root` is `true` only while we're inside the
/// `.pnpm/` virtual store — entries there are versioned package
/// directories (`<pkg>@<ver>` or `@scope+<pkg>@<ver>`) whose actual
/// `package.json` lives one `node_modules/` deeper. Treating that
/// layer specially is what makes the same walker work for pnpm.
fn collect_npm_packages(
    dir: &Path,
    entries: &mut Vec<LicenseEntry>,
    seen: &mut HashSet<String>,
    depth: usize,
    in_pnpm_root: bool,
) {
    // Defensive cap: a misconfigured workspace with circular
    // symlinks could otherwise loop forever. 14 is comfortably
    // beyond what any real `node_modules` layout produces (npm
    // hoist conflicts plateau around 4–6 levels).
    if depth > 14 {
        return;
    }
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in read.flatten() {
        let path: PathBuf = entry.path();
        // Accept symlinks too — pnpm and yarn-link rely on them.
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir() || t.is_symlink())
            .unwrap_or(false);
        if !is_dir {
            continue;
        }
        let name_os = entry.file_name();
        let name_s = name_os.to_string_lossy();

        if in_pnpm_root {
            // `<pkg>@<ver>` (or `@scope+<pkg>@<ver>`) — the real
            // package.json hides under `./node_modules/<pkg>`.
            let nested_nm = path.join("node_modules");
            if nested_nm.exists() {
                collect_npm_packages(&nested_nm, entries, seen, depth + 1, false);
            }
            continue;
        }

        if name_s == ".pnpm" {
            collect_npm_packages(&path, entries, seen, depth + 1, true);
            continue;
        }
        // Skip metadata directories (`.bin`, `.package-lock.json`,
        // `.cache`, `.vite`, `.yarn-integrity`, …) — never houses a
        // real package.
        if name_s.starts_with('.') {
            continue;
        }
        // Scope namespace (`@types/`, `@babel/`, …) — recurse one
        // level to find the actual package dirs.
        if name_s.starts_with('@') {
            collect_npm_packages(&path, entries, seen, depth + 1, false);
            continue;
        }

        // Regular package directory.
        let pkg_json = path.join("package.json");
        if pkg_json.exists() {
            if let Ok(text) = std::fs::read_to_string(&pkg_json) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    push_npm_entry_if_new(&val, &name_s, entries, seen);
                }
            }
        }
        // Some packages ship nested `node_modules` because of
        // npm-cli hoist conflicts — recurse so we don't miss
        // duplicated transitive deps.
        let nested_nm = path.join("node_modules");
        if nested_nm.exists() {
            collect_npm_packages(&nested_nm, entries, seen, depth + 1, false);
        }
    }
}

fn push_npm_entry_if_new(
    val: &serde_json::Value,
    fallback_name: &str,
    entries: &mut Vec<LicenseEntry>,
    seen: &mut HashSet<String>,
) {
    let pkg_name = val
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_name.to_string());
    let pkg_ver = val
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let key = format!("{}@{}", pkg_name, pkg_ver);
    if !seen.insert(key) {
        return;
    }
    let license_str = extract_npm_license(val);
    let homepage = val
        .get("homepage")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let repository = val.get("repository").and_then(|v| {
        if let Some(s) = v.as_str() {
            return Some(s.to_string());
        }
        v.as_object()
            .and_then(|o| o.get("url"))
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
    });
    let risk = classify_license(&license_str);
    entries.push(LicenseEntry {
        name: pkg_name,
        version: pkg_ver,
        license: license_str,
        risk,
        homepage,
        repository,
    });
}

fn extract_npm_license(info: &serde_json::Value) -> String {
    if let Some(lic) = info.get("license") {
        if let Some(s) = lic.as_str() {
            if !s.is_empty() {
                return s.to_string();
            }
        }
        if let Some(obj) = lic.as_object() {
            if let Some(t) = obj.get("type").and_then(|v| v.as_str()) {
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    if let Some(lics) = info.get("licenses").and_then(|v| v.as_array()) {
        if let Some(first) = lics.first() {
            if let Some(s) = first.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
            if let Some(t) = first.get("type").and_then(|v| v.as_str()) {
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    "UNKNOWN".to_string()
}
