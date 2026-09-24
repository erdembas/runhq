use super::*;

fn git(dir: &Path, args: &[&str]) -> String {
    let (ok, stdout, stderr) = run_git(dir, args).unwrap();
    assert!(ok, "git {args:?}: {stderr}");
    stdout
}

fn seed(dir: &Path) -> String {
    init_repo(dir);
    write_file(dir, "committed.txt", "before\n");
    write_file(dir, "staged.txt", "before\n");
    write_file(dir, "unstaged.txt", "before\n");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-qm", "initial"]);
    git(dir, &["rev-parse", "HEAD"]).trim().to_owned()
}

fn quoted_filename() -> (&'static str, &'static str) {
    // Windows forbids control characters in filenames. Non-ASCII names still
    // exercise Git's quoted path format on that platform.
    if cfg!(windows) {
        ("café.txt", "caf\\303\\251.txt")
    } else {
        ("tab\tfile.txt", "tab\\tfile.txt")
    }
}

#[test]
fn workspace_diff_includes_commits_staged_unstaged_and_untracked_without_writes() {
    let td = tempfile::tempdir().unwrap();
    let root = td.path();
    let base = seed(root);
    write_file(root, "committed.txt", "committed change\n");
    git(root, &["add", "committed.txt"]);
    git(root, &["commit", "-qm", "task commit"]);
    write_file(root, "staged.txt", "staged change\n");
    git(root, &["add", "staged.txt"]);
    write_file(root, "unstaged.txt", "unstaged change\n");
    write_file(root, "new file.txt", "untracked change\n");
    write_file(root, ".gitignore", "ignored.txt\n");
    write_file(root, "ignored.txt", "do not include\n");
    let index = std::fs::read(root.join(".git/index")).unwrap();
    let before = git(root, &["status", "--porcelain=v1", "-z"]);
    let raw = workspace_diff_raw(root, Some(&base)).unwrap();
    for text in [
        "+committed change",
        "+staged change",
        "+unstaged change",
        "+untracked change",
    ] {
        assert!(raw.contains(text), "missing {text} in {raw}");
    }
    assert!(!raw.contains("do not include"));
    assert!(raw.contains("diff --git a/new file.txt b/new file.txt"));
    assert_eq!(std::fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(git(root, &["status", "--porcelain=v1", "-z"]), before);
    assert!(!root.join(".git/index.lock").exists());
}

#[test]
fn workspace_diff_falls_back_to_head_and_clean_checkout_is_empty() {
    let td = tempfile::tempdir().unwrap();
    let base = seed(td.path());
    assert!(workspace_diff_raw(td.path(), Some(&base))
        .unwrap()
        .is_empty());
    write_file(td.path(), "committed.txt", "committed change\n");
    git(td.path(), &["add", "."]);
    git(td.path(), &["commit", "-qm", "next"]);
    assert!(workspace_diff_raw(td.path(), None).unwrap().is_empty());
    assert!(workspace_diff_raw(td.path(), Some(&base))
        .unwrap()
        .contains("+committed change"));
}

#[test]
fn workspace_diff_unborn_repo_includes_staged_and_untracked() {
    let td = tempfile::tempdir().unwrap();
    init_repo(td.path());
    write_file(td.path(), "staged.txt", "staged\n");
    git(td.path(), &["add", "staged.txt"]);
    write_file(td.path(), "untracked.txt", "untracked\n");
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.contains("+staged"));
    assert!(raw.contains("+untracked"));
    assert!(!td
        .path()
        .join(".git/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904")
        .exists());
}

#[test]
fn workspace_diff_reports_invalid_base_and_non_repo_as_errors() {
    let td = tempfile::tempdir().unwrap();
    assert!(workspace_diff_raw(td.path(), None).is_err());
    seed(td.path());
    assert!(workspace_diff_raw(td.path(), Some("missing-task-base")).is_err());
    assert!(workspace_diff_raw(td.path(), Some("--output=/tmp/runhq-unexpected")).is_err());
}

#[test]
fn workspace_diff_covers_whole_checkout_from_project_subdirectory() {
    let td = tempfile::tempdir().unwrap();
    let base = seed(td.path());
    std::fs::create_dir(td.path().join("project")).unwrap();
    write_file(td.path(), "committed.txt", "outside project\n");
    write_file(td.path(), "project/new.txt", "inside project\n");
    let raw = workspace_diff_raw(&td.path().join("project"), Some(&base)).unwrap();
    assert!(raw.contains("+outside project"));
    assert!(raw.contains("diff --git a/project/new.txt b/project/new.txt"));
}

#[test]
fn workspace_diff_renders_binary_empty_and_quoted_untracked_paths() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    std::fs::write(td.path().join("binary.bin"), b"a\0b").unwrap();
    write_file(td.path(), "empty.txt", "");
    let (name, quoted) = quoted_filename();
    write_file(td.path(), name, "quoted path\n");
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.contains("Binary files /dev/null and b/binary.bin differ"));
    assert!(raw.contains("diff --git a/empty.txt b/empty.txt\nnew file mode"));
    assert!(
        raw.contains(&format!("diff --git \"a/{quoted}\" \"b/{quoted}\"")),
        "{raw}"
    );
}

#[cfg(unix)]
#[test]
fn workspace_diff_renders_symlinks_without_reading_their_targets() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    let outside = tempfile::tempdir().unwrap();
    write_file(
        outside.path(),
        "private.txt",
        "target contents must not be read\n",
    );
    std::os::unix::fs::symlink(outside.path().join("private.txt"), td.path().join("link")).unwrap();
    std::os::unix::fs::symlink("missing-target", td.path().join("broken-link")).unwrap();
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.contains("new file mode 120000"));
    assert!(raw.contains("+missing-target"));
    assert!(raw.contains("private.txt"));
    assert!(!raw.contains("target contents must not be read"));
}

#[cfg(unix)]
#[test]
fn workspace_diff_does_not_run_external_diff_or_textconv() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    git(td.path(), &["config", "diff.external", "false"]);
    git(td.path(), &["config", "diff.reject.textconv", "false"]);
    write_file(td.path(), ".gitattributes", "*.txt diff=reject\n");
    write_file(td.path(), "committed.txt", "safe diff\n");
    write_file(td.path(), "new.txt", "safe new file\n");
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.contains("+safe diff"));
    assert!(raw.contains("+safe new file"));
}

#[test]
fn workspace_diff_compares_recreated_untracked_file_with_its_original_contents() {
    let td = tempfile::tempdir().unwrap();
    let root = td.path();
    let base = seed(root);
    git(root, &["rm", "--cached", "staged.txt"]);
    // The staged removal does not change the checkout's contents.
    assert!(workspace_diff_raw(root, Some(&base)).unwrap().is_empty());
    write_file(root, "staged.txt", "recreated content\n");
    let raw = workspace_diff_raw(root, Some(&base)).unwrap();
    assert_eq!(raw.matches("diff --git ").count(), 1, "{raw}");
    assert!(
        raw.starts_with("diff --git a/staged.txt b/staged.txt\n"),
        "{raw}"
    );
    assert!(raw.contains("-before\n+recreated content"));
    assert!(!raw.contains("deleted file mode"));
    assert!(!raw.contains("new file mode"));
    assert!(!raw.contains("a/before/"));
    assert_eq!(git(root, &["status", "--porcelain=v1"]).lines().count(), 2);
}

#[test]
fn workspace_diff_recreated_file_preserves_quoted_paths_and_content() {
    let td = tempfile::tempdir().unwrap();
    let root = td.path();
    seed(root);
    std::fs::create_dir_all(root.join("runhq-before/directory")).unwrap();
    let (filename, quoted) = quoted_filename();
    let name = format!("runhq-before/directory/{filename}");
    write_file(root, &name, "a/before/ must remain in file content\n");
    git(root, &["add", &name]);
    git(root, &["commit", "-qm", "quoted path"]);
    git(root, &["rm", "--cached", &name]);
    write_file(root, &name, "b/after/ must also remain\n");
    let raw = workspace_diff_raw(root, None).unwrap();
    assert!(
        raw.contains(&format!("diff --git \"a/runhq-before/directory/{quoted}\" \"b/runhq-before/directory/{quoted}\"")), "{raw}"
    );
    assert!(raw.contains("-a/before/ must remain in file content"));
    assert!(raw.contains("+b/after/ must also remain"));
}

#[cfg(unix)]
#[test]
fn workspace_diff_recreated_symlink_and_binary_are_compared_as_same_paths() {
    let td = tempfile::tempdir().unwrap();
    let root = td.path();
    seed(root);
    std::os::unix::fs::symlink("old-target", root.join("link")).unwrap();
    std::fs::write(root.join("binary"), b"before\0binary").unwrap();
    git(root, &["add", "link", "binary"]);
    git(root, &["commit", "-qm", "binary and symlink"]);
    git(root, &["rm", "--cached", "link", "binary"]);
    assert!(workspace_diff_raw(root, None).unwrap().is_empty());
    std::fs::remove_file(root.join("link")).unwrap();
    std::os::unix::fs::symlink("new-target", root.join("link")).unwrap();
    std::fs::write(root.join("binary"), b"after\0binary").unwrap();
    let raw = workspace_diff_raw(root, None).unwrap();
    assert_eq!(raw.matches("diff --git ").count(), 2, "{raw}");
    assert!(raw.contains("Binary files a/binary and b/binary differ"));
    assert!(raw.contains("-old-target"));
    assert!(raw.contains("+new-target"));
    assert!(!raw.contains("new file mode"));
}

#[test]
fn workspace_diff_returns_error_for_unsupported_untracked_directory() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    let nested = td.path().join("nested-repo");
    std::fs::create_dir(&nested).unwrap();
    seed(&nested);
    let error = workspace_diff_raw(td.path(), None).unwrap_err();
    assert!(error
        .to_string()
        .contains("unsupported untracked file type"));
}

#[test]
fn workspace_diff_returns_error_for_corrupt_index() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    std::fs::write(td.path().join(".git/index"), "invalid index contents").unwrap();
    assert!(workspace_diff_raw(td.path(), None).is_err());
}

#[test]
fn workspace_diff_ignores_display_and_exit_code_configuration() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    git(td.path(), &["config", "color.ui", "always"]);
    git(td.path(), &["config", "diff.exitCode", "true"]);
    git(td.path(), &["config", "diff.noprefix", "true"]);
    git(td.path(), &["config", "diff.relative", "true"]);
    write_file(td.path(), "committed.txt", "changed\n");
    write_file(td.path(), "new.txt", "new\n");
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.starts_with("diff --git a/committed.txt b/committed.txt"));
    assert!(raw.contains("diff --git a/new.txt b/new.txt"));
    assert!(!raw.contains('\u{1b}'));
}

#[cfg(unix)]
#[test]
fn workspace_diff_recreated_file_can_change_type_without_leaking_scratch_paths() {
    let td = tempfile::tempdir().unwrap();
    seed(td.path());
    git(td.path(), &["rm", "committed.txt"]);
    std::os::unix::fs::symlink("target", td.path().join("committed.txt")).unwrap();
    let raw = workspace_diff_raw(td.path(), None).unwrap();
    assert!(raw.contains("deleted file mode 100644"));
    assert!(raw.contains("new file mode 120000"));
    assert!(raw.contains("+target"));
    assert!(!raw.contains("runhq-before"));
    assert!(!raw.contains("runhq-after"));
    assert_eq!(
        raw.matches("diff --git a/committed.txt b/committed.txt")
            .count(),
        2
    );
}
