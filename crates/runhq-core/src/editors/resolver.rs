use std::path::PathBuf;

use super::catalog::KnownEditor;
use super::paths::locate_executable;

pub(super) enum EditorLaunch {
    Cli(PathBuf),
    #[cfg(target_os = "macos")]
    MacApp(String),
    #[cfg(any(windows, target_os = "linux"))]
    Exe(PathBuf),
}

pub(super) fn detect_install(editor: &KnownEditor) -> Option<EditorLaunch> {
    if let Some(cli) = locate_executable(editor.command) {
        return Some(EditorLaunch::Cli(cli));
    }

    #[cfg(target_os = "macos")]
    {
        use super::paths::macos_app_roots;

        for bundle in editor.mac_app_bundles {
            for root in macos_app_roots() {
                let p = root.join(bundle);
                if p.exists() {
                    let name = bundle.trim_end_matches(".app").to_string();
                    return Some(EditorLaunch::MacApp(name));
                }
            }
        }
    }

    #[cfg(windows)]
    {
        use super::paths::windows_program_roots;

        for rel in editor.win_exe_paths {
            for root in windows_program_roots() {
                let p = root.join(rel);
                if p.is_file() {
                    return Some(EditorLaunch::Exe(p));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for p in editor.linux_paths {
            let pb = PathBuf::from(p);
            if pb.is_file() {
                return Some(EditorLaunch::Exe(pb));
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = editor.mac_app_bundles;
    #[cfg(not(windows))]
    let _ = editor.win_exe_paths;
    #[cfg(not(target_os = "linux"))]
    let _ = editor.linux_paths;

    None
}
