use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::AgentDetectionSource;

#[derive(Debug, Clone)]
pub(super) struct ResolvedExecutable {
    pub path: PathBuf,
    pub source: AgentDetectionSource,
    pub runnable: bool,
}

pub(super) struct ExecutableSearch {
    path_dirs: Vec<PathBuf>,
    known_dirs: Vec<PathBuf>,
    app_dirs: Vec<PathBuf>,
}

impl ExecutableSearch {
    pub fn from_env() -> Self {
        let path_dirs = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .filter(|dir| dir.is_absolute())
            .collect();
        let mut known_dirs = Vec::new();
        let mut app_dirs = Vec::new();
        if let Some(home) = dirs::home_dir() {
            for relative in [
                ".local/bin",
                ".opencode/bin",
                ".npm-global/bin",
                ".npm/bin",
                ".volta/bin",
                ".bun/bin",
                ".asdf/shims",
                ".local/share/mise/shims",
                "Library/pnpm",
                ".local/share/pnpm",
                "AppData/Roaming/npm",
                "scoop/shims",
            ] {
                known_dirs.push(home.join(relative));
            }
            add_versions(&mut known_dirs, &home.join(".nvm/versions/node"), "bin");
            add_versions(
                &mut known_dirs,
                &home.join(".local/share/fnm/node-versions"),
                "installation/bin",
            );
            add_versions(
                &mut known_dirs,
                &home.join("Library/Application Support/fnm/node-versions"),
                "installation/bin",
            );
            add_versions(
                &mut known_dirs,
                &home.join(".local/share/mise/installs/node"),
                "bin",
            );
            add_versions(&mut known_dirs, &home.join(".asdf/installs/nodejs"), "bin");
            add_versions(
                &mut known_dirs,
                &home.join(".volta/tools/image/node"),
                "bin",
            );
            app_dirs.push(home.join("Applications"));
        }
        for (variable, suffix) in [
            ("NPM_CONFIG_PREFIX", "bin"),
            ("VOLTA_HOME", "bin"),
            ("PNPM_HOME", ""),
            ("ProgramFiles", "nodejs"),
            ("LOCALAPPDATA", "Programs/nodejs"),
        ] {
            if let Some(root) = absolute_env(variable) {
                known_dirs.push(root.join(suffix));
            }
        }
        if let Some(root) = absolute_env("NVM_DIR") {
            add_versions(&mut known_dirs, &root.join("versions/node"), "bin");
        }
        if let Some(root) = absolute_env("FNM_DIR") {
            add_versions(
                &mut known_dirs,
                &root.join("node-versions"),
                "installation/bin",
            );
        }
        known_dirs
            .extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
        #[cfg(target_os = "macos")]
        app_dirs.push(PathBuf::from("/Applications"));
        Self {
            path_dirs,
            known_dirs,
            app_dirs,
        }
    }

    pub fn resolve(&self, name: &str) -> Option<ResolvedExecutable> {
        let explicit = Path::new(name);
        if explicit.is_absolute() {
            return candidate(explicit.to_path_buf(), AgentDetectionSource::Explicit);
        }
        if name.is_empty() || name.contains('/') || name.contains('\\') {
            return None;
        }
        let mut first_unrunnable = None;
        for (dirs, source) in [
            (&self.path_dirs, AgentDetectionSource::Path),
            (&self.known_dirs, AgentDetectionSource::KnownLocation),
        ] {
            for dir in dirs {
                if !dir.is_absolute() {
                    continue;
                }
                for filename in executable_names(name) {
                    if let Some(found) = candidate(dir.join(filename), source) {
                        if found.runnable {
                            return Some(found);
                        }
                        first_unrunnable.get_or_insert(found);
                    }
                }
            }
        }
        // Cursor has used both names; prefer the requested name everywhere before its alias.
        if name == "agent" {
            if let Some(found) = self.resolve("cursor-agent") {
                if found.runnable {
                    return Some(found);
                }
                first_unrunnable.get_or_insert(found);
            }
        }
        if name == "codex" {
            for dir in &self.app_dirs {
                for app in ["Codex.app", "ChatGPT.app"] {
                    if let Some(found) = candidate(
                        dir.join(app).join("Contents/Resources/codex"),
                        AgentDetectionSource::KnownLocation,
                    ) {
                        if found.runnable {
                            return Some(found);
                        }
                        first_unrunnable.get_or_insert(found);
                    }
                }
            }
        }
        first_unrunnable
    }

    pub fn command_path(&self, executable: &Path) -> Option<OsString> {
        let mut directories = Vec::new();
        // A Node CLI using #!/usr/bin/env node must use the same Node the bridge resolves.
        if let Some(node) = self.resolve("node").filter(|node| node.runnable) {
            if let Some(parent) = node.path.parent() {
                directories.push(parent.to_path_buf());
            }
        }
        if let Some(parent) = executable.parent() {
            directories.push(parent.to_path_buf());
        }
        directories.extend(self.path_dirs.iter().cloned());
        directories.extend(self.known_dirs.iter().cloned());
        let mut seen = HashSet::new();
        directories.retain(|dir| dir.is_absolute() && seen.insert(dir.clone()));
        std::env::join_paths(directories).ok()
    }
}

fn absolute_env(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn executable_names(name: &str) -> Vec<String> {
    #[cfg(windows)]
    if Path::new(name).extension().is_none() {
        return [".exe", ".cmd", ".bat", ""]
            .map(|suffix| format!("{name}{suffix}"))
            .to_vec();
    }
    vec![name.to_string()]
}

fn candidate(path: PathBuf, source: AgentDetectionSource) -> Option<ResolvedExecutable> {
    let metadata = std::fs::metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    #[cfg(unix)]
    let runnable = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    };
    #[cfg(not(unix))]
    let runnable = true;
    Some(ResolvedExecutable {
        path,
        source,
        runnable,
    })
}

fn add_versions(dirs: &mut Vec<PathBuf>, root: &Path, suffix: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut versions: Vec<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let key: Option<Vec<u64>> = name
                .trim_start_matches('v')
                .split('.')
                .map(|part| part.parse().ok())
                .collect();
            key.filter(|key| !key.is_empty())
                .map(|key| (key, entry.path()))
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    dirs.extend(versions.into_iter().map(|(_, path)| path.join(suffix)));
}

pub(super) fn resolve(name: &str) -> Option<ResolvedExecutable> {
    ExecutableSearch::from_env().resolve(name)
}

/// PATH for one agent-owned child; never changes RunHQ's global environment.
pub fn agent_command_path(executable: &Path) -> Option<OsString> {
    ExecutableSearch::from_env().command_path(executable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &Path, executable: bool) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                path,
                std::fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
            )
            .unwrap();
        }
        #[cfg(not(unix))]
        let _ = executable;
    }

    #[test]
    fn path_precedes_known_locations_and_explicit_paths_never_fall_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("path");
        let known = dir.path().join("known");
        file(&path.join("agent"), true);
        file(&known.join("agent"), true);
        let search = ExecutableSearch {
            path_dirs: vec![PathBuf::from("."), path.clone()],
            known_dirs: vec![known.clone()],
            app_dirs: vec![],
        };
        let found = search.resolve("agent").unwrap();
        assert_eq!(found.path, path.join("agent"));
        assert_eq!(found.source, AgentDetectionSource::Path);
        let explicit = search
            .resolve(known.join("agent").to_str().unwrap())
            .unwrap();
        assert_eq!(explicit.source, AgentDetectionSource::Explicit);
        assert!(search
            .resolve(dir.path().join("missing/agent").to_str().unwrap())
            .is_none());
        assert!(search.resolve("./agent").is_none());
    }

    #[test]
    fn aliases_app_bundles_and_numeric_node_versions_are_discovered() {
        let dir = tempfile::tempdir().unwrap();
        let known = dir.path().join("known");
        file(&known.join("cursor-agent"), true);
        file(&dir.path().join("Codex.app/Contents/Resources/codex"), true);
        let versions = dir.path().join("versions");
        for version in ["v9.9.0", "v22.2.0", "v22.10.0"] {
            file(&versions.join(version).join("bin/node"), true);
        }
        let mut bins = vec![known.clone()];
        add_versions(&mut bins, &versions, "bin");
        let search = ExecutableSearch {
            path_dirs: vec![],
            known_dirs: bins,
            app_dirs: vec![dir.path().to_path_buf()],
        };
        assert_eq!(
            search.resolve("agent").unwrap().path,
            known.join("cursor-agent")
        );
        assert_eq!(
            search.resolve("codex").unwrap().source,
            AgentDetectionSource::KnownLocation
        );
        assert!(search
            .resolve("node")
            .unwrap()
            .path
            .ends_with("v22.10.0/bin/node"));
        let child_path = search.command_path(&known.join("cursor-agent")).unwrap();
        assert_eq!(
            std::env::split_paths(&child_path).next().unwrap(),
            versions.join("v22.10.0/bin")
        );
    }

    #[test]
    #[cfg(unix)]
    fn non_executable_files_and_directories_do_not_shadow_real_programs() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        file(&first.join("claude"), false);
        file(&second.join("claude"), true);
        std::fs::create_dir_all(first.join("node")).unwrap();
        let search = ExecutableSearch {
            path_dirs: vec![first.clone(), second.clone()],
            known_dirs: vec![],
            app_dirs: vec![],
        };
        assert_eq!(
            search.resolve("claude").unwrap().path,
            second.join("claude")
        );
        assert!(
            !search
                .resolve(first.join("claude").to_str().unwrap())
                .unwrap()
                .runnable
        );
        assert!(search.resolve("node").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn resolved_node_is_available_to_shebang_children_without_global_path_changes() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node-bin");
        let cli = dir.path().join("tools/cli");
        file(&bin.join("node"), true);
        file(&cli, true);
        std::fs::write(bin.join("node"), "#!/bin/sh\nprintf resolved-node").unwrap();
        std::fs::write(&cli, "#!/usr/bin/env node\nfixture").unwrap();
        let search = ExecutableSearch {
            path_dirs: vec![],
            known_dirs: vec![bin],
            app_dirs: vec![],
        };
        let before = std::env::var_os("PATH");
        let output = std::process::Command::new(&cli)
            .env_clear()
            .env("PATH", search.command_path(&cli).unwrap())
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"resolved-node");
        assert_eq!(std::env::var_os("PATH"), before);
    }
}
