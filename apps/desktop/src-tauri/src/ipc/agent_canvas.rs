use tauri_plugin_dialog::DialogExt;

/// Start the local, static canvas renderer on demand. No artifact source crosses IPC.
#[tauri::command]
pub async fn agent_canvas_url() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::agent_canvas::preview_url)
        .await
        .map_err(|error| format!("Canvas preview failed: {error}"))?
}

/// Write only to a path explicitly chosen in the native save dialog.
#[tauri::command]
pub async fn agent_canvas_save(
    app: tauri::AppHandle,
    filename: String,
    source: String,
) -> Result<Option<String>, String> {
    if filename.is_empty() || filename.len() > 200 || filename.contains(['/', '\\', '\0']) {
        return Err("Invalid canvas filename".into());
    }
    if source.len() > 2_000_000 {
        return Err("Canvas export is limited to 2 MB".into());
    }
    let extension = filename.rsplit('.').next().unwrap_or_default();
    if !matches!(extension, "html" | "svg" | "md") {
        return Err("Unsupported canvas file type".into());
    }
    let extension = extension.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title(crate::tray::localize(&app, "Save canvas"))
            .set_file_name(filename)
            .add_filter(crate::tray::localize(&app, "Canvas"), &[&extension])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        std::fs::write(&path, source).map_err(|error| format!("Could not save canvas: {error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("Canvas export failed: {error}"))?
}
