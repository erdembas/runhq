//! License & Compliance Scanner.
//!
//! Scans project dependencies for copyleft / restrictive licenses
//! (GPL, AGPL, LGPL, SSPL, etc.) that could contaminate a
//! proprietary codebase. Also generates a THIRD-PARTY-NOTICES.md
//! attribution file for compliance.
//!
//! Supports Node.js (via `npm ls --json` + `package.json` "license"
//! fields), Rust (via `cargo metadata`), and Go (via `go list -m -json`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

use crate::error::AppResult;

const SCAN_TIMEOUT: Duration = Duration::from_secs(30);

// ---- Public types ---------------------------------------------------------

/// Risk classification for a single dependency's license.
///
/// Wire format is `snake_case` (`weak_copyleft`, `network_copyleft`, …) —
/// the desktop frontend's `LicenseRisk` TS union and the human-readable
/// `as_str()` output both rely on this exact spelling, so the
/// `rename_all` attribute is load-bearing. Default-derive serde would
/// emit `WeakCopyleft` etc., which silently breaks every TS lookup
/// table keyed on the lowercase form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseRisk {
    Safe,
    Permissive,
    WeakCopyleft,
    StrongCopyleft,
    NetworkCopyleft,
    Proprietary,
    Unknown,
}

impl LicenseRisk {
    pub fn as_str(&self) -> &'static str {
        match self {
            LicenseRisk::Safe => "safe",
            LicenseRisk::Permissive => "permissive",
            LicenseRisk::WeakCopyleft => "weak_copyleft",
            LicenseRisk::StrongCopyleft => "strong_copyleft",
            LicenseRisk::NetworkCopyleft => "network_copyleft",
            LicenseRisk::Proprietary => "proprietary",
            LicenseRisk::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    pub license: String,
    pub risk: LicenseRisk,
    pub homepage: Option<String>,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseScanResult {
    pub entries: Vec<LicenseEntry>,
    pub safe_count: usize,
    pub permissive_count: usize,
    pub weak_copyleft_count: usize,
    pub strong_copyleft_count: usize,
    pub network_copyleft_count: usize,
    pub proprietary_count: usize,
    pub unknown_count: usize,
    pub has_contamination: bool,
    /// Packages that pose the highest risk (strong copyleft + network copyleft).
    pub contamination_warnings: Vec<ContaminationWarning>,
    /// Detected runtime (`node`, `rust`, `go`, `python`, …) or `None`
    /// when the project's runtime can't be identified.
    pub runtime: Option<String>,
    /// `true` only when RunHQ has a working license parser for this
    /// runtime AND the underlying tool produced parseable output.
    /// `false` for Python (no implementation), Go (license metadata
    /// not exposed by `go list`), or when the package manager's CLI
    /// timed out / errored. The frontend uses this to avoid showing
    /// a false-confidence "✅ no contamination" badge on a project
    /// that simply wasn't analysed.
    pub scan_supported: bool,
    /// Human-readable explanation when `scan_supported = false`. Drives
    /// the frontend's "License scanning not supported for this
    /// runtime" banner.
    pub scan_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContaminationWarning {
    pub package: String,
    pub version: String,
    pub license: String,
    pub risk: LicenseRisk,
    pub message: String,
}

/// Slim cross-project summary used by the dashboard's workspace
/// pipeline.
///
/// Why not just ship `LicenseScanResult` everywhere? The full result
/// carries `entries: Vec<LicenseEntry>`, which on a typical npm
/// project resolves to 3000+ rows. Persisting that to SQLite for
/// every project on every scan and round-tripping it through Tauri
/// IPC for the dashboard's `ServiceCard` chip would burn megabytes
/// per scan for data the card never reads — chips only need counts
/// plus the top 3 offenders for their tooltip. The full result is
/// still computed (and cached) per-service when the user opens the
/// `LicensePanel` drawer; this summary is the workspace-grade
/// projection of it.
///
/// `top_warnings` is capped at 3 because that's the maximum a card
/// tooltip can fit before becoming unreadable; the drawer shows the
/// authoritative full list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LicenseScanSummary {
    pub runtime: Option<String>,
    pub scan_supported: bool,
    pub total_entries: usize,
    pub permissive_count: usize,
    pub safe_count: usize,
    pub weak_copyleft_count: usize,
    pub strong_copyleft_count: usize,
    pub network_copyleft_count: usize,
    pub proprietary_count: usize,
    pub unknown_count: usize,
    pub has_contamination: bool,
    /// First 3 contamination warnings by risk severity. Used to drive
    /// the card chip tooltip and the AI "Why?" payload without
    /// having to round-trip the full entry list.
    pub top_warnings: Vec<ContaminationWarning>,
}

impl LicenseScanSummary {
    /// Total of strong + network + proprietary licenses — the card
    /// chip's "magnitude" number. Weak copyleft and unknown are
    /// deliberately excluded because they don't trigger the same
    /// "ship-tonight" risk class; they show up in the drawer but
    /// shouldn't push a project into the workspace's contamination
    /// tally.
    pub fn contamination_count(&self) -> usize {
        self.strong_copyleft_count + self.network_copyleft_count + self.proprietary_count
    }
}

/// Project a full `LicenseScanResult` into the slim summary the
/// workspace pipeline carries around. Keeps the contamination-ranking
/// logic in one place so the card chip and the worst-offenders band
/// can never disagree about what counts as "bad".
pub fn summarize(result: &LicenseScanResult) -> LicenseScanSummary {
    // Warnings already arrive ordered by discovery (strong copyleft
    // first, then network copyleft, then proprietary — see
    // `build_result`). Network copyleft (AGPL/SSPL) is the most
    // commercial-toxic class for a SaaS product, so promote it
    // ahead of strong copyleft in the top-3 surface even when both
    // exist. We deliberately don't sort by package name — a noisy
    // tooltip with three different risk classes is more honest than
    // alphabetical order across categories.
    let mut warnings = result.contamination_warnings.clone();
    warnings.sort_by_key(|w| match w.risk {
        LicenseRisk::NetworkCopyleft => 0,
        LicenseRisk::StrongCopyleft => 1,
        LicenseRisk::Proprietary => 2,
        // The remaining variants shouldn't appear in
        // `contamination_warnings` (build_result only pushes the
        // three above), but we keep the match exhaustive so a
        // future addition to `LicenseRisk` doesn't silently
        // misorder.
        LicenseRisk::WeakCopyleft
        | LicenseRisk::Permissive
        | LicenseRisk::Safe
        | LicenseRisk::Unknown => 3,
    });
    warnings.truncate(3);

    LicenseScanSummary {
        runtime: result.runtime.clone(),
        scan_supported: result.scan_supported,
        total_entries: result.entries.len(),
        permissive_count: result.permissive_count,
        safe_count: result.safe_count,
        weak_copyleft_count: result.weak_copyleft_count,
        strong_copyleft_count: result.strong_copyleft_count,
        network_copyleft_count: result.network_copyleft_count,
        proprietary_count: result.proprietary_count,
        unknown_count: result.unknown_count,
        has_contamination: result.has_contamination,
        top_warnings: warnings,
    }
}

// ---- License classification ------------------------------------------------

fn classify_license(spdx: &str) -> LicenseRisk {
    let lower = spdx.to_ascii_lowercase();
    let s = lower.trim();

    if s.is_empty() || s == "unlicense" || s == "unlicensed" || s == "none" {
        return LicenseRisk::Unknown;
    }

    if is_strong_copyleft(s) {
        return LicenseRisk::StrongCopyleft;
    }
    if is_network_copyleft(s) {
        return LicenseRisk::NetworkCopyleft;
    }
    if is_weak_copyleft(s) {
        return LicenseRisk::WeakCopyleft;
    }
    if is_proprietary(s) {
        return LicenseRisk::Proprietary;
    }
    if is_permissive(s) {
        return LicenseRisk::Permissive;
    }

    LicenseRisk::Unknown
}

fn is_strong_copyleft(s: &str) -> bool {
    // We deliberately do NOT match `lgpl-*` here even though it
    // contains the substring `gpl-`. LGPL is *weak* copyleft (linking
    // is allowed without infecting the calling project) and gets its
    // own classification in `is_weak_copyleft`. The `lgpl_` guard
    // below short-circuits before any GPL substring check fires so
    // ordering between is_weak_copyleft and is_strong_copyleft
    // doesn't matter.
    if s.starts_with("lgpl") {
        return false;
    }
    s.starts_with("gpl-")
        || s.starts_with("gpl2")
        || s.starts_with("gpl3")
        || s == "gpl-2.0"
        || s == "gpl-3.0"
        || s == "gpl-2.0-only"
        || s == "gpl-3.0-only"
        || s == "gpl-2.0-or-later"
        || s == "gpl-3.0-or-later"
        || s.contains("gpl-2")
        || s.contains("gpl-3")
}

fn is_network_copyleft(s: &str) -> bool {
    s.starts_with("agpl-")
        || s == "agpl-3.0"
        || s == "agpl-1.0"
        || s == "agpl-3.0-only"
        || s == "agpl-3.0-or-later"
        || s.contains("agpl")
        || s.contains("sspl")
        || s == "sspl-1.0"
        || s.contains("commons-clause")
}

fn is_weak_copyleft(s: &str) -> bool {
    s.starts_with("lgpl-")
        || s == "lgpl-2.0"
        || s == "lgpl-2.1"
        || s == "lgpl-3.0"
        || s == "lgpl-2.0-only"
        || s == "lgpl-2.1-only"
        || s == "lgpl-3.0-only"
        || s.contains("lgpl")
        || s.contains("mpl")
        || s == "mpl-1.1"
        || s == "mpl-2.0"
        || s == "mpl-2.0-no-copyleft-exception"
        || s.contains("epl")
        || s == "epl-1.0"
        || s == "epl-2.0"
        || s.contains("cecill")
        || s.contains("ecl-")
        || s.contains("osl-")
}

fn is_proprietary(s: &str) -> bool {
    // Tightened from substring matches that overreached on permissive
    // identifiers ("apache-2.0 with non-commercial use clause"
    // shouldn't fall through to proprietary). We anchor on standalone
    // tokens — splitting on the SPDX combinator characters (`+ /
    // space and parens for compound expressions like
    // `"(MIT OR commercial)"`).
    let tokens: Vec<&str> = s
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '.')
        .filter(|t| !t.is_empty())
        .collect();
    for t in tokens {
        match t {
            "proprietary" | "commercial" | "see-license" | "see-license-in" | "unlicensed"
            | "cc-by-nc" | "cc-by-nc-2.0" | "cc-by-nc-3.0" | "cc-by-nc-4.0" | "cc-by-nc-sa-4.0"
            | "cc-by-nc-nd-4.0" => return true,
            _ => {}
        }
    }
    false
}

fn is_permissive(s: &str) -> bool {
    // OFL-1.1 sits here intentionally. The SIL Open Font License
    // restricts redistribution of the *font file* under specific
    // conditions, but for software (the only thing RunHQ scans)
    // shipping a font *as a dependency* is functionally permissive:
    // there's no copyleft on the consuming codebase. Classifying
    // OFL as strong-copyleft used to fire false-positive
    // contamination warnings on any project that pulled an icon
    // pack (Lucide, Phosphor, Iconoir all use OFL).
    s.starts_with("mit")
        || s == "mit"
        || s == "mit-0"
        || s.contains("apache")
        || s == "apache-2.0"
        || s == "bsd-2-clause"
        || s == "bsd-3-clause"
        || s == "bsd-2-clause-freebsd"
        || s == "bsd-3-clause-clear"
        || s == "0bsd"
        || s == "isc"
        || s == "artistic-2.0"
        || s == "zlib"
        || s == "psf-2.0"
        || s == "python-2.0"
        || s == "wtfpl"
        || s == "beerware"
        || s == "unlicense"
        || s == "cc0-1.0"
        || s == "ncsa"
        || s == "boost-1.0"
        || s == "ofl-1.1"
        || s == "ofl-1.0"
        || s.starts_with("ofl-")
}

// ---- Scanning -------------------------------------------------------------

pub async fn scan_licenses(cwd: &Path) -> AppResult<LicenseScanResult> {
    let runtime = detect_runtime(cwd);
    let (entries, scan_supported, scan_message) = match runtime.as_deref() {
        Some("node") | Some("bun") | Some("deno") => {
            let e = scan_npm_licenses(cwd).await;
            if e.is_empty() {
                (
                    e,
                    false,
                    Some(
                        "No `node_modules` directory found in this project. \
                         Run `npm install` (or `pnpm install` / `yarn` / \
                         `bun install`) first so license metadata is \
                         available on disk. Yarn Berry / PnP projects with \
                         zero-installs (`.yarn/cache/*.zip`) are not yet \
                         supported."
                            .to_string(),
                    ),
                )
            } else {
                (e, true, None)
            }
        }
        Some("rust") => {
            let e = scan_cargo_licenses(cwd).await;
            if e.is_empty() {
                (
                    e,
                    false,
                    Some(
                        "`cargo metadata` returned no packages. Make sure \
                         Cargo.lock is up to date (run `cargo build` or \
                         `cargo generate-lockfile`)."
                            .to_string(),
                    ),
                )
            } else {
                (e, true, None)
            }
        }
        Some("go") => {
            let e = scan_go_licenses(cwd).await;
            // `go list` doesn't expose license metadata — we end up
            // marking every entry Unknown. Surface that honestly
            // rather than letting the user think a clean scan means
            // a clean license posture.
            (
                e,
                false,
                Some(
                    "Go modules don't expose license metadata via \
                     `go list`. License classification is best-effort \
                     and likely incomplete; use `go-licenses` for \
                     authoritative results."
                        .to_string(),
                ),
            )
        }
        Some("python") => (
            Vec::new(),
            false,
            Some(
                "License scanning for Python projects is not yet \
                     supported. Track package licenses manually or use \
                     `pip-licenses` until RunHQ ships a Python \
                     implementation."
                    .to_string(),
            ),
        ),
        _ => (
            Vec::new(),
            false,
            Some(
                "Unknown project runtime — RunHQ couldn't find \
                 package.json, Cargo.toml, go.mod, requirements.txt, \
                 or pyproject.toml in the project root."
                    .to_string(),
            ),
        ),
    };

    Ok(build_result(entries, runtime, scan_supported, scan_message))
}

fn detect_runtime(cwd: &Path) -> Option<String> {
    if cwd.join("package.json").exists() {
        Some("node".into())
    } else if cwd.join("Cargo.toml").exists() {
        Some("rust".into())
    } else if cwd.join("go.mod").exists() {
        Some("go".into())
    } else if cwd.join("requirements.txt").exists() || cwd.join("pyproject.toml").exists() {
        Some("python".into())
    } else {
        None
    }
}

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
async fn scan_npm_licenses(cwd: &Path) -> Vec<LicenseEntry> {
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

async fn scan_cargo_licenses(cwd: &Path) -> Vec<LicenseEntry> {
    // `--no-deps` would only return workspace members — i.e. the
    // user's own crates, NOT the third-party deps whose licenses
    // are the entire point of a contamination scan. We deliberately
    // ask for the full resolved graph so transitive deps land in
    // the report.
    //
    // `--locked` gates the scan on a fresh Cargo.lock — without it
    // `cargo metadata` will silently re-resolve and rewrite the
    // lockfile, which is a side-effect the user didn't ask for.
    // If the lockfile is stale we'd rather report no entries
    // (caller will surface "scan inconclusive") than mutate the
    // user's tree from a license panel.
    let output = run_timed(
        "cargo",
        &["metadata", "--format-version", "1", "--locked"],
        cwd,
    )
    .await;
    let data = match output {
        Some(d) => d,
        None => {
            // Fall back to a non-locked metadata read if the user
            // hasn't run `cargo build` yet. Without this fallback
            // an entire Rust project would scan as zero entries on
            // the very first license panel open.
            match run_timed("cargo", &["metadata", "--format-version", "1"], cwd).await {
                Some(d) => d,
                None => return Vec::new(),
            }
        }
    };
    let s = String::from_utf8_lossy(&data);
    let val: serde_json::Value = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut entries = Vec::new();
    if let Some(packages) = val.get("packages").and_then(|v| v.as_array()) {
        for pkg in packages {
            let name = pkg
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let version = pkg
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // SPDX expression first; fall back to `license_file`
            // (Cargo's escape hatch for non-SPDX or custom-text
            // licenses). When neither is present we leave the
            // string blank so `classify_license` reports
            // `Unknown` without a misleading literal "UNKNOWN".
            let license_str = pkg
                .get("license")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    pkg.get("license_file")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|_| "see-license-file".to_string())
                })
                .unwrap_or_else(|| "UNKNOWN".to_string());
            let homepage = pkg
                .get("homepage")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let repository = pkg
                .get("repository")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let risk = classify_license(&license_str);
            entries.push(LicenseEntry {
                name,
                version,
                license: license_str,
                risk,
                homepage,
                repository,
            });
        }
    }
    entries
}

async fn scan_go_licenses(cwd: &Path) -> Vec<LicenseEntry> {
    let output = run_timed("go", &["list", "-m", "-json", "all"], cwd).await;
    let data = match output {
        Some(d) => d,
        None => return Vec::new(),
    };
    let s = String::from_utf8_lossy(&data);
    let mut entries = Vec::new();
    let stream = serde_json::Deserializer::from_str(&s).into_iter::<serde_json::Value>();
    for val in stream.flatten() {
        let name = val
            .get("Path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let version = val
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let license_str = "UNKNOWN".to_string();
        let risk = LicenseRisk::Unknown;
        entries.push(LicenseEntry {
            name,
            version,
            license: license_str,
            risk,
            homepage: None,
            repository: None,
        });
    }
    entries
}

fn build_result(
    entries: Vec<LicenseEntry>,
    runtime: Option<String>,
    scan_supported: bool,
    scan_message: Option<String>,
) -> LicenseScanResult {
    let mut safe_count = 0;
    let mut permissive_count = 0;
    let mut weak_copyleft_count = 0;
    let mut strong_copyleft_count = 0;
    let mut network_copyleft_count = 0;
    let mut proprietary_count = 0;
    let mut unknown_count = 0;
    let mut contamination_warnings = Vec::new();

    for e in &entries {
        match e.risk {
            LicenseRisk::Safe => safe_count += 1,
            LicenseRisk::Permissive => permissive_count += 1,
            LicenseRisk::WeakCopyleft => weak_copyleft_count += 1,
            LicenseRisk::StrongCopyleft => {
                strong_copyleft_count += 1;
                contamination_warnings.push(ContaminationWarning {
                    package: e.name.clone(),
                    version: e.version.clone(),
                    license: e.license.clone(),
                    risk: e.risk.clone(),
                    message: format!(
                        "`{}` v{} is licensed under {} (strong copyleft). \
                         Linking to this package may require your project to \
                         also be distributed under {}.",
                        e.name, e.version, e.license, e.license
                    ),
                });
            }
            LicenseRisk::NetworkCopyleft => {
                network_copyleft_count += 1;
                contamination_warnings.push(ContaminationWarning {
                    package: e.name.clone(),
                    version: e.version.clone(),
                    license: e.license.clone(),
                    risk: e.risk.clone(),
                    message: format!(
                        "`{}` v{} is licensed under {} (network copyleft). \
                         Any network use (including SaaS) triggers the \
                         copyleft requirement — your entire project may \
                         need to be distributed under {}.",
                        e.name, e.version, e.license, e.license
                    ),
                });
            }
            LicenseRisk::Proprietary => {
                proprietary_count += 1;
                contamination_warnings.push(ContaminationWarning {
                    package: e.name.clone(),
                    version: e.version.clone(),
                    license: e.license.clone(),
                    risk: e.risk.clone(),
                    message: format!(
                        "`{}` v{} uses a proprietary / commercial license ({}). \
                         Verify your license terms permit the intended use.",
                        e.name, e.version, e.license
                    ),
                });
            }
            LicenseRisk::Unknown => unknown_count += 1,
        }
    }

    let has_contamination =
        strong_copyleft_count > 0 || network_copyleft_count > 0 || proprietary_count > 0;

    LicenseScanResult {
        entries,
        safe_count,
        permissive_count,
        weak_copyleft_count,
        strong_copyleft_count,
        network_copyleft_count,
        proprietary_count,
        unknown_count,
        has_contamination,
        contamination_warnings,
        runtime,
        scan_supported,
        scan_message,
    }
}

// ---- THIRD-PARTY-NOTICES.md generation ------------------------------------

/// Generate a THIRD-PARTY-NOTICES.md file from the scan results.
pub fn generate_third_party_notices(result: &LicenseScanResult) -> String {
    let mut out = String::new();
    out.push_str("# Third-Party Notices\n\n");
    out.push_str("This file contains the license information for third-party\n");
    out.push_str("dependencies used by this project.\n\n");
    out.push_str("## Summary\n\n");
    out.push_str(&format!(
        "- Permissive licenses: {}\n",
        result.permissive_count + result.safe_count
    ));
    out.push_str(&format!(
        "- Weak copyleft: {}\n",
        result.weak_copyleft_count
    ));
    out.push_str(&format!(
        "- Strong copyleft: {}\n",
        result.strong_copyleft_count
    ));
    out.push_str(&format!(
        "- Network copyleft: {}\n",
        result.network_copyleft_count
    ));
    out.push_str(&format!("- Proprietary: {}\n", result.proprietary_count));
    out.push_str(&format!("- Unknown: {}\n\n", result.unknown_count));

    if !result.contamination_warnings.is_empty() {
        out.push_str("## ⚠️ Contamination Warnings\n\n");
        for w in &result.contamination_warnings {
            out.push_str(&format!(
                "- **{}** v{} (`{}`): {}\n",
                w.package, w.version, w.license, w.message
            ));
        }
        out.push('\n');
    }

    out.push_str("## Dependencies\n\n");
    for e in &result.entries {
        out.push_str(&format!("### {} v{}\n\n", e.name, e.version));
        out.push_str(&format!("- **License**: {}\n", e.license));
        out.push_str(&format!("- **Risk level**: {}\n", e.risk.as_str()));
        if let Some(ref hp) = e.homepage {
            out.push_str(&format!("- **Homepage**: {}\n", hp));
        }
        if let Some(ref repo) = e.repository {
            out.push_str(&format!("- **Repository**: {}\n", repo));
        }
        out.push('\n');
    }

    out
}

// ---- Subprocess runner ----------------------------------------------------

async fn run_timed(program: &str, args: &[&str], cwd: &Path) -> Option<Vec<u8>> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    // Suppress the console window flash on Windows. Without this, a
    // license scan would briefly pop a black `cmd.exe`-style window
    // every time the user clicked Rescan — jarring inside a windowed
    // Tauri shell. CREATE_NO_WINDOW = 0x08000000.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return None,
    };

    match timeout(SCAN_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            if output.stdout.is_empty() && !output.status.success() {
                None
            } else {
                Some(output.stdout)
            }
        }
        _ => None,
    }
}
