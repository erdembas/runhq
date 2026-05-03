use std::path::Path;

use crate::error::AppResult;

use super::cargo::scan_cargo_licenses;
use super::go::scan_go_licenses;
use super::npm::scan_npm_licenses;
use super::types::{ContaminationWarning, LicenseEntry, LicenseRisk, LicenseScanResult};

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
