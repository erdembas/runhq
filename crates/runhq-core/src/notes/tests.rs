use super::*;
use std::fs;
use std::sync::Mutex;

static SERIAL: Mutex<()> = Mutex::new(());

fn isolated_home(tmp: &tempfile::TempDir) {
    std::env::set_var("RUNHQ_HOME", tmp.path());
}

#[test]
fn create_read_write_delete_roundtrip() {
    let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    isolated_home(&tmp);

    let svc = "service-roundtrip";
    let name = create_note(svc, Some("My First Note")).unwrap();
    assert_eq!(name, "my-first-note");

    write_note(svc, &name, "# Hello\n\nbody").unwrap();
    let body = read_note(svc, &name).unwrap();
    assert_eq!(body, "# Hello\n\nbody");

    let listed = list_notes(svc).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Hello");

    assert!(delete_note(svc, &name).unwrap());
    assert!(list_notes(svc).unwrap().is_empty());
}

#[test]
fn legacy_single_file_migrates_in_place() {
    let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    isolated_home(&tmp);

    let svc = "service-legacy";
    let root = super::paths::notes_root().unwrap();
    let legacy_path = root.join(format!("{svc}.md"));
    fs::write(&legacy_path, "# Legacy\n\nbody").unwrap();
    assert!(legacy_path.exists());

    let listed = list_notes(svc).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "index");
    assert_eq!(listed[0].title, "Legacy");
    assert!(!legacy_path.exists());
    assert!(root.join(svc).join("index.md").exists());

    let again = list_notes(svc).unwrap();
    assert_eq!(again.len(), 1);
}

#[test]
fn create_dedupes_collisions() {
    let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    isolated_home(&tmp);

    let svc = "service-dedupe";
    let a = create_note(svc, Some("notes")).unwrap();
    let b = create_note(svc, Some("notes")).unwrap();
    let c = create_note(svc, Some("notes")).unwrap();
    assert_eq!(a, "notes");
    assert_eq!(b, "notes-2");
    assert_eq!(c, "notes-3");
}

#[test]
fn delete_all_wipes_everything() {
    let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    isolated_home(&tmp);

    let svc = "service-wipe";
    let _ = create_note(svc, Some("a")).unwrap();
    let _ = create_note(svc, Some("b")).unwrap();
    delete_all_notes(svc).unwrap();
    assert!(list_notes(svc).unwrap().is_empty());
}

#[test]
fn read_all_notes_concats_with_titles() {
    let _g = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    isolated_home(&tmp);

    let svc = "service-concat";
    let a = create_note(svc, Some("alpha")).unwrap();
    write_note(svc, &a, "# Alpha\n\nfirst body").unwrap();
    let b = create_note(svc, Some("beta")).unwrap();
    write_note(svc, &b, "# Beta\n\nsecond body").unwrap();

    let combined = read_all_notes(svc).unwrap();
    assert!(combined.contains("## Alpha"));
    assert!(combined.contains("## Beta"));
    assert!(combined.contains("first body"));
    assert!(combined.contains("second body"));
}

#[test]
fn extract_title_handles_leading_prose() {
    assert_eq!(
        super::title::extract_title("# Hello"),
        Some("Hello".to_string())
    );
    assert_eq!(
        super::title::extract_title("\n\n# After Blanks\n\nbody"),
        Some("After Blanks".to_string())
    );
    assert_eq!(super::title::extract_title("plain prose first"), None);
    assert_eq!(super::title::extract_title(""), None);
    assert_eq!(super::title::extract_title("# "), None);
}
