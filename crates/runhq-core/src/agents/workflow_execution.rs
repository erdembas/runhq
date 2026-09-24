//! Persisted execution policies. Conditions read recorded results, never executable expressions.
use super::*;
use regex::Regex;
use std::path::Component;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct WorkflowExecution {
    pub command: String,
    pub working_directory: String,
    pub lock: String,
    /// Zero disables the deadline. Limits are minutes, capped at seven days.
    pub timeout_minutes: u32,
    pub idle_timeout_minutes: u32,
    pub max_retries: u32,
    pub retry_delay_seconds: u32,
    pub max_fix_attempts: u32,
    /// Re-run these checks after each correction, before the next independent review.
    pub fix_commands: Vec<String>,
    pub fix_prompt: String,
    /// none, json, pipeline, review. Only the final nonempty response line is interpreted.
    pub result_format: String,
    pub success_regex: String,
    pub failure_regex: String,
    /// pause stops admission; cancel also interrupts siblings. Both require manual recovery.
    pub on_failure: String,
    pub run_if: Option<WorkflowCondition>,
}
impl Default for WorkflowExecution {
    fn default() -> Self {
        Self {
            command: String::new(),
            working_directory: String::new(),
            lock: String::new(),
            timeout_minutes: 0,
            idle_timeout_minutes: 0,
            max_retries: 0,
            retry_delay_seconds: 30,
            max_fix_attempts: 1,
            fix_commands: vec![],
            fix_prompt: String::new(),
            result_format: "none".into(),
            success_regex: String::new(),
            failure_regex: String::new(),
            on_failure: "pause".into(),
            run_if: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WorkflowCondition {
    pub step_id: String,
    pub outcomes: Vec<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkflowStepResult {
    pub outcome: Option<String>,
    pub output: String,
    pub exit_code: Option<i32>,
    pub attempts: Vec<WorkflowAttempt>,
    pub retries: u32,
    pub retry_at: Option<i64>,
    pub forced_error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAttempt {
    pub started_at: i64,
    pub finished_at: i64,
    pub outcome: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub error: Option<String>,
}

pub(crate) fn validate_execution(step: &CreateWorkflowStep) -> AppResult<()> {
    let p = &step.execution;
    if p.timeout_minutes > 10080
        || p.idle_timeout_minutes > 10080
        || p.max_retries > 10
        || p.max_fix_attempts > 10
        || p.retry_delay_seconds > 86400
        || p.lock.len() > 128
        || p.command.len() > 128 * 1024
        || p.fix_prompt.len() > MAX_STEP_PROMPT
        || !matches!(p.on_failure.as_str(), "pause" | "cancel")
        || !matches!(
            p.result_format.as_str(),
            "none" | "json" | "pipeline" | "review"
        )
    {
        return Err(invalid("workflow.invalid_execution"));
    }
    validate_relative_directory(&p.working_directory)?;
    validate_commands(&p.fix_commands, false)?;
    for pattern in [&p.success_regex, &p.failure_regex] {
        if pattern.len() > 4096 || (!pattern.is_empty() && Regex::new(pattern).is_err()) {
            return Err(invalid("workflow.invalid_regex"));
        }
    }
    if let Some(c) = &p.run_if {
        if c.outcomes.is_empty()
            || c.outcomes
                .iter()
                .any(|s| !matches!(s.as_str(), "pass" | "findings" | "skipped"))
        {
            return Err(invalid("workflow.invalid_condition"));
        }
        // The final integrating review must never be skipped.
        if !workflow_role_produces(&step.role) {
            return Err(invalid("workflow.conditional_review"));
        }
    }
    if step.role == "shell"
        && (p.command.trim().is_empty() || step.workspace == "own" || step.continue_from.is_some())
    {
        return Err(invalid("workflow.invalid_shell"));
    }
    if step.role != "shell" && !p.command.is_empty() {
        return Err(invalid("workflow.invalid_shell"));
    }
    Ok(())
}
fn validate_relative_directory(directory: &str) -> AppResult<()> {
    if directory.contains('\\')
        || Path::new(directory)
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(invalid("workflow.invalid_directory"));
    }
    Ok(())
}
pub(crate) fn execution_directory(base: &str, directory: &str) -> AppResult<PathBuf> {
    validate_relative_directory(directory)?;
    let root = Path::new(base).canonicalize()?;
    let target = root.join(directory).canonicalize()?;
    if !target.starts_with(&root) || !target.is_dir() {
        return Err(invalid("workflow.invalid_directory"));
    }
    Ok(target)
}
pub(crate) fn execution_instruction(p: &WorkflowExecution) -> String {
    match p.result_format.as_str() {
        "json" => "\nEnd with exactly one final line: RUNHQ_STEP_RESULT: {\"outcome\":\"pass\"}. Allowed outcomes: pass, findings, blocked, failed. Report honestly; do not claim pass if blocked.\n",
        "pipeline" => "\nEnd with exactly one final line: PIPELINE_RESULT: SUCCESS, PARTIAL, BLOCKED, or FAILED, choosing the actual result.\n",
        "review" => "\nEnd with exactly one final line: REVIEW_VERDICT: PASS, CONDITIONAL, or FAIL, choosing the actual verdict.\n",
        _ => "",
    }.into()
}
/// Failure patterns take precedence. Missing/malformed/conflicting protocol lines fail closed.
pub(crate) fn execution_outcome(p: &WorkflowExecution, output: &str) -> String {
    let last = output
        .lines()
        .rev()
        .find(|s| !s.trim().is_empty())
        .unwrap_or("")
        .trim();
    if !p.failure_regex.is_empty() && Regex::new(&p.failure_regex).is_ok_and(|r| r.is_match(last)) {
        return "failed".into();
    }
    if !p.success_regex.is_empty() && !Regex::new(&p.success_regex).is_ok_and(|r| r.is_match(last))
    {
        return "blocked".into();
    }
    let prefix = match p.result_format.as_str() {
        "json" => "RUNHQ_STEP_RESULT:",
        "pipeline" => "PIPELINE_RESULT:",
        "review" => "REVIEW_VERDICT:",
        _ => return "pass".into(),
    };
    if output
        .lines()
        .filter(|s| s.trim().starts_with(prefix))
        .count()
        != 1
    {
        return "blocked".into();
    }
    let Some(value) = last.strip_prefix(prefix).map(str::trim) else {
        return "blocked".into();
    };
    match p.result_format.as_str() {
        "json" => serde_json::from_str::<Value>(value)
            .ok()
            .and_then(|v| {
                v["outcome"]
                    .as_str()
                    .filter(|o| matches!(*o, "pass" | "findings" | "blocked" | "failed"))
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "blocked".into()),
        "pipeline" => match value {
            "SUCCESS" => "pass",
            "PARTIAL" => "findings",
            "FAILED" => "failed",
            _ => "blocked",
        }
        .into(),
        "review" => match value {
            "PASS" => "pass",
            "CONDITIONAL" | "FAIL" => "findings",
            _ => "blocked",
        }
        .into(),
        _ => "blocked".into(),
    }
}
impl AgentManager {
    pub(crate) fn workflow_finish_execution(
        &self,
        step: &mut WorkflowStep,
        completed: bool,
        shell: Option<(Option<i32>, String)>,
    ) {
        let (exit, text) = shell.unwrap_or_else(|| {
            let text = step
                .session_id
                .as_ref()
                .and_then(|id| self.snapshot(id, None).ok())
                .and_then(|s| {
                    s.items.into_iter().rev().find(|i| {
                        i.kind == "assistant" && i.created_at >= step.started_at.unwrap_or(0)
                    })
                })
                .map(|i| i.text)
                .unwrap_or_default();
            (None, text)
        });
        let outcome = if step.result.forced_error.is_some() || !completed {
            "failed".into()
        } else {
            execution_outcome(&step.execution, &text)
        };
        step.status = match outcome.as_str() {
            "blocked" => "blocked",
            "failed" => "failed",
            _ => "completed",
        }
        .into();
        if let Some(error) = &step.result.forced_error {
            step.error = Some(error.clone());
        } else if matches!(outcome.as_str(), "blocked" | "failed") && step.error.is_none() {
            step.error = Some("workflow.result_rejected".into());
        }
        step.result.outcome = Some(outcome.clone());
        step.result.output = text.chars().take(OUTPUT_LIMIT).collect();
        step.result.exit_code = exit;
        step.result.attempts.push(WorkflowAttempt {
            started_at: step.started_at.unwrap_or(now()),
            finished_at: now(),
            outcome,
            exit_code: exit,
            output: step.result.output.clone(),
            error: step.error.clone(),
        });
    }
    pub(crate) fn workflow_retry_failures(&self, w: &mut AgentWorkflow) {
        for step in &mut w.steps {
            if step.status == "failed"
                && step.result.retries < step.execution.max_retries
                && !step.result.attempts.is_empty()
                && !matches!(
                    step.result.forced_error.as_deref(),
                    Some("workflow.recovered" | "workflow.cancelled")
                )
                && step.error.as_deref() != Some("workflow.cancelled")
                && !matches!(w.stage.as_str(), "cancelled" | "interrupted")
            {
                step.result.retries += 1;
                step.result.retry_at =
                    Some(now() + i64::from(step.execution.retry_delay_seconds) * 1000);
                step.status = "pending".into();
            }
        }
    }
    pub(crate) async fn workflow_halt_siblings(&self, w: &AgentWorkflow) {
        if !w.steps.iter().any(|s| {
            matches!(s.status.as_str(), "failed" | "blocked") && s.execution.on_failure == "cancel"
        }) {
            return;
        }
        for step in w.steps.iter().filter(|s| s.status == "running") {
            if let Some(token) = self
                .workflow_cancellations
                .lock()
                .get(&format!("{}:{}", w.id, step.id))
            {
                token.cancel();
            }
            if let Some(id) = &step.session_id {
                if self
                    .session(id)
                    .is_ok_and(|s| s.active() && s.status != "cancelling")
                {
                    let _ = self.interrupt(id).await;
                }
            }
        }
    }
    pub(crate) fn workflow_resource_busy(&self, w: &AgentWorkflow, step: &WorkflowStep) -> bool {
        if step.execution.lock.is_empty() {
            return false;
        }
        // workflow_gate serializes all admission, so a persisted running row is the reservation.
        self.workflow_rows().map_or(true, |rows| {
            rows.iter().any(|row| {
                row.steps.iter().any(|other| {
                    !(row.id == w.id && other.id == step.id)
                        && other.status == "running"
                        && other.execution.lock == step.execution.lock
                })
            })
        })
    }
    pub(crate) async fn workflow_start_execution(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        if self.workflow_resource_busy(w, &step) {
            return Err(invalid("workflow.resource_busy"));
        }
        if let Some(condition) = &step.execution.run_if {
            let previous = w
                .step(&condition.step_id)
                .ok_or_else(|| invalid("workflow.invalid_condition"))?;
            let outcome = previous.result.outcome.as_deref().unwrap_or(
                if previous.review_outcome.as_deref() == Some("findings") {
                    "findings"
                } else {
                    "pass"
                },
            );
            if !condition.outcomes.iter().any(|o| o == outcome) {
                let current = w.steps.iter_mut().find(|s| s.id == step.id).unwrap();
                current.status = "completed".into();
                current.started_at = Some(now());
                current.finished_at = Some(now());
                current.result.outcome = Some("skipped".into());
                w.stage = w.steps_stage();
                self.save_workflow(w)?;
                return Ok(w.clone());
            }
        }
        if step.role == "shell" {
            self.workflow_start_shell(w, step).await
        } else if workflow_role_produces(&step.role) {
            self.workflow_start_producing(w, step).await
        } else {
            self.workflow_start_reviewing(w, step).await
        }
    }
    pub(crate) fn workflow_monitor(self: &Arc<Self>, w: &AgentWorkflow, id: &str) {
        let Some(step) = w.step(id) else {
            return;
        };
        if step.status != "running"
            || step.execution.timeout_minutes == 0 && step.execution.idle_timeout_minutes == 0
        {
            return;
        }
        let (wid, sid, started) = (w.id.clone(), id.to_string(), step.started_at);
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut idle_since = now();
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let session_to_stop = {
                    let _gate = manager.workflow_gate.lock().await;
                    let Ok(mut w) = manager.workflow(&wid) else {
                        return;
                    };
                    let Some(step) = w.steps.iter_mut().find(|s| s.id == sid) else {
                        return;
                    };
                    if step.status != "running" || step.started_at != started {
                        return;
                    }
                    let Some(session) = step
                        .session_id
                        .as_ref()
                        .and_then(|id| manager.session(id).ok())
                    else {
                        return;
                    };
                    if !session.active() {
                        manager.workflow_notify();
                        return;
                    }
                    if matches!(
                        session.status.as_str(),
                        "waiting_input" | "waiting_permission"
                    ) || matches!(session.pause_state.as_deref(), Some("paused" | "pausing"))
                    {
                        idle_since = now();
                    } else {
                        idle_since = idle_since.max(session.updated_at);
                    }
                    let p = &step.execution;
                    let error = if p.timeout_minutes > 0
                        && now() - started.unwrap_or(now()) >= i64::from(p.timeout_minutes) * 60000
                    {
                        Some("workflow.timed_out")
                    } else if p.idle_timeout_minutes > 0
                        && now() - idle_since >= i64::from(p.idle_timeout_minutes) * 60000
                    {
                        Some("workflow.stalled")
                    } else {
                        None
                    };
                    if let Some(error) = error {
                        step.result.forced_error = Some(error.into());
                        let id = session.id;
                        if manager.save_workflow(&mut w).is_err() {
                            return;
                        }
                        Some(id)
                    } else {
                        None
                    }
                };
                if let Some(id) = session_to_stop {
                    let _ = manager.interrupt(&id).await;
                    manager.workflow_notify();
                    return;
                }
            }
        });
    }
    async fn workflow_start_shell(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        let cwd = execution_directory(&w.cwd, &step.execution.working_directory)?;
        let root = Path::new(&w.root).canonicalize()?;
        // Reserve synchronously before spawning. Ordinary agents also respect this lease.
        let mut lease = self.workflow_lease(&root)?;
        let key = std::mem::take(&mut lease.key);
        drop(lease);
        let cancellation = CancellationToken::new();
        let cancel_key = format!("{}:{}", w.id, step.id);
        self.workflow_cancellations
            .lock()
            .insert(cancel_key.clone(), cancellation.clone());
        let guard = ShellReservation {
            manager: Arc::clone(self),
            key,
            cancel_key,
        };
        let current = w.steps.iter_mut().find(|s| s.id == step.id).unwrap();
        current.session_id = None;
        current.status = "running".into();
        current.started_at = Some(now());
        current.finished_at = None;
        current.error = None;
        current.result.forced_error = None;
        current.result.retry_at = None;
        current.result.outcome = None;
        current.generation = w.generation;
        let started = current.started_at;
        let generation = w.generation;
        w.review_fingerprint = None;
        w.checks.clear();
        w.preview = None;
        w.stage = "implementing".into();
        self.save_workflow(w)?;
        let wid = w.id.clone();
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let result = run_workflow_command_controlled(
                &cwd.to_string_lossy(),
                &step.execution.command,
                cancellation,
                step.execution.timeout_minutes,
                step.execution.idle_timeout_minutes,
            )
            .await;
            let _gate = manager.workflow_gate.lock().await;
            drop(guard);
            let Ok(mut w) = manager.workflow(&wid) else {
                return;
            };
            if w.generation != generation {
                return;
            }
            let Some(current) = w
                .steps
                .iter_mut()
                .find(|s| s.id == step.id && s.status == "running" && s.started_at == started)
            else {
                return;
            };
            current.finished_at = Some(now());
            match result {
                Ok((exit, output, status)) => {
                    if status != "passed" {
                        current.error = Some(
                            match status.as_str() {
                                "timed_out" => "workflow.timed_out",
                                "stalled" => "workflow.stalled",
                                "cancelled" => "workflow.cancelled",
                                _ => "workflow.command_failed",
                            }
                            .into(),
                        );
                    }
                    manager.workflow_finish_execution(
                        current,
                        status == "passed",
                        Some((exit, output)),
                    );
                }
                Err(error) => {
                    current.error = Some(error.to_string());
                    manager.workflow_finish_execution(current, false, Some((None, String::new())));
                }
            }
            manager.workflow_retry_failures(&mut w);
            w.current_fingerprint = manager.workflow_fingerprint(Path::new(&w.root)).await.ok();
            w.stage = w.steps_stage();
            let _ = manager.save_workflow(&mut w);
            manager.workflow_halt_siblings(&w).await;
            manager.workflow_notify();
        });
        Ok(w.clone())
    }
}
struct ShellReservation {
    manager: Arc<AgentManager>,
    key: String,
    cancel_key: String,
}
impl Drop for ShellReservation {
    fn drop(&mut self) {
        self.manager.state.lock().workflow_leases.remove(&self.key);
        self.manager
            .workflow_cancellations
            .lock()
            .remove(&self.cancel_key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn final_protocol_is_strict_and_failure_wins() {
        let mut p = WorkflowExecution {
            result_format: "pipeline".into(),
            ..Default::default()
        };
        assert_eq!(
            execution_outcome(&p, "Work done\nPIPELINE_RESULT: SUCCESS\n"),
            "pass"
        );
        assert_eq!(
            execution_outcome(&p, "PIPELINE_RESULT: PARTIAL"),
            "findings"
        );
        assert_eq!(
            execution_outcome(&p, "PIPELINE_RESULT: SUCCESS\nStill working"),
            "blocked"
        );
        assert_eq!(
            execution_outcome(&p, "PIPELINE_RESULT: BLOCKED\nPIPELINE_RESULT: SUCCESS"),
            "blocked"
        );
        p.failure_regex = "SUCCESS".into();
        assert_eq!(execution_outcome(&p, "PIPELINE_RESULT: SUCCESS"), "failed");
        p = WorkflowExecution {
            result_format: "json".into(),
            ..Default::default()
        };
        assert_eq!(
            execution_outcome(&p, "RUNHQ_STEP_RESULT: {\"outcome\":\"pass\"}"),
            "pass"
        );
        assert_eq!(
            execution_outcome(&p, "RUNHQ_STEP_RESULT: {\"outcome\":\"success\"}"),
            "blocked"
        );
        p.result_format = "review".into();
        assert_eq!(
            execution_outcome(&p, "REVIEW_VERDICT: CONDITIONAL"),
            "findings"
        );
        assert_eq!(execution_outcome(&p, "REVIEW_VERDICT: PASS"), "pass");
    }
    #[test]
    fn subfolder_cannot_escape_checkout_even_through_a_symlink() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("backend")).unwrap();
        assert!(execution_directory(root.to_str().unwrap(), "backend").is_ok());
        assert!(execution_directory(root.to_str().unwrap(), "../").is_err());
        assert!(execution_directory(root.to_str().unwrap(), "/tmp").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(temp.path(), root.join("outside")).unwrap();
            assert!(execution_directory(root.to_str().unwrap(), "outside").is_err());
        }
    }
    #[test]
    fn policies_roundtrip_and_reject_invalid_limits() {
        let defaults: WorkflowExecution = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults.max_fix_attempts, 1);
        assert_eq!(defaults.timeout_minutes, 0);
        let mut step = CreateWorkflowStep {
            role: "implement".into(),
            ..Default::default()
        };
        step.execution.timeout_minutes = 240;
        step.execution.max_fix_attempts = 3;
        validate_execution(&step).unwrap();
        step.execution.success_regex = "(?<=bad)".into();
        assert!(validate_execution(&step).is_err());
        assert!(serde_json::from_str::<WorkflowExecution>("{\"unknownLimit\":3}").is_err());
    }
}
