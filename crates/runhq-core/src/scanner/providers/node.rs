use std::fs;
use std::path::Path;

use serde::Deserialize;

use super::super::{dir_name, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- Node / Bun / Deno provider -----------------------------------------

pub(super) struct NodeProvider;

#[derive(Deserialize)]
struct PackageJson {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    scripts: std::collections::BTreeMap<String, String>,
}

impl RuntimeProvider for NodeProvider {
    fn label(&self) -> &'static str {
        "node"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let pkg_path = dir.join("package.json");
        if !pkg_path.is_file() {
            return None;
        }
        let raw = fs::read_to_string(&pkg_path).ok()?;
        let pkg: PackageJson = serde_json::from_str(&raw).ok()?;

        let name = dir_name(dir);
        let project_name = pkg.name.clone();

        let pm = if dir.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
            "bun"
        } else if dir.join("yarn.lock").exists() {
            "yarn"
        } else {
            "npm"
        };

        let preferred = ["dev", "start", "serve", "watch"];
        let mut ordered: Vec<String> = preferred
            .iter()
            .filter(|k| pkg.scripts.contains_key(**k))
            .map(|k| (*k).to_string())
            .collect();
        for k in pkg.scripts.keys() {
            if !preferred.contains(&k.as_str()) {
                ordered.push(k.clone());
            }
        }

        let suggestions: Vec<Suggestion> = ordered
            .into_iter()
            .map(|script| Suggestion {
                label: script.clone(),
                cmd: format!("{pm} run {script}"),
            })
            .collect();

        if suggestions.is_empty() {
            return None;
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "node",
            suggestions,
            package_manager: Some(pm.to_string()),
            project_name,
        })
    }
}
