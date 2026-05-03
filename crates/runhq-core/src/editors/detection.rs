use super::catalog::KNOWN_EDITORS;
use super::resolver::detect_install;
use super::DetectedEditor;

pub async fn detect_editors() -> Vec<DetectedEditor> {
    let mut found = Vec::new();

    for editor in KNOWN_EDITORS {
        if detect_install(editor).is_some() {
            found.push(DetectedEditor {
                key: editor.key.to_string(),
                name: editor.name.to_string(),
                command: editor.command.to_string(),
            });
        }
    }

    found
}
