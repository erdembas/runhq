use std::path::PathBuf;

pub(super) fn dev_tool_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(path_env) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path_env));
    }

    #[cfg(target_os = "macos")]
    {
        for extra in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            dirs.push(PathBuf::from(extra));
        }
    }

    #[cfg(target_os = "linux")]
    {
        for extra in [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/snap/bin",
            "/var/lib/flatpak/exports/bin",
        ] {
            dirs.push(PathBuf::from(extra));
        }
    }

    #[cfg(windows)]
    {
        for var in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
            if let Ok(v) = std::env::var(var) {
                let root = PathBuf::from(v);
                dirs.push(root.join("Microsoft VS Code").join("bin"));
                dirs.push(root.join("Neovim").join("bin"));
                dirs.push(root.join("Sublime Text"));
            }
        }
        if let Ok(v) = std::env::var("LOCALAPPDATA") {
            let prog = PathBuf::from(v).join("Programs");
            dirs.push(prog.join("Microsoft VS Code").join("bin"));
            dirs.push(
                prog.join("cursor")
                    .join("resources")
                    .join("app")
                    .join("bin"),
            );
            dirs.push(
                prog.join("Windsurf")
                    .join("resources")
                    .join("app")
                    .join("bin"),
            );
        }
    }

    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
        dirs.push(home.join(".cargo/bin"));

        #[cfg(target_os = "macos")]
        {
            dirs.push(home.join("Library/Application Support/JetBrains/Toolbox/scripts"));
        }
        #[cfg(target_os = "linux")]
        {
            dirs.push(home.join(".local/share/JetBrains/Toolbox/scripts"));
            dirs.push(home.join(".local/share/flatpak/exports/bin"));
        }
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData/Local/JetBrains/Toolbox/scripts"));
        }
    }

    let mut seen = std::collections::HashSet::new();
    dirs.retain(|p| seen.insert(p.clone()));
    dirs
}

pub(super) fn locate_executable(command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let candidates: Vec<String> = vec![
        format!("{command}.exe"),
        format!("{command}.cmd"),
        format!("{command}.bat"),
        command.to_string(),
    ];
    #[cfg(not(windows))]
    let candidates: Vec<String> = vec![command.to_string()];

    for dir in dev_tool_dirs() {
        for name in &candidates {
            let full = dir.join(name);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub(super) fn macos_app_roots() -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        out.push(home.join("Applications"));
    }
    out
}

#[cfg(windows)]
pub(super) fn windows_program_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Ok(v) = std::env::var(var) {
            out.push(PathBuf::from(v));
        }
    }
    if let Ok(v) = std::env::var("LOCALAPPDATA") {
        out.push(PathBuf::from(v).join("Programs"));
    }
    out
}
