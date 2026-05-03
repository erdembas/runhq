use super::*;

#[test]
fn diff_clean_repo_returns_empty() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    let d = diff(td.path()).unwrap();
    assert!(d.files.is_empty());
    assert_eq!(d.total_additions, 0);
    assert_eq!(d.total_deletions, 0);
}

#[test]
fn diff_dirty_repo_returns_files() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "a.txt", "changed content");
    let d = diff(td.path()).unwrap();
    assert!(!d.files.is_empty());
    assert_eq!(d.files[0].path, "a.txt");
}

#[test]
fn diff_staged_returns_only_staged() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "b.txt", "new file");
    run_git(td.path(), &["add", "."]).unwrap();
    let d = diff_staged(td.path()).unwrap();
    assert!(!d.files.is_empty());
}

#[test]
fn diff_file_returns_raw_diff() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello\n");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "a.txt", "world\n");
    let raw = diff_file(td.path(), "a.txt", None).unwrap();
    assert!(raw.contains("-hello"));
    assert!(raw.contains("+world"));
}

#[test]
fn diff_branches_compares() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello\n");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    run_git(td.path(), &["checkout", "-b", "feature"]).unwrap();
    write_file(td.path(), "b.txt", "new\n");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "add b"]).unwrap();
    let d = diff_branches(td.path(), "main", "feature").unwrap();
    assert!(!d.files.is_empty());
}

#[test]
fn stage_then_commit_creates_commit() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    // Seed commit so HEAD exists and log has something.
    write_file(td.path(), "a.txt", "hello\n");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();

    // Unstaged change.
    write_file(td.path(), "a.txt", "world\n");
    assert!(!diff(td.path()).unwrap().files.is_empty());
    assert!(diff_staged(td.path()).unwrap().files.is_empty());

    // Stage and commit via our wrappers.
    stage_file(td.path(), "a.txt").unwrap();
    assert!(!diff_staged(td.path()).unwrap().files.is_empty());
    assert!(diff(td.path()).unwrap().files.is_empty());
    commit(td.path(), "update a", false).unwrap();

    let commits = log(td.path(), None, 10).unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].subject, "update a");
    assert_eq!(commits[0].parents.len(), 1);
}

#[test]
fn unstage_file_moves_back_to_working_tree() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello\n");
    run_git(td.path(), &["add", "."]).unwrap();
    run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
    write_file(td.path(), "a.txt", "world\n");
    stage_file(td.path(), "a.txt").unwrap();
    assert!(!diff_staged(td.path()).unwrap().files.is_empty());
    unstage_file(td.path(), "a.txt").unwrap();
    assert!(diff_staged(td.path()).unwrap().files.is_empty());
    assert!(!diff(td.path()).unwrap().files.is_empty());
}

#[test]
fn commit_rejects_empty_message() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "hello\n");
    stage_all(td.path()).unwrap();
    let res = commit(td.path(), "   ", false);
    assert!(res.is_err());
}

#[test]
fn log_on_empty_repo_returns_empty_list() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    // No commits yet.
    let commits = log(td.path(), None, 10).unwrap();
    assert!(commits.is_empty());
}

#[test]
fn show_commit_returns_numstat() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "a.txt", "one\n");
    stage_all(td.path()).unwrap();
    commit(td.path(), "first", false).unwrap();
    write_file(td.path(), "a.txt", "one\ntwo\n");
    write_file(td.path(), "b.txt", "hi\n");
    stage_all(td.path()).unwrap();
    commit(td.path(), "second", false).unwrap();

    let commits = log(td.path(), None, 10).unwrap();
    let head = &commits[0];
    let d = show_commit(td.path(), &head.hash_full).unwrap();
    assert_eq!(d.files.len(), 2);
    let raw = diff_commit_file(td.path(), &head.hash_full, "a.txt", None).unwrap();
    assert!(raw.contains("+two"));
}

/// Regression: a non-conflicting merge commit used to come back
/// with an empty per-file diff because we used `<hash>^!`, which
/// excludes *all* parents. The History panel then rendered the
/// merge as "files changed: N" with blank diff panes (the user
/// reported "merge commit'de diff olmaması normal mi?"). With
/// the `<hash>^1..<hash>` range we now show the mainline diff
/// — what the merge *brought in* from the second parent.
#[test]
fn diff_commit_file_handles_clean_merge() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    // base commit on main
    write_file(td.path(), "a.txt", "one\n");
    stage_all(td.path()).unwrap();
    commit(td.path(), "init", false).unwrap();
    // branch off and add a file with no overlap on main
    run_git(td.path(), &["checkout", "-q", "-b", "feature"]).unwrap();
    write_file(td.path(), "feat.txt", "hello\nworld\n");
    stage_all(td.path()).unwrap();
    commit(td.path(), "feat: add feat.txt", false).unwrap();
    // back to main, merge feature with --no-ff so we get a real
    // merge commit (otherwise it'd fast-forward and not be a
    // merge at all).
    run_git(td.path(), &["checkout", "-q", "main"]).unwrap();
    let (ok, _, err) = run_git(
        td.path(),
        &["merge", "--no-ff", "--no-edit", "-q", "feature"],
    )
    .unwrap();
    assert!(ok, "merge failed: {err}");

    let commits = log(td.path(), None, 10).unwrap();
    let merge_commit = &commits[0];
    // sanity: the merge brought in feat.txt
    let summary = show_commit(td.path(), &merge_commit.hash_full).unwrap();
    assert!(
        summary.files.iter().any(|f| f.path == "feat.txt"),
        "show_commit didn't list feat.txt for the merge: {:?}",
        summary.files
    );
    // The thing the previous implementation got wrong: for a
    // clean merge the per-file diff was empty. Now it should
    // contain the inserted lines.
    let raw = diff_commit_file(td.path(), &merge_commit.hash_full, "feat.txt", None).unwrap();
    assert!(
        raw.contains("+hello") && raw.contains("+world"),
        "expected per-file merge diff to include the merged-in lines, got:\n{raw}"
    );
}
