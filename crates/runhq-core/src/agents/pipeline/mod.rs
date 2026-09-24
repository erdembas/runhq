//! Durable package workflows for explicitly selected local repositories.
//! Separate from isolated change workflows: these runs do not auto-integrate or rewrite branches.
use super::*;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use tokio_util::sync::CancellationToken;
mod types;
pub use types::*;
mod condition;
mod import;
mod runtime;
#[cfg(test)]
mod tests;

fn error(code: &str) -> String {
    format!("pipeline.{code}")
}
fn touch(run: &mut PipelineRun) {
    run.revision += 1;
    run.updated_at = now();
}
fn failed(run: &mut PipelineRun, id: &str, code: &str) {
    if let Some(s) = run.steps.get_mut(id) {
        s.status = "failed".into();
        s.error = Some(code.into());
    }
    run.state = "halted".into();
}
/// Only ready gates are evaluated. A waiting condition is distinct from false.
fn gates(run: &mut PipelineRun) -> AppResult<()> {
    if run.state != "running" && run.state != "awaiting_approval" {
        return Ok(());
    }
    let mut changed = true;
    while changed {
        changed = false;
        for step in run.manifest.steps.clone() {
            if run.steps[&step.id].status != "pending" {
                continue;
            }
            if step
                .depends_on
                .iter()
                .any(|d| run.steps[d].status == "skipped")
            {
                run.steps.get_mut(&step.id).unwrap().status = "skipped".into();
                changed = true;
                continue;
            }
            if !step
                .depends_on
                .iter()
                .all(|d| run.steps[d].status == "completed")
            {
                continue;
            }
            if condition::condition(&step.run_if, &run.steps)? == Some(false) {
                run.steps.get_mut(&step.id).unwrap().status = "skipped".into();
                changed = true;
                continue;
            }
            if condition::condition(&step.run_if, &run.steps)? != Some(true) {
                continue;
            }
            if step.r#type == "human" {
                run.steps.get_mut(&step.id).unwrap().status = "awaiting_approval".into();
                changed = true;
            }
            if step.r#type == "barrier" {
                if let Some(Halt::Expression(e)) = &step.halt_if {
                    if condition::condition(e, &run.steps)? == Some(true) {
                        failed(run, &step.id, &error("review_limit"));
                        return Ok(());
                    }
                }
                let strict = step
                    .require_pass
                    .iter()
                    .all(|id| run.steps[id].verdict.as_deref() == Some("PASS"));
                if !strict {
                    failed(run, &step.id, &error("pass_required"));
                    return Ok(());
                }
                if condition::condition(&step.complete_if, &run.steps)? == Some(true) {
                    let s = run.steps.get_mut(&step.id).unwrap();
                    s.status = "completed".into();
                    s.runs += 1;
                    changed = true;
                }
            }
        }
    }
    if run.steps.values().any(|s| s.status == "awaiting_approval") {
        run.state = "awaiting_approval".into();
    } else if run
        .steps
        .values()
        .all(|s| matches!(s.status.as_str(), "completed" | "skipped"))
    {
        run.state = "completed".into();
    } else {
        run.state = "running".into();
    }
    Ok(())
}
fn begin(run: &mut PipelineRun, id: &str) -> AppResult<String> {
    let s = run
        .steps
        .get_mut(id)
        .ok_or_else(|| invalid("pipeline.invalid_step"))?;
    let step = run.manifest.steps.iter().find(|s| s.id == id).unwrap();
    if s.status != "pending" || s.runs >= step.max_runs + s.extra_runs_approved_at.len() as u32 {
        return Err(invalid("pipeline.review_limit"));
    }
    let attempt = uuid::Uuid::new_v4().to_string();
    s.status = "running".into();
    s.error = None;
    s.verdict = None;
    s.attempts.push(Attempt {
        id: attempt.clone(),
        round: s.runs + 1,
        started_at: now(),
        finished_at: None,
        session_id: None,
        exit_code: None,
        output: String::new(),
        outcome: "running".into(),
        snapshot_root: None,
    });
    Ok(attempt)
}
fn matching_lines(pattern: &str, text: &str) -> AppResult<Vec<String>> {
    let re = regex::Regex::new(&format!("^(?:{pattern})$"))
        .map_err(|_| invalid("pipeline.invalid_regex"))?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|line| re.is_match(line))
        .map(String::from)
        .collect())
}
fn result(step: &Step, text: &str, exit: Option<i32>) -> AppResult<Option<String>> {
    if step.r#type == "shell" {
        let success = step.success.as_ref().and_then(|m| m.exit_code).unwrap_or(0);
        let rejected = match &step.halt_if {
            Some(Halt::Match(m)) => {
                m.exit_code_not.is_some_and(|e| exit != Some(e))
                    || m.exit_code.is_some_and(|e| exit == Some(e))
            }
            _ => false,
        };
        return if exit == Some(success) && !rejected {
            Ok(None)
        } else {
            Err(invalid("pipeline.command_failed"))
        };
    }
    if text
        .lines()
        .map(str::trim)
        .any(|line| matches!(line, "PIPELINE_RESULT: BLOCKED" | "PIPELINE_RESULT: FAILED"))
    {
        return Err(invalid("pipeline.result_rejected"));
    }
    if let Some(Halt::Match(m)) = &step.halt_if {
        if let Some(re) = m.output_regex.as_ref().or(m.last_line_regex.as_ref()) {
            let haystack = if m.last_line_regex.is_some() {
                text.trim_end().lines().last().unwrap_or("")
            } else {
                text
            };
            if !matching_lines(re, haystack)?.is_empty() {
                return Err(invalid("pipeline.result_rejected"));
            }
        }
    }
    // Protocol lines must be unique even when a malformed value fails the declared regex.
    let prefix = if step.review() {
        "REVIEW_VERDICT:"
    } else {
        "PIPELINE_RESULT:"
    };
    let protocol_count = text
        .lines()
        .filter(|l| l.trim().starts_with(prefix))
        .count();
    if protocol_count > 1 {
        return Err(invalid("pipeline.result_rejected"));
    }
    if let Some(capture) = &step.capture {
        let re = regex::Regex::new(&format!("^(?:{})$", capture.verdict.pattern()))
            .map_err(|_| invalid("pipeline.invalid_regex"))?;
        let capture_text = if capture.verdict.last_line() {
            text.trim_end().lines().last().unwrap_or("")
        } else {
            text
        };
        let matches: Vec<_> = capture_text
            .lines()
            .filter_map(|line| re.captures(line.trim()))
            .collect();
        if matches.len() != 1 {
            return Err(invalid("pipeline.result_rejected"));
        }
        let verdict = matches[0]
            .get(1)
            .ok_or_else(|| invalid("pipeline.result_rejected"))?
            .as_str();
        if !["PASS", "CONDITIONAL", "FAIL"].contains(&verdict) {
            return Err(invalid("pipeline.result_rejected"));
        }
        return Ok(Some(verdict.into()));
    }
    let pattern = step
        .success
        .as_ref()
        .and_then(|s| s.output_regex.as_ref().or(s.last_line_regex.as_ref()))
        .ok_or_else(|| invalid("pipeline.result_rejected"))?;
    let haystack = if step
        .success
        .as_ref()
        .is_some_and(|s| s.last_line_regex.is_some())
    {
        text.trim_end().lines().last().unwrap_or("")
    } else {
        text
    };
    if matching_lines(pattern, haystack)?.len() != 1 {
        return Err(invalid("pipeline.result_rejected"));
    }
    Ok(None)
}
fn finish(
    run: &mut PipelineRun,
    id: &str,
    attempt: &str,
    text: String,
    exit: Option<i32>,
    failure: Option<String>,
) -> AppResult<()> {
    let step = run
        .manifest
        .steps
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| invalid("pipeline.invalid_step"))?;
    let s = run.steps.get_mut(id).unwrap();
    if s.status != "running" || s.attempts.last().map(|a| a.id.as_str()) != Some(attempt) {
        return Err(invalid("pipeline.stale_action"));
    }
    let outcome = if let Some(e) = failure {
        Err(invalid(e))
    } else if step.r#type == "agent"
        && run
            .manifest
            .settings
            .result_line
            .as_ref()
            .is_some_and(|line| {
                let pattern = if step.review() {
                    &line.review_steps
                } else {
                    &line.agent_steps
                };
                regex::Regex::new(pattern).map_or(true, |re| {
                    !re.is_match(text.trim_end().lines().last().unwrap_or(""))
                })
            })
    {
        Err(invalid("pipeline.result_rejected"))
    } else {
        result(&step, &text, exit)
    };
    let a = s.attempts.last_mut().unwrap();
    a.output = text.chars().take(128 * 1024).collect();
    a.exit_code = exit;
    a.finished_at = Some(now());
    match outcome {
        Err(e) => {
            a.outcome = "failed".into();
            failed(run, id, &e.to_string());
        }
        Ok(verdict) => {
            a.outcome = verdict.clone().unwrap_or_else(|| "SUCCESS".into());
            s.verdict = verdict;
            s.runs += 1;
            s.status = "completed".into();
            s.error = None;
            if let Some(rerun) = step.on_success {
                let review = &run.steps[&rerun.rerun];
                let definition = run
                    .manifest
                    .steps
                    .iter()
                    .find(|s| s.id == rerun.rerun)
                    .unwrap();
                if review.runs >= definition.max_runs + review.extra_runs_approved_at.len() as u32 {
                    failed(run, id, &error("review_limit"));
                } else {
                    // Re-arm only this loop body, never unrelated successful work. History is retained.
                    for key in [
                        rerun.rerun.clone(),
                        step.id.clone(),
                        step.depends_on[0].clone(),
                    ] {
                        let s = run.steps.get_mut(&key).unwrap();
                        s.status = "pending".into();
                        s.verdict = None;
                        s.error = None;
                    }
                    // The review after a fix must see the fix gate's captured repository revisions.
                    let revisions = run.steps[id].revisions.clone();
                    run.steps.get_mut(&rerun.rerun).unwrap().revisions = revisions;
                }
            }
        }
    }
    touch(run);
    Ok(())
}
/// A human may grant one verification/review after manual corrections, without increasing automatic fixes.
fn authorize_extra_review(r: &mut PipelineRun, id: &str) -> AppResult<()> {
    let requested = r
        .manifest
        .steps
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| invalid("pipeline.invalid_step"))?;
    let review_id = if requested.review()
        && r.steps[id].status == "completed"
        && r.steps[id].verdict.as_deref() != Some("PASS")
    {
        id
    } else if requested.r#type == "barrier"
        && r.steps[id].status == "failed"
        && requested.depends_on.len() == 1
    {
        &requested.depends_on[0]
    } else {
        return Err(invalid("pipeline.invalid_step"));
    };
    let review = r
        .manifest
        .steps
        .iter()
        .find(|s| s.id == review_id && s.review())
        .ok_or_else(|| invalid("pipeline.invalid_step"))?;
    if review.depends_on.len() != 1 || r.steps[&review.id].runs >= 11 {
        return Err(invalid("pipeline.review_limit"));
    }
    let gate = r
        .manifest
        .steps
        .iter()
        .find(|s| s.id == review.depends_on[0] && s.r#type == "shell" && s.on_success.is_none())
        .ok_or_else(|| invalid("pipeline.invalid_step"))?;
    let affected: Vec<_> = r
        .manifest
        .steps
        .iter()
        .filter(|s| s.r#type == "barrier" && r.steps[&s.id].status == "failed")
        .filter(|s| {
            s.require_pass.contains(&review.id)
                || condition::references(&s.complete_if).is_ok_and(|refs| refs.contains(&review.id))
        })
        .map(|s| s.id.clone())
        .collect();
    if affected.is_empty() {
        return Err(invalid("pipeline.invalid_step"));
    }
    for key in [&gate.id, &review.id] {
        let s = r.steps.get_mut(key).unwrap();
        s.extra_runs_approved_at.push(now());
        s.status = "pending".into();
        s.error = None;
        s.verdict = None;
        s.revisions.clear();
    }
    for key in affected {
        let s = r.steps.get_mut(&key).unwrap();
        s.status = "pending".into();
        s.error = None;
        s.approved_at = Some(now());
    }
    if !r.steps.values().any(|s| s.status == "failed") {
        r.state = "running".into();
    }
    Ok(())
}

impl AgentManager {
    pub fn pipelines(&self) -> AppResult<Vec<PipelineRun>> {
        let state = self.state.lock();
        let mut stmt = state
            .db
            .conn
            .prepare("SELECT data FROM agent_pipelines ORDER BY rowid DESC")
            .map_err(|e| AppError::other(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| AppError::other(e.to_string()))?;
        rows.map(|r| {
            Ok(serde_json::from_str(
                &r.map_err(|e| AppError::other(e.to_string()))?,
            )?)
        })
        .collect()
    }
    pub fn pipeline_get(&self, id: &str) -> AppResult<PipelineRun> {
        self.pipeline(id)
    }
    pub fn pipeline_summaries(&self) -> AppResult<Vec<PipelineSummary>> {
        Ok(self
            .pipelines()?
            .into_iter()
            .map(|r| PipelineSummary {
                id: r.id,
                name: r.manifest.name,
                state: r.state,
                revision: r.revision,
                total: r.steps.len(),
                completed: r
                    .steps
                    .values()
                    .filter(|s| matches!(s.status.as_str(), "completed" | "skipped"))
                    .count(),
                issue_count: r.issues.iter().filter(|i| i.blocking).count(),
                attention: r
                    .steps
                    .iter()
                    .filter(|(_, s)| matches!(s.status.as_str(), "failed" | "awaiting_approval"))
                    .map(|(id, s)| format!("{id}:{}", s.error.as_deref().unwrap_or("approval")))
                    .collect::<Vec<_>>()
                    .join(";"),
                project_id: r.project_id,
                notify_human: r.manifest.settings.failure_policy.notify_human,
            })
            .collect())
    }
    fn pipeline(&self, id: &str) -> AppResult<PipelineRun> {
        self.pipelines()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| invalid("pipeline.not_found"))
    }
    fn pipeline_save(&self, run: &PipelineRun) -> AppResult<()> {
        self.state.lock().db.conn.execute("INSERT INTO agent_pipelines(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",rusqlite::params![run.id,serde_json::to_string(run)?]).map_err(|e|AppError::other(e.to_string()))?;
        Ok(())
    }
    pub(super) fn recover_pipelines(&self) -> AppResult<()> {
        for mut r in self.pipelines()? {
            let mut changed = false;
            for s in r.steps.values_mut() {
                if s.status == "running" {
                    s.status = "failed".into();
                    s.error = Some(error("recovered"));
                    if let Some(a) = s.attempts.last_mut() {
                        a.finished_at = Some(now());
                        a.outcome = "interrupted".into();
                    }
                    changed = true;
                }
            }
            if changed || r.state == "running" {
                r.state = "halted".into();
                touch(&mut r);
                self.pipeline_save(&r)?;
            }
        }
        Ok(())
    }
    pub async fn pipeline_control(
        self: &Arc<Self>,
        id: &str,
        revision: u64,
        action: &str,
        step_id: Option<String>,
        backend: String,
        reviewer: String,
    ) -> AppResult<PipelineRun> {
        let _gate = self.workflow_gate.lock().await;
        let mut r = self.pipeline(id)?;
        if r.revision != revision {
            return Err(invalid("pipeline.stale_action"));
        }
        match action {
            "start" => {
                if r.state != "draft" || r.issues.iter().any(|i| i.blocking) {
                    return Err(invalid("pipeline.preflight_failed"));
                }
                self.pipeline_validate_repositories(&r, true).await?;
                self.tool(&backend)?;
                let review_tool = self.tool(&reviewer)?;
                if r.manifest.steps.iter().any(Step::review)
                    && !["codex", "claude"].contains(&review_tool.adapter.as_str())
                {
                    return Err(invalid("pipeline.reviewer_required"));
                }
                let root =
                    PathBuf::from(&r.manifest.settings.agent_working_directory).canonicalize()?;
                let project = self.save_multi_workspace(
                    None,
                    r.manifest.name.clone(),
                    root,
                    AgentWorkspaceScope {
                        instructions: String::new(),
                        section_id: String::new(),
                        members: r
                            .repositories
                            .iter()
                            .map(|repo| AgentWorkspaceMember {
                                service_id: repo.path.clone(),
                                name: repo.name.clone(),
                                path: repo.path.clone(),
                                base_revision: None,
                                pre_existing_paths: vec![],
                            })
                            .collect(),
                    },
                )?;
                r.project_id = project.id;
                r.backend = backend;
                r.reviewer = reviewer;
                r.state = "running".into();
            }
            "approve" => {
                let id = step_id
                    .as_ref()
                    .ok_or_else(|| invalid("pipeline.invalid_step"))?;
                let s = r
                    .steps
                    .get_mut(id)
                    .ok_or_else(|| invalid("pipeline.invalid_step"))?;
                if s.status != "awaiting_approval" || r.state != "awaiting_approval" {
                    return Err(invalid("pipeline.stale_action"));
                }
                s.status = "completed".into();
                s.approved_at = Some(now());
                s.runs = 1;
                r.state = "running".into();
            }
            "pause" => {
                if r.state != "running" {
                    return Err(invalid("pipeline.stale_action"));
                }
                r.state = "paused".into();
            }
            "resume" => {
                if !["paused", "halted"].contains(&r.state.as_str())
                    || r.steps.values().any(|s| s.status == "failed")
                {
                    return Err(invalid("pipeline.retry_required"));
                }
                r.state = "running".into();
            }
            "extra_review" => {
                let id = step_id
                    .as_ref()
                    .ok_or_else(|| invalid("pipeline.invalid_step"))?;
                if r.state != "halted" || r.steps.values().any(|s| s.status == "running") {
                    return Err(invalid("pipeline.wait_running"));
                }
                self.pipeline_validate_repositories(&r, true).await?;
                authorize_extra_review(&mut r, id)?;
            }
            "retry" => {
                let id = step_id
                    .as_ref()
                    .ok_or_else(|| invalid("pipeline.invalid_step"))?;
                if r.steps.values().any(|s| s.status == "running") {
                    return Err(invalid("pipeline.wait_running"));
                }
                let s = r
                    .steps
                    .get_mut(id)
                    .ok_or_else(|| invalid("pipeline.invalid_step"))?;
                if s.status != "failed" {
                    return Err(invalid("pipeline.stale_action"));
                }
                s.status = "pending".into();
                s.error = None;
                if !r.steps.values().any(|s| s.status == "failed") {
                    r.state = "running".into();
                }
            }
            _ => return Err(invalid("pipeline.invalid_action")),
        }
        gates(&mut r)?;
        touch(&mut r);
        self.pipeline_save(&r)?;
        self.pipeline_scheduler(id);
        Ok(r)
    }
    fn pipeline_scheduler(self: &Arc<Self>, id: &str) {
        if !self.pipeline_schedulers.lock().insert(id.into()) {
            return;
        }
        let manager = Arc::clone(self);
        let id = id.to_string();
        tokio::spawn(async move {
            loop {
                let continuing = manager.pipeline_tick(&id).await;
                if !matches!(continuing, Ok(true)) {
                    // Retire under the same gate as controls; a resume cannot lose its wake-up.
                    let _guard = manager.workflow_gate.lock().await;
                    let mut keep_running = false;
                    if let Ok(mut r) = manager.pipeline(&id) {
                        if let Err(e) = continuing {
                            r.state = "halted".into();
                            if !r.issues.iter().any(|i| {
                                i.code == "pipeline.runtime_error" && i.detail == e.to_string()
                            }) {
                                r.issues.push(PipelineIssue {
                                    code: "pipeline.runtime_error".into(),
                                    detail: e.to_string(),
                                    blocking: false,
                                });
                            }
                            touch(&mut r);
                            let _ = manager.pipeline_save(&r);
                        }
                        keep_running =
                            r.state == "running" || r.steps.values().any(|s| s.status == "running");
                    }
                    if !keep_running {
                        manager.pipeline_schedulers.lock().remove(&id);
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
    }
}
