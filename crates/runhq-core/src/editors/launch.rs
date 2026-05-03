use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::catalog::KNOWN_EDITORS;
use super::resolver::{detect_install, EditorLaunch};

pub async fn open_in_editor(command: &str, path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::Invalid(format!(
            "path does not exist: {}",
            path.display()
        )));
    }

    let launch = KNOWN_EDITORS
        .iter()
        .find(|e| e.command == command)
        .and_then(detect_install);

    match launch {
        Some(EditorLaunch::Cli(cli)) => spawn_with_path(cli, path).await,
        #[cfg(target_os = "macos")]
        Some(EditorLaunch::MacApp(name)) => spawn_open_a(&name, path).await,
        #[cfg(any(windows, target_os = "linux"))]
        Some(EditorLaunch::Exe(exe)) => spawn_with_path(exe, path).await,
        None => spawn_with_path(PathBuf::from(command), path).await,
    }
}

async fn spawn_with_path(exe: PathBuf, path: &Path) -> AppResult<()> {
    let display = exe.display().to_string();
    let mut child = tokio::process::Command::new(&exe)
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to launch '{display}': {e}")))?;

    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(())
}

#[cfg(target_os = "macos")]
async fn spawn_open_a(app_name: &str, path: &Path) -> AppResult<()> {
    let mut child = tokio::process::Command::new("/usr/bin/open")
        .arg("-a")
        .arg(app_name)
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Other(format!("open -a '{app_name}' failed: {e}")))?;

    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(())
}
