use std::path::Path;

use super::runner::run_git;
use super::*;

fn init_repo(dir: &Path) {
    run_git(dir, &["init", "-q", "-b", "main"]).unwrap();
    run_git(dir, &["config", "user.email", "t@t.test"]).unwrap();
    run_git(dir, &["config", "user.name", "t"]).unwrap();
    run_git(dir, &["config", "commit.gpgsign", "false"]).unwrap();
}

fn write_file(dir: &Path, name: &str, body: &str) {
    std::fs::write(dir.join(name), body).unwrap();
}

mod diff_history;
mod status_branch;
mod working_tree;
