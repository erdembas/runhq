use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::error::{AppError, AppResult};

use super::runner::{configure_git_cmd, require_repo};

/// Compare the whole checkout with the task's starting commit, including commits,
/// staged/unstaged edits, and nonignored untracked files. Without a recorded base,
/// compare with HEAD (or the empty tree for an unborn branch).
///
/// This is a checkout comparison, not attribution of edits to a particular task.
/// No index, object database, or working-tree files are written. Git's external
/// diff/textconv programs are disabled so reading Changes cannot run those tools.
pub fn workspace_diff_raw(cwd: &Path, base_revision: Option<&str>) -> AppResult<String> {
    require_repo(cwd)?;
    let root_output = checked_git(cwd, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(path_from_bytes(
        root_output.strip_suffix(b"\n").unwrap_or(&root_output),
    )?);
    let baseline = match base_revision {
        Some(revision) => {
            let commit = format!("{revision}^{{commit}}");
            checked_git(
                &root,
                &["rev-parse", "--verify", "--end-of-options", &commit],
            )?
        }
        None => {
            let head = git_output(
                &root,
                &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
            )?;
            if head.status.success() {
                head.stdout
            } else {
                // Only a missing branch ref is an unborn repository. A corrupt
                // HEAD or missing object must not become an empty-tree comparison.
                let branch = checked_git(&root, &["symbolic-ref", "--quiet", "HEAD"])?;
                let branch = std::str::from_utf8(&branch)
                    .map_err(|e| AppError::Other(format!("invalid git branch ref: {e}")))?
                    .trim_end_matches(['\r', '\n']);
                let reference = git_output(&root, &["show-ref", "--verify", "--quiet", branch])?;
                if reference.status.code() != Some(1) {
                    return Err(git_error("rev-parse HEAD", &head));
                }
                // hash-object without -w only computes the id. This also handles
                // repositories using SHA-256 rather than assuming the SHA-1 id.
                checked_git(&root, &["hash-object", "-t", "tree", "--stdin"])?
            }
        }
    };
    let baseline = std::str::from_utf8(&baseline)
        .map_err(|e| AppError::Other(format!("invalid git baseline: {e}")))?
        .trim();
    let untracked = checked_git(
        &root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--full-name",
            "-z",
        ],
    )?;
    let untracked: Vec<&[u8]> = untracked
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .collect();
    let baseline_files = if untracked.is_empty() {
        HashMap::new()
    } else {
        baseline_files(&root, baseline)?
    };
    // A path removed from the index can still exist in the checkout. Exclude
    // those paths from the tracked diff and compare their actual contents once,
    // instead of reporting a deletion plus an unrelated new file.
    let exclusions: Vec<OsString> = untracked
        .iter()
        .filter(|path| baseline_files.contains_key(**path))
        .map(|path| {
            let mut spec = OsString::from(":(exclude,literal)");
            spec.push(path_from_bytes(path)?);
            Ok(spec)
        })
        .collect::<AppResult<_>>()?;
    let mut args: Vec<&OsStr> = [
        "diff",
        "--patch",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-relative",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--ignore-submodules=none",
        baseline,
        "--",
    ]
    .into_iter()
    .map(OsStr::new)
    .collect();
    args.extend(exclusions.iter().map(OsString::as_os_str));
    let tracked = checked_git(&root, &args)?;
    let mut diff = String::from_utf8_lossy(&tracked).into_owned();
    for path in untracked {
        let relative = path_from_bytes(path)?;
        let metadata = std::fs::symlink_metadata(root.join(&relative))?;
        if !metadata.is_file() && !metadata.file_type().is_symlink() {
            return Err(AppError::Other(format!(
                "unsupported untracked file type: {}",
                Path::new(&relative).display()
            )));
        }
        if let Some(blob) = baseline_files.get(path) {
            diff.push_str(&diff_recreated_file(&root, path, blob)?);
            continue;
        }
        diff.push_str(&no_index_diff(&root, OsStr::new("/dev/null"), &relative)?);
    }
    Ok(diff)
}

struct BaselineBlob {
    mode: String,
    object: String,
}

fn baseline_files(root: &Path, baseline: &str) -> AppResult<HashMap<Vec<u8>, BaselineBlob>> {
    let tree = checked_git(root, &["ls-tree", "-r", "-z", baseline])?;
    let mut files = HashMap::new();
    for entry in tree
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let separator = entry
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(|| AppError::Other("invalid git ls-tree entry".into()))?;
        let metadata = std::str::from_utf8(&entry[..separator])
            .map_err(|e| AppError::Other(format!("invalid git ls-tree metadata: {e}")))?;
        let fields: Vec<_> = metadata.split(' ').collect();
        if fields.len() != 3 {
            return Err(AppError::Other("invalid git ls-tree metadata".into()));
        }
        files.insert(
            entry[separator + 1..].to_vec(),
            BaselineBlob {
                mode: fields[0].to_owned(),
                object: fields[2].to_owned(),
            },
        );
    }
    Ok(files)
}

fn diff_recreated_file(root: &Path, path: &[u8], blob: &BaselineBlob) -> AppResult<String> {
    let relative = PathBuf::from(path_from_bytes(path)?);
    let original = root.join(&relative);
    let metadata = std::fs::symlink_metadata(&original)?;
    if !metadata.is_file() && !metadata.file_type().is_symlink() {
        return Err(AppError::Other(format!(
            "unsupported untracked file type: {}",
            original.display()
        )));
    }
    let contents = checked_git(root, &["cat-file", "blob", &blob.object])?;
    // Git has no read-only way to add untracked paths to its index comparison.
    // Only this rare index-removal case needs scratch files, outside the repo.
    let scratch = tempfile::tempdir()?;
    // Use prefixes absent from the real path, so stripping scratch directories
    // cannot accidentally alter a matching directory name inside that path.
    let scratch_prefix = |initial: &str| {
        let mut prefix = initial.to_owned();
        while path
            .windows(prefix.len())
            .any(|part| part == prefix.as_bytes())
        {
            prefix.push('_');
        }
        prefix
    };
    let before_prefix = scratch_prefix("runhq-before");
    let after_prefix = scratch_prefix("runhq-after");
    // Git preserves separators from --no-index arguments in patch headers.
    // Keep Git's slash spelling on Windows as well, without rewriting literal
    // backslashes that are valid filename characters on Unix.
    let prefixed_path = |prefix: &str| {
        let mut path = OsString::from(format!("{prefix}/"));
        path.push(relative.as_os_str());
        PathBuf::from(path)
    };
    let before = prefixed_path(&before_prefix);
    let after = prefixed_path(&after_prefix);
    std::fs::create_dir_all(scratch.path().join(&before).parent().unwrap())?;
    std::fs::create_dir_all(scratch.path().join(&after).parent().unwrap())?;
    let before_file = scratch.path().join(&before);
    let after_file = scratch.path().join(&after);
    if blob.mode == "120000" {
        create_symlink(Path::new(&path_from_bytes(&contents)?), &before_file)?;
    } else {
        std::fs::write(&before_file, contents)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if blob.mode == "100755" { 0o755 } else { 0o644 };
            std::fs::set_permissions(&before_file, std::fs::Permissions::from_mode(mode))?;
        }
    }
    if metadata.file_type().is_symlink() {
        create_symlink(&std::fs::read_link(&original)?, &after_file)?;
    } else {
        std::fs::copy(&original, &after_file)?;
    }
    let raw = no_index_diff(scratch.path(), before.as_os_str(), after.as_os_str())?;
    let mut result = String::new();
    for line in raw.split_inclusive('\n') {
        if line.starts_with("diff --git ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("Binary files ")
        {
            result.push_str(
                &line
                    .replace(&format!("a/{before_prefix}/"), "a/")
                    .replace(&format!("b/{before_prefix}/"), "b/")
                    .replace(&format!("a/{after_prefix}/"), "a/")
                    .replace(&format!("b/{after_prefix}/"), "b/"),
            );
        } else {
            result.push_str(line);
        }
    }
    Ok(result)
}

fn no_index_diff(root: &Path, before: &OsStr, after: &OsStr) -> AppResult<String> {
    let mut args: Vec<&OsStr> = [
        "diff",
        "--no-index",
        "--patch",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
    ]
    .into_iter()
    .map(OsStr::new)
    .collect();
    args.extend([before, after]);
    let output = git_output(root, &args)?;
    // --no-index implies --exit-code, but Git also returns 1 for some failures
    // (for example a file disappearing). A real difference produces a patch;
    // diagnostic errors must not look like an empty/partial successful result.
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !matches!(output.status.code(), Some(0 | 1))
        || (output.status.code() == Some(1) && output.stdout.is_empty())
        || stderr
            .lines()
            .any(|line| line.starts_with("error:") || line.starts_with("fatal:"))
    {
        return Err(git_error("diff --no-index", &output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(unix)]
fn create_symlink(target: &Path, path: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, path)
}

#[cfg(windows)]
fn create_symlink(target: &Path, path: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, path)
}

fn git_output(cwd: &Path, args: &[impl AsRef<OsStr>]) -> AppResult<Output> {
    let mut command = Command::new("git");
    command.args(args);
    configure_git_cmd(&mut command, cwd);
    command
        .output()
        .map_err(|e| AppError::Other(format!("failed to invoke git: {e}")))
}

fn checked_git(cwd: &Path, args: &[impl AsRef<OsStr>]) -> AppResult<Vec<u8>> {
    let output = git_output(cwd, args)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(git_error(&args[0].as_ref().to_string_lossy(), &output))
    }
}

fn git_error(operation: &str, output: &Output) -> AppError {
    AppError::Other(format!(
        "git {operation} failed ({}): {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(unix)]
fn path_from_bytes(bytes: &[u8]) -> AppResult<OsString> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(bytes.to_vec()))
}

#[cfg(not(unix))]
fn path_from_bytes(bytes: &[u8]) -> AppResult<OsString> {
    String::from_utf8(bytes.to_vec())
        .map(OsString::from)
        .map_err(|e| AppError::Other(format!("invalid git path: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_an_error_even_when_git_returns_exit_one() {
        let scratch = tempfile::tempdir().unwrap();
        let error = no_index_diff(
            scratch.path(),
            OsStr::new("/dev/null"),
            OsStr::new("missing-file"),
        )
        .unwrap_err();
        assert!(error.to_string().contains("diff --no-index failed"));
    }
}
