use super::*;
use regex::Regex;
use std::collections::{BTreeMap, HashSet};
use std::io::Read;
const LIMIT: usize = 16 * 1024 * 1024;
// Archive keys stay portable even when host PathBufs use backslashes.
fn portable_name(path: &Path) -> String {
    path.iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
fn relative(s: &str) -> AppResult<PathBuf> {
    let p = Path::new(s);
    if s.is_empty()
        || s.contains(['\\', ':', '\0'])
        || p.components().any(|c| {
            !matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return Err(invalid("pipeline.invalid_path"));
    }
    Ok(p.components()
        .filter(|c| matches!(c, std::path::Component::Normal(_)))
        .collect())
}
fn read_limit(mut r: impl Read, limit: usize) -> AppResult<Vec<u8>> {
    let mut b = vec![];
    r.by_ref().take((limit + 1) as u64).read_to_end(&mut b)?;
    if b.len() > limit {
        return Err(invalid("pipeline.package_limit"));
    }
    Ok(b)
}
pub(super) fn read_package(path: &Path) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    let mut size = 0;
    let mut aliases = HashSet::new();
    if path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("zip"))
    {
        let file = std::fs::File::open(path)?;
        if file.metadata()?.len() > LIMIT as u64 {
            return Err(invalid("pipeline.package_limit"));
        }
        let mut zip =
            zip::ZipArchive::new(file).map_err(|_| invalid("pipeline.invalid_archive"))?;
        if zip.len() > 1024 {
            return Err(invalid("pipeline.package_limit"));
        }
        for i in 0..zip.len() {
            let f = zip
                .by_index(i)
                .map_err(|_| invalid("pipeline.invalid_archive"))?;
            relative(f.name())?;
            if f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
                return Err(invalid("pipeline.invalid_path"));
            }
            if f.is_dir() {
                continue;
            }
            let name = portable_name(&relative(f.name())?);
            if !aliases.insert(name.to_lowercase()) {
                return Err(invalid("pipeline.invalid_archive"));
            }
            let b = read_limit(f, LIMIT - size)?;
            size += b.len();
            if files.insert(name, b).is_some() {
                return Err(invalid("pipeline.invalid_archive"));
            }
        }
    } else {
        let root = path
            .parent()
            .ok_or_else(|| invalid("pipeline.invalid_path"))?
            .canonicalize()?;
        let bytes = read_limit(std::fs::File::open(path)?, LIMIT)?;
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| invalid("pipeline.invalid_manifest"))?;
        size += bytes.len();
        files.insert("pipeline.json".into(), bytes);
        let mut names: Vec<String> = manifest
            .steps
            .iter()
            .filter(|s| !s.prompt_file.is_empty())
            .map(|s| s.prompt_file.clone())
            .collect();
        names.extend(manifest.assets);
        if let Some(metadata) = manifest.package {
            let mut pending = metadata.contents;
            while let Some(name) = pending.pop() {
                let local = root.join(relative(&name)?).canonicalize()?;
                if !local.starts_with(&root) {
                    return Err(invalid("pipeline.invalid_path"));
                }
                if local.is_dir() {
                    for entry in std::fs::read_dir(&local)? {
                        let e = entry?;
                        if e.file_type()?.is_symlink() {
                            return Err(invalid("pipeline.invalid_path"));
                        }
                        pending.push(portable_name(
                            e.path()
                                .strip_prefix(&root)
                                .map_err(|_| invalid("pipeline.invalid_path"))?,
                        ));
                    }
                } else {
                    names.push(name);
                }
                if pending.len() + names.len() > 1024 {
                    return Err(invalid("pipeline.package_limit"));
                }
            }
        }
        names.extend(
            [
                "verify.sh",
                "state.sh",
                "review-worktree.sh",
                "KARARLAR.md",
                "README.md",
            ]
            .into_iter()
            .filter(|s| root.join(s).is_file())
            .map(String::from),
        );
        for name in names {
            let name = portable_name(&relative(&name)?);
            if files.contains_key(&name) {
                continue;
            }
            let p = root.join(relative(&name)?).canonicalize()?;
            if !p.starts_with(&root) {
                return Err(invalid("pipeline.invalid_path"));
            }
            let b = read_limit(std::fs::File::open(p)?, LIMIT - size)?;
            size += b.len();
            files.insert(name, b);
        }
    }
    if !files.contains_key("pipeline.json") {
        let manifests: Vec<_> = files
            .keys()
            .filter(|k| k.ends_with("/pipeline.json"))
            .cloned()
            .collect();
        if manifests.len() != 1 {
            return Err(invalid("pipeline.invalid_manifest"));
        }
        let prefix = manifests[0].strip_suffix("pipeline.json").unwrap();
        if files.keys().any(|k| !k.starts_with(prefix)) {
            return Err(invalid("pipeline.invalid_archive"));
        }
        return Ok(files
            .iter()
            .map(|(k, v)| (k[prefix.len()..].into(), v.clone()))
            .collect());
    }
    Ok(files)
}
pub(super) fn validate_manifest(m: &Manifest) -> AppResult<()> {
    if ![1, 2].contains(&m.version)
        || m.name.trim().is_empty()
        || m.name.len() > 200
        || m.steps.is_empty()
        || m.steps.len() > 512
    {
        return Err(invalid("pipeline.invalid_manifest"));
    }
    let p = &m.settings;
    if p.paths_relative_to != "pipelineFile"
        || p.agent_working_directory.is_empty()
        || p.agent_timeout_minutes == 0
        || p.agent_timeout_minutes > 10080
        || p.shell_timeout_minutes == 0
        || p.shell_timeout_minutes > 10080
        || p.max_concurrent_unlocked_steps == 0
        || p.max_concurrent_unlocked_steps > 16
        || !["agent", "plan"].contains(&p.agent_mode.as_str())
        || p.agent_permissions
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>()
            != HashSet::from(["read", "write", "terminal"])
        || p.locks.values().any(|l| l.max_concurrent != 1)
        || p.review.max_reviews_per_plan == 0
        || p.review.max_reviews_per_plan > 11
        || p.review.max_fixes_per_plan > 10
        || p.review.accept_conditional_from_review > p.review.max_reviews_per_plan
    {
        return Err(invalid("pipeline.invalid_settings"));
    }
    let f = &p.failure_policy;
    if f.on_missing_or_ambiguous_result_line != "treatAsFailed"
        || f.on_halt != "stopStartingNewSteps"
        || f.running_steps_on_halt != "letFinish"
        || f.resume != "rerunHaltedStep"
    {
        return Err(invalid("pipeline.invalid_settings"));
    }
    if let Some(line) = &p.result_line {
        if line.position != "last"
            || !line.trim_trailing_whitespace
            || Regex::new(&line.agent_steps).is_err()
            || Regex::new(&line.review_steps).is_err()
        {
            return Err(invalid("pipeline.invalid_settings"));
        }
        if m.steps.iter().filter(|s| s.r#type == "agent").any(|s| {
            if s.review() {
                !s.capture.as_ref().unwrap().verdict.last_line()
            } else {
                s.success
                    .as_ref()
                    .and_then(|s| s.last_line_regex.as_ref())
                    .is_none()
            }
        }) {
            return Err(invalid("pipeline.invalid_settings"));
        }
    }
    relative(&p.shell_working_directory)?;

    let ids: HashSet<_> = m.steps.iter().map(|s| s.id.as_str()).collect();
    if ids.len() != m.steps.len() {
        return Err(invalid("pipeline.invalid_graph"));
    }
    let id_pattern = Regex::new("^[a-z0-9][a-z0-9_-]{0,63}$").unwrap();
    for s in &m.steps {
        if !id_pattern.is_match(&s.id)
            || !["agent", "shell", "human", "barrier"].contains(&s.r#type.as_str())
            || s.depends_on
                .iter()
                .any(|d| !ids.contains(d.as_str()) || d == &s.id)
            || s.max_runs == 0
            || s.max_runs > 11
            || s.timeout_minutes.is_some_and(|t| t == 0 || t > 10080)
            || (!s.mode.is_empty() && !["agent", "default", "plan"].contains(&s.mode.as_str()))
            || s.lock.len() > 128
            || (!s.lock.is_empty() && !p.locks.contains_key(&s.lock))
        {
            return Err(invalid("pipeline.invalid_step"));
        }
        if s.review()
            && (s.r#type != "agent"
                || !s.lock.is_empty()
                || s.max_runs > p.review.max_reviews_per_plan)
        {
            return Err(invalid("pipeline.invalid_step"));
        }
        if s.r#type == "agent" && (s.prompt.is_empty() && s.prompt_file.is_empty())
            || s.r#type == "shell" && s.command.trim().is_empty()
            || s.prompt.len() > 128 * 1024
            || s.command.len() > 128 * 1024
        {
            return Err(invalid("pipeline.invalid_step"));
        }
        if !s.prompt_file.is_empty() {
            relative(&s.prompt_file)?;
        }
        if (s.r#type != "barrier"
            && (!s.complete_if.is_empty()
                || !s.require_pass.is_empty()
                || matches!(s.halt_if, Some(Halt::Expression(_)))))
            || (["human", "barrier"].contains(&s.r#type.as_str())
                && (s.success.is_some()
                    || matches!(s.halt_if, Some(Halt::Match(_)))
                    || !s.lock.is_empty()
                    || s.max_runs != 1))
            || (s.r#type == "agent"
                && !s.review()
                && s.success
                    .as_ref()
                    .and_then(|m| m.output_regex.as_ref().or(m.last_line_regex.as_ref()))
                    .is_none())
            || (s.review() && s.success.is_some())
        {
            return Err(invalid("pipeline.invalid_step"));
        }
        let mut ancestors = HashSet::new();
        let mut remaining = s.depends_on.clone();
        while let Some(id) = remaining.pop() {
            if ancestors.insert(id.clone()) {
                if let Some(parent) = m.steps.iter().find(|s| s.id == id) {
                    remaining.extend(parent.depends_on.clone());
                }
            }
        }
        for e in [&s.run_if, &s.complete_if]
            .into_iter()
            .chain(s.halt_if.as_ref().and_then(|h| {
                if let Halt::Expression(e) = h {
                    Some(e)
                } else {
                    None
                }
            }))
        {
            for id in condition::references(e)? {
                if !ancestors.contains(&id) || !m.steps.iter().any(|s| s.id == id && s.review()) {
                    return Err(invalid("pipeline.invalid_condition"));
                }
            }
        }
        for id in &s.require_pass {
            if !ancestors.contains(id) || !m.steps.iter().any(|s| &s.id == id && s.review()) {
                return Err(invalid("pipeline.invalid_condition"));
            }
        }
        for matcher in s.success.iter().chain(s.halt_if.iter().filter_map(|h| {
            if let Halt::Match(m) = h {
                Some(m)
            } else {
                None
            }
        })) {
            if matcher.output_regex.is_some() && matcher.last_line_regex.is_some() {
                return Err(invalid("pipeline.invalid_regex"));
            }
            if let Some(pat) = matcher
                .output_regex
                .as_ref()
                .or(matcher.last_line_regex.as_ref())
            {
                if pat.len() > 4096 || Regex::new(pat).is_err() {
                    return Err(invalid("pipeline.invalid_regex"));
                }
            }
            if s.r#type == "shell"
                && (matcher.output_regex.is_some() || matcher.last_line_regex.is_some())
                || s.r#type == "agent"
                    && (matcher.exit_code.is_some() || matcher.exit_code_not.is_some())
            {
                return Err(invalid("pipeline.invalid_step"));
            }
        }
        if let Some(c) = &s.capture {
            let re =
                Regex::new(c.verdict.pattern()).map_err(|_| invalid("pipeline.invalid_regex"))?;
            if c.verdict.pattern().len() > 4096
                || re.captures_len() != 2
                || matches!(&c.verdict,VerdictCapture::LastLine(c) if c.group!=1)
            {
                return Err(invalid("pipeline.invalid_regex"));
            }
        }
        if let Some(r) = &s.on_success {
            let review = m
                .steps
                .iter()
                .find(|x| x.id == r.rerun && x.review())
                .ok_or_else(|| invalid("pipeline.invalid_loop"))?;
            if s.r#type != "shell"
                || s.depends_on.len() != 1
                || s.max_runs > p.review.max_fixes_per_plan
            {
                return Err(invalid("pipeline.invalid_loop"));
            }
            let fix = m
                .steps
                .iter()
                .find(|x| x.id == s.depends_on[0])
                .ok_or_else(|| invalid("pipeline.invalid_loop"))?;
            if fix.r#type != "agent"
                || fix.review()
                || fix.depends_on != [review.id.clone()]
                || fix.run_if.is_empty()
                || fix.max_runs != s.max_runs
            {
                return Err(invalid("pipeline.invalid_loop"));
            }
        }
    }
    // Validate and sort-independent cycle detection without recursion on untrusted input.
    let mut done = HashSet::new();
    loop {
        let before = done.len();
        for s in &m.steps {
            if s.depends_on.iter().all(|d| done.contains(d)) {
                done.insert(s.id.clone());
            }
        }
        if done.len() == m.steps.len() {
            break;
        }
        if done.len() == before {
            return Err(invalid("pipeline.invalid_graph"));
        }
    }
    Ok(())
}
impl AgentManager {
    pub fn pipeline_import(&self, path: PathBuf) -> AppResult<PipelineRun> {
        let files = read_package(&path)?;
        let bytes = files
            .get("pipeline.json")
            .ok_or_else(|| invalid("pipeline.invalid_manifest"))?;
        let mut manifest: Manifest =
            serde_json::from_slice(bytes).map_err(|_| invalid("pipeline.invalid_manifest"))?;
        for s in &mut manifest.steps {
            if !s.prompt_file.is_empty() {
                s.prompt = String::from_utf8(
                    files
                        .get(&portable_name(&relative(&s.prompt_file)?))
                        .ok_or_else(|| invalid("pipeline.missing_file"))?
                        .clone(),
                )
                .map_err(|_| invalid("pipeline.invalid_manifest"))?;
            }
        }
        validate_manifest(&manifest)?;
        let id = uuid::Uuid::new_v4().to_string();
        let run_root = self.home.join("pipelines").join(&id);
        let package = run_root.join("package");
        std::fs::create_dir_all(&package)?;
        for (name, bytes) in &files {
            let p = package.join(relative(name)?);
            std::fs::create_dir_all(p.parent().unwrap())?;
            std::fs::write(p, bytes)?;
        }
        let mut issues = vec![];
        let mut repositories = manifest.settings.repositories.clone();
        let root = Path::new(&manifest.settings.agent_working_directory);
        if !root.is_absolute() || !root.is_dir() {
            issues.push(PipelineIssue {
                code: "pipeline.workspace_missing".into(),
                detail: root.display().to_string(),
                blocking: true,
            });
        } else if repositories.is_empty() {
            if root.join(".git").exists() {
                repositories.push(Repository {
                    name: root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    path: root.canonicalize()?.to_string_lossy().into(),
                    branch: String::new(),
                });
            } else {
                for entry in std::fs::read_dir(root)?.take(128) {
                    let path = entry?.path();
                    if path.is_dir() && path.join(".git").exists() {
                        repositories.push(Repository {
                            name: path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into(),
                            path: path.canonicalize()?.to_string_lossy().into(),
                            branch: String::new(),
                        });
                    }
                }
            }
        }
        if repositories.len() > 1 && manifest.settings.repositories.is_empty() {
            issues.push(PipelineIssue {
                code: "pipeline.repositories_explicit".into(),
                detail: String::new(),
                blocking: true,
            });
        }
        for repo in &mut repositories {
            if let Ok(path) = Path::new(&repo.path).canonicalize() {
                repo.path = path.to_string_lossy().into();
                if repo.branch.is_empty() {
                    if let Ok(out) = std::process::Command::new("git")
                        .args(["-C", &repo.path, "branch", "--show-current"])
                        .output()
                    {
                        if out.status.success() {
                            repo.branch = String::from_utf8_lossy(&out.stdout).trim().into();
                        }
                    }
                }
            }
        }
        if repositories.is_empty() || repositories.len() > 16 {
            issues.push(PipelineIssue {
                code: "pipeline.repositories_missing".into(),
                detail: String::new(),
                blocking: true,
            });
        }
        // A package is immutable once captured. References to a second copy must be fixed by its author.
        let absolute=Regex::new(r#"(?m)(?:^|[\s`"'=(:])(/[A-Za-z0-9_./-]+/(?:verify\.sh|state\.sh|review-worktree\.sh|KARARLAR\.md|README\.md))"#).unwrap();
        let mut external = HashSet::new();
        for s in &manifest.steps {
            for capture in absolute.captures_iter(&s.prompt) {
                external.insert(capture[1].to_string());
            }
        }
        for detail in external {
            issues.push(PipelineIssue {
                code: "pipeline.external_assets".into(),
                detail,
                blocking: true,
            });
        }
        if manifest.steps.iter().any(|s| s.review()) {
            issues.push(PipelineIssue {
                code: "pipeline.review_contract".into(),
                detail: String::new(),
                blocking: manifest.steps.iter().filter(|s| s.review()).any(|s| {
                    s.prompt.contains("review-worktree.sh") || s.prompt.contains("state.sh")
                }),
            });
        }
        let steps = manifest
            .steps
            .iter()
            .map(|s| (s.id.clone(), StepState::default()))
            .collect();
        let run = PipelineRun {
            project_id: String::new(),
            id,
            manifest,
            package_root: package.to_string_lossy().into(),
            run_root: run_root.to_string_lossy().into(),
            repositories,
            issues,
            state: "draft".into(),
            revision: 0,
            backend: String::new(),
            reviewer: String::new(),
            created_at: now(),
            updated_at: now(),
            steps,
        };
        self.pipeline_save(&run)?;
        Ok(run)
    }
}
