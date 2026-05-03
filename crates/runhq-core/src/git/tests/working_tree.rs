use super::*;

#[test]
fn stash_then_pop_restores_working_tree() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "a.txt", "changed");

    stash(td.path(), Some("wip")).unwrap();
    let s = status(td.path()).unwrap();
    assert!(!s.is_dirty, "stash should have cleaned the tree");

    stash_pop(td.path()).unwrap();
    let s = status(td.path()).unwrap();
    assert!(s.is_dirty, "pop should have reapplied the change");
    assert_eq!(
        std::fs::read_to_string(td.path().join("a.txt")).unwrap(),
        "changed"
    );
}

#[test]
fn stash_pop_errors_when_empty() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    assert!(stash_pop(td.path()).is_err());
}

#[test]
fn undo_last_commit_keeps_changes_staged() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "b.txt", "second");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "second"]).unwrap();

    undo_last_commit(td.path()).unwrap();
    let s = status(td.path()).unwrap();
    // HEAD is now back at 'initial', but b.txt is still staged so the
    // tree shows as dirty — that's the whole point of --soft.
    assert_eq!(s.last_commit.unwrap().subject, "initial");
    assert!(s.is_dirty);
}

#[test]
fn undo_last_commit_errors_on_single_commit() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    // HEAD~1 doesn't exist — git errors and we propagate it.
    assert!(undo_last_commit(td.path()).is_err());
}

#[test]
fn amend_commit_message_rewrites_subject() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "typo"]).unwrap();

    amend_commit_message(td.path(), "fix: proper subject").unwrap();
    let s = status(td.path()).unwrap();
    assert_eq!(s.last_commit.unwrap().subject, "fix: proper subject");
}

#[test]
fn amend_commit_message_rejects_empty() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    assert!(amend_commit_message(td.path(), "   ").is_err());
}
