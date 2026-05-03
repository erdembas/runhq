use super::*;

#[test]
fn non_repo_returns_none() {
    let td = tempfile::tempdir().unwrap();
    assert!(!is_repo(td.path()));
    assert!(status(td.path()).is_none());
    assert!(current_commit_short(td.path()).is_none());
    assert_eq!(list_branches(td.path()).unwrap(), Vec::<String>::new());
}

#[test]
fn status_clean_after_commit() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();

    let s = status(td.path()).expect("repo");
    assert_eq!(s.branch.as_deref(), Some("main"));
    assert!(!s.is_dirty);
    assert_eq!(s.dirty_count, 0);
    assert_eq!(s.ahead, 0);
    assert_eq!(s.behind, 0);
    assert!(s.upstream.is_none());
    assert!(s.head_full.is_some());
    assert_eq!(s.head_short.as_ref().unwrap().len(), 7);
    let lc = s.last_commit.unwrap();
    assert_eq!(lc.subject, "initial");
    assert!(!lc.author.is_empty());
}

#[test]
fn status_dirty_after_change() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "a.txt", "changed");

    let s = status(td.path()).unwrap();
    assert!(s.is_dirty);
    assert_eq!(s.dirty_count, 1);
}

#[test]
fn status_dirty_includes_untracked() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "new.txt", "untracked");

    let s = status(td.path()).unwrap();
    assert!(s.is_dirty);
    assert_eq!(s.dirty_count, 1);
}

#[test]
fn list_branches_returns_locals() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    run_git(td.path(), &["branch", "feature"]).unwrap();
    let mut b = list_branches(td.path()).unwrap();
    b.sort();
    assert_eq!(b, vec!["feature".to_string(), "main".to_string()]);
}

#[test]
fn create_branch_switches_to_new() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    create_branch(td.path(), "topic").unwrap();
    let s = status(td.path()).unwrap();
    assert_eq!(s.branch.as_deref(), Some("topic"));
}

#[test]
fn create_branch_rejects_empty() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    assert!(create_branch(td.path(), "   ").is_err());
}

#[test]
fn delete_branch_removes_merged_branch() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    run_git(td.path(), &["branch", "feature"]).unwrap();
    delete_branch(td.path(), "feature", false).unwrap();
    let b = list_branches(td.path()).unwrap();
    assert!(!b.iter().any(|n| n == "feature"));
}

#[test]
fn delete_branch_refuses_unmerged_without_force() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    run_git(td.path(), &["checkout", "-b", "feature"]).unwrap();
    write_file(td.path(), "b.txt", "wip");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "wip"]).unwrap();
    // switch back so we can delete `feature`
    run_git(td.path(), &["checkout", "-q", "main"]).unwrap();
    assert!(delete_branch(td.path(), "feature", false).is_err());
    // force succeeds
    delete_branch(td.path(), "feature", true).unwrap();
    let b = list_branches(td.path()).unwrap();
    assert!(!b.iter().any(|n| n == "feature"));
}

#[test]
fn delete_branch_rejects_empty_name() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    assert!(delete_branch(td.path(), "  ", false).is_err());
}

#[test]
fn list_remote_branches_empty_when_no_remote() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    let r = list_remote_branches(td.path()).unwrap();
    assert!(r.is_empty());
}

#[test]
fn checkout_switches_branch() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    run_git(td.path(), &["branch", "feature"]).unwrap();
    checkout(td.path(), "feature").unwrap();
    let s = status(td.path()).unwrap();
    assert_eq!(s.branch.as_deref(), Some("feature"));
}
