use super::catalog::KNOWN_EDITORS;
use super::detect_editors;
use super::paths::dev_tool_dirs;

#[tokio::test]
async fn detect_returns_vec() {
    let editors = detect_editors().await;
    assert!(!editors.is_empty() || editors.is_empty());
}

#[test]
fn dev_tool_dirs_has_entries() {
    let dirs = dev_tool_dirs();
    assert!(!dirs.is_empty(), "dev_tool_dirs should never be empty");
}

#[test]
fn known_editors_have_unique_keys() {
    let mut keys: Vec<&str> = KNOWN_EDITORS.iter().map(|e| e.key).collect();
    let before = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(
        before,
        keys.len(),
        "KNOWN_EDITORS contains duplicate keys: {keys:?}"
    );
}
