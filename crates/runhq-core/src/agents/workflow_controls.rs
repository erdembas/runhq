//! Editing future work and resolving reviews without interrupting an active provider turn.
use super::*;

#[derive(Debug, Deserialize)]
pub struct UpdateWorkflowSteps {
    pub revision: u64,
    pub steps: Vec<CreateWorkflowStep>,
}

impl WorkflowStep {
    pub(crate) fn declaration(&self) -> CreateWorkflowStep {
        CreateWorkflowStep {
            id: Some(self.id.clone()),
            role: self.role.clone(),
            target: self.target.clone(),
            model: self.model.clone(),
            effort: self.effort.clone(),
            mode: self.mode.clone(),
            prompt: self.prompt.clone(),
            depends_on: Some(self.depends_on.clone()),
            workspace: self.workspace.clone(),
            continue_from: self.continue_from.clone(),
            review_policy: self.review_policy.clone(),
            execution: self.execution.clone(),
        }
    }

    pub(crate) fn review_needs_decision(&self) -> bool {
        self.status == "completed"
            && !workflow_role_produces(&self.role)
            && !matches!(self.review_policy.as_str(), "" | "continue")
            && self.review_decision.is_none()
            && (self.review_policy == "approval"
                || self.review_outcome.as_deref() != Some("passed"))
    }
}

impl AgentWorkflow {
    pub(crate) fn awaiting_review(&self) -> bool {
        self.steps.iter().any(WorkflowStep::review_needs_decision)
    }
}

/// Only an explicit final verdict counts. Missing, conflicting or malformed verdicts ask the user.
pub(super) fn review_verdict(text: &str) -> (String, String) {
    let lines: Vec<&str> = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix("RUNHQ_REVIEW_RESULT:"))
        .collect();
    if lines.len() == 1
        && text
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .is_some_and(|line| line.trim().starts_with("RUNHQ_REVIEW_RESULT:"))
    {
        if let Ok(value) = serde_json::from_str::<Value>(lines[0].trim()) {
            if let (Some(verdict), Some(summary)) =
                (value["verdict"].as_str(), value["summary"].as_str())
            {
                if matches!(verdict, "pass" | "findings") && !summary.trim().is_empty() {
                    return (
                        if verdict == "pass" {
                            "passed"
                        } else {
                            "findings"
                        }
                        .into(),
                        summary.chars().take(2000).collect(),
                    );
                }
            }
        }
    }
    (
        "unknown".into(),
        "The reviewer did not return a clear verdict. Read the review before continuing.".into(),
    )
}

impl AgentManager {
    fn workflow_control_scheduler(self: &Arc<Self>, w: &AgentWorkflow) {
        self.workflow_notify();
        if (w.auto_progress && w.steps.iter().any(|step| step.started_at.is_some()))
            || w.launch_pending
        {
            let manager = Arc::clone(self);
            let id = w.id.clone();
            let generation = w.generation;
            tokio::spawn(async move {
                manager.workflow_scheduler_loop(id, generation).await;
            });
        }
    }

    /// Pause admission, not the running turn. The pause survives closing the editor or application.
    pub async fn workflow_edit(
        self: &Arc<Self>,
        id: &str,
        editing: bool,
    ) -> AppResult<AgentWorkflow> {
        let w = {
            let _gate = self.workflow_gate.lock().await;
            let mut w = self.workflow(id)?;
            self.reconcile_workflow(&mut w).await?;
            if w.cleaned
                || matches!(
                    w.stage.as_str(),
                    "setting_up" | "checking" | "integrating" | "integrated"
                )
            {
                return Err(invalid(
                    "Wait for the current operation to finish before editing the queue",
                ));
            }
            w.editing = editing;
            // A second editor invalidates the first editor's save, even when no step changed yet.
            w.edit_revision += 1;
            self.save_workflow(&mut w)?;
            w
        };
        self.workflow_control_scheduler(&w);
        Ok(w)
    }

    pub async fn workflow_update_steps(
        self: &Arc<Self>,
        id: &str,
        input: UpdateWorkflowSteps,
    ) -> AppResult<AgentWorkflow> {
        let w = {
            let _gate = self.workflow_gate.lock().await;
            let mut w = self.workflow(id)?;
            self.reconcile_workflow(&mut w).await?;
            if !w.editing || w.edit_revision != input.revision || w.cleaned {
                return Err(invalid("The queue changed since this editor opened. Reopen it to use the latest steps."));
            }
            if input.steps.is_empty() || input.steps.len() > MAX_WORKFLOW_STEPS {
                return Err(invalid("A workflow needs between 1 and 512 steps"));
            }
            validate_declared_graph(&input.steps)?;
            let mut next = workflow_declared_graph(
                &input.steps,
                &w.implementation_session_id,
                &w.base_revision,
            );
            for old in &w.steps {
                let candidate = next.iter_mut().find(|step| step.id == old.id);
                let locked = old.started_at.is_some() || old.status != "pending";
                if locked
                    && candidate
                        .as_ref()
                        .map_or(true, |step| step.declaration() != old.declaration())
                {
                    return Err(invalid(format!("Step {:?} has already started. Only waiting steps can be changed or removed.", old.id)));
                }
                if let Some(candidate) = candidate {
                    if locked {
                        *candidate = old.clone();
                    } else {
                        // Preserve the initial session only if its routing still matches. A new
                        // account gets its own session when admitted, never the previous account's.
                        candidate.session_id = if candidate.target == old.target {
                            old.session_id.clone()
                        } else {
                            None
                        };
                    }
                }
            }
            for step in next.iter_mut().filter(|step| step.started_at.is_none()) {
                if step.prompt.trim().is_empty() && w.objective.trim().is_empty() {
                    return Err(invalid("Give every new step an instruction"));
                }
                if !workflow_role_produces(&step.role)
                    && !step.target.starts_with("pool:")
                    && !matches!(
                        self.tool(&step.target)?.adapter.as_str(),
                        "codex" | "claude"
                    )
                {
                    return Err(invalid(
                        "Independent review requires a supported read-only agent",
                    ));
                }
                // New rows must not acquire the initial session merely by moving into position 0.
                if !w.steps.iter().any(|old| old.id == step.id) {
                    step.session_id = None;
                }
            }
            w.steps = next;
            w.editing = false;
            w.edit_revision += 1;
            w.preview = None;
            w.checks.clear();
            if workflow_step_stage(&w.stage)
                || matches!(w.stage.as_str(), "ready" | "checks_failed")
            {
                w.stage = w.steps_stage();
            }
            self.save_workflow(&mut w)?;
            w
        };
        self.workflow_control_scheduler(&w);
        Ok(w)
    }

    pub(super) fn workflow_set_review_result(&self, step: &mut WorkflowStep) {
        if matches!(step.review_policy.as_str(), "" | "continue") {
            return;
        }
        let text = step
            .session_id
            .as_ref()
            .and_then(|id| self.snapshot(id, None).ok())
            .and_then(|snapshot| {
                snapshot.items.into_iter().rev().find(|item| {
                    item.kind == "assistant" && item.created_at >= step.started_at.unwrap_or(0)
                })
            })
            .map(|item| item.text)
            .unwrap_or_default();
        let (outcome, summary) = if step.execution.result_format != "none" {
            match execution_outcome(&step.execution, &text).as_str() {
                "pass" => ("passed".into(), text.clone()),
                "findings" => ("findings".into(), text.clone()),
                _ => ("unknown".into(), "workflow.result_rejected".into()),
            }
        } else {
            review_verdict(&text)
        };
        step.result.outcome = Some(
            match outcome.as_str() {
                "passed" => "pass",
                "findings" => "findings",
                _ => "blocked",
            }
            .into(),
        );
        if let Some(attempt) = step.result.attempts.last_mut() {
            attempt.outcome = step.result.outcome.clone().unwrap();
        }
        step.review_outcome = Some(outcome);
        step.review_summary = Some(summary);
        step.review_decision = None;
    }

    /// Insert a bounded correction and fresh independent review. Dependents wait for both.
    pub(super) fn workflow_insert_review_fix(
        &self,
        w: &mut AgentWorkflow,
        id: &str,
    ) -> AppResult<()> {
        let review = w.step(id).ok_or_else(|| invalid("Unknown review"))?;
        let verification: Vec<WorkflowExecution> = if review.execution.fix_commands.is_empty() {
            review
                .depends_on
                .iter()
                .filter_map(|id| w.step(id))
                .filter(|s| s.role == "shell")
                .map(|s| {
                    let mut p = s.execution.clone();
                    p.run_if = None;
                    p
                })
                .collect()
        } else {
            review
                .execution
                .fix_commands
                .iter()
                .map(|command| WorkflowExecution {
                    command: command.clone(),
                    timeout_minutes: review.execution.timeout_minutes,
                    working_directory: review.execution.working_directory.clone(),
                    lock: review.execution.lock.clone(),
                    ..WorkflowExecution::default()
                })
                .collect()
        };
        if w.steps.len() + 2 + verification.len() > MAX_WORKFLOW_STEPS {
            return Err(invalid(
                "No room for a correction and review; edit the queue first",
            ));
        }
        let index = w
            .steps
            .iter()
            .position(|step| step.id == id)
            .ok_or_else(|| invalid("Unknown review"))?;
        let review = w.steps[index].clone();
        let ancestors = w.ancestors(id);
        let producer = w
            .steps
            .iter()
            .rev()
            .find(|step| {
                ancestors.contains(&step.id)
                    && workflow_role_produces(&step.role)
                    && step.role != "shell"
            })
            .ok_or_else(|| invalid("This review has no preceding work to correct"))?
            .clone();
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let fix_id = format!("fix-{}", &suffix[..10]);
        let check_id = format!("review-{}", &suffix[..10]);
        let mut fix = WorkflowStep {
            id: fix_id.clone(), role: "revise".into(), target: producer.target,
            model: producer.model, effort: producer.effort, workspace: "shared".into(),
            prompt: format!("Address the findings from review {id}. Change only what is needed to resolve them, then summarize what you fixed.\n\n{}", review.review_summary.as_deref().unwrap_or("Read the preceding review.")),
            depends_on: vec![id.into()], input_step_id: Some(id.into()),
            execution: producer.execution.clone(),
            ..WorkflowStep::migrated()
        };
        if !review.execution.fix_prompt.trim().is_empty() {
            fix.prompt = format!(
                "{}\n\nReview findings:\n{}",
                review.execution.fix_prompt,
                review
                    .review_summary
                    .as_deref()
                    .unwrap_or("Read the preceding review.")
            );
        }
        fix.execution.run_if = None;
        let mut inserted = vec![fix];
        let mut previous = fix_id.clone();
        for (at, execution) in verification.into_iter().enumerate() {
            let gate_id = format!("gate-{}-{at}", &suffix[..10]);
            inserted.push(WorkflowStep {
                id: gate_id.clone(),
                role: "shell".into(),
                target: review.target.clone(),
                prompt: execution.command.clone(),
                depends_on: vec![previous.clone()],
                input_step_id: Some(previous),
                workspace: "shared".into(),
                execution,
                ..WorkflowStep::migrated()
            });
            previous = gate_id;
        }
        let check = WorkflowStep {
            id: check_id.clone(),
            role: review.role.clone(),
            target: review.target.clone(),
            model: review.model.clone(),
            effort: review.effort.clone(),
            workspace: "shared".into(),
            prompt: format!(
                "Review the corrected work again, including the previous findings.\n\n{}",
                review.prompt
            ),
            depends_on: vec![previous.clone()],
            input_step_id: Some(previous),
            review_policy: review.review_policy.clone(),
            review_fix_attempts: review.review_fix_attempts + 1,
            execution: review.execution.clone(),
            ..WorkflowStep::migrated()
        };
        for step in &mut w.steps {
            for dependency in &mut step.depends_on {
                if dependency == id {
                    *dependency = check_id.clone();
                }
            }
            if let Some(condition) = &mut step.execution.run_if {
                if condition.step_id == id {
                    condition.step_id = check_id.clone();
                }
            }
            step.input_step_id = step.depends_on.first().cloned();
        }
        w.steps[index].review_decision = Some("fix_requested".into());
        inserted.push(check);
        w.steps.splice(index + 1..index + 1, inserted);
        validate_declared_graph(
            &w.steps
                .iter()
                .map(WorkflowStep::declaration)
                .collect::<Vec<_>>(),
        )?;
        w.edit_revision += 1;
        w.preview = None;
        w.checks.clear();
        w.stage = w.steps_stage();
        Ok(())
    }

    pub async fn workflow_review_decision(
        self: &Arc<Self>,
        id: &str,
        step_id: &str,
        finished_at: i64,
        decision: &str,
    ) -> AppResult<AgentWorkflow> {
        let w = {
            let _gate = self.workflow_gate.lock().await;
            let mut w = self.workflow(id)?;
            self.reconcile_workflow(&mut w).await?;
            if w.editing || w.cleaned || w.steps.iter().any(|step| step.status == "running") {
                return Err(invalid(
                    "Finish editing or wait for running steps before resolving the review",
                ));
            }
            let step = w.step(step_id).ok_or_else(|| invalid("Unknown review"))?;
            if !step.review_needs_decision() || step.finished_at != Some(finished_at) {
                return Err(invalid(
                    "This review has changed or already has a decision. Refresh it first.",
                ));
            }
            let _lease = self.workflow_lease(Path::new(&w.root))?;
            let reviewed_root =
                if decision == "approve" && step.root.is_some() && !w.gates_integration(step) {
                    step.step_root(&w)
                } else {
                    &w.root
                };
            if decision != "retry"
                && self.workflow_fingerprint(Path::new(reviewed_root)).await?
                    != step.input_revision.clone().unwrap_or_default()
            {
                return Err(invalid(
                    "The work changed since this review. Run a fresh review before accepting it.",
                ));
            }
            match decision {
                "approve" => {
                    w.steps
                        .iter_mut()
                        .find(|step| step.id == step_id)
                        .unwrap()
                        .review_decision = Some("approved".into())
                }
                "fix" => self.workflow_insert_review_fix(&mut w, step_id)?,
                "retry" => {
                    let step = w.steps.iter_mut().find(|step| step.id == step_id).unwrap();
                    step.status = "pending".into();
                    step.review_outcome = None;
                    step.review_summary = None;
                    step.review_decision = None;
                    w.review_fingerprint = None;
                    w.preview = None;
                    w.checks.clear();
                }
                _ => return Err(invalid("Choose approve, fix or retry for this review")),
            }
            w.stage = w.steps_stage();
            self.save_workflow(&mut w)?;
            w
        };
        self.workflow_control_scheduler(&w);
        Ok(w)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steps(policy: &str) -> Vec<CreateWorkflowStep> {
        [
            ("first", "implement", "HOLD_FIRST", vec![]),
            ("review", "review", "Review the first change", vec!["first"]),
            ("second", "implement", "SECOND_PROMPT", vec!["review"]),
            ("final", "review", "Review all changes", vec!["second"]),
        ]
        .into_iter()
        .map(|(id, role, prompt, deps)| CreateWorkflowStep {
            id: Some(id.into()),
            role: role.into(),
            prompt: prompt.into(),
            target: "codex".into(),
            depends_on: Some(deps.into_iter().map(String::from).collect()),
            workspace: "shared".into(),
            review_policy: if role == "review" {
                policy.into()
            } else {
                String::new()
            },
            ..Default::default()
        })
        .collect()
    }

    async fn fixture(
        policy: &str,
        verdict: &str,
    ) -> (tempfile::TempDir, Arc<AgentManager>, AgentWorkflow) {
        let (temp, manager, repo) = super::super::tests::repository();
        let project = manager
            .add_project("Controls fixture".into(), repo)
            .unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        std::fs::write(temp.path().join("verdict"), verdict).unwrap();
        std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'), path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line); if (msg.type !== 'start') return;
  const cfg = msg.config;
  fs.appendFileSync(path.join(__dirname, 'calls'), JSON.stringify({prompt:cfg.prompt, review:cfg.read_only_review, model:cfg.model, effort:cfg.effort})+'\n');
  const finish = () => {
    let text = 'Done';
    if (cfg.read_only_review) {
      const verdict = fs.readFileSync(path.join(__dirname,'verdict'),'utf8');
      text = verdict === 'unknown' ? 'I could not finish the review.' : 'RUNHQ_REVIEW_RESULT: '+JSON.stringify({verdict,summary:verdict==='pass'?'No issues':'Fix the fixture issue'});
    } else {
      fs.appendFileSync(path.join(cfg.cwd,'README.md'), 'Change\n');
    }
    emit({type:'item',item:{id:'answer',kind:'assistant',title:'Result',text,status:'completed',created_at:Date.now()}});
    emit({type:'finished',status:'completed'}); process.exit(0);
  };
  if (!cfg.read_only_review && cfg.prompt.includes('HOLD_FIRST')) {
    const timer = setInterval(() => { if(fs.existsSync(path.join(__dirname,'release'))) { clearInterval(timer); finish(); } },20);
  } else finish();
});
"#).unwrap();
        let w = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id,
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Improve the fixture".into(),
                steps: steps(policy),
                auto_progress: true,
                ..Default::default()
            })
            .await
            .unwrap();
        (temp, manager, w)
    }

    async fn wait(
        manager: &AgentManager,
        id: &str,
        predicate: impl Fn(&AgentWorkflow) -> bool,
    ) -> AgentWorkflow {
        tokio::time::timeout(Duration::from_secs(25), async {
            loop {
                let w = manager
                    .workflows()
                    .await
                    .unwrap()
                    .into_iter()
                    .find(|w| w.id == id)
                    .unwrap();
                if predicate(&w) {
                    return w;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("Timed out: {:?}", manager.workflow(id)))
    }

    #[test]
    fn review_verdict_requires_one_well_formed_final_report() {
        assert_eq!(
            review_verdict("RUNHQ_REVIEW_RESULT: {\"verdict\":\"pass\",\"summary\":\"No issues\"}")
                .0,
            "passed"
        );
        assert_eq!(
            review_verdict(
                "RUNHQ_REVIEW_RESULT: {\"verdict\":\"findings\",\"summary\":\"Fix it\"}"
            )
            .0,
            "findings"
        );
        for text in [
            "Looks good",
            "No issues but maybe a bug",
            "RUNHQ_REVIEW_RESULT: {}",
            "RUNHQ_REVIEW_RESULT: {\"verdict\":\"pass\"}",
            "RUNHQ_REVIEW_RESULT: {}\nRUNHQ_REVIEW_RESULT: {}",
        ] {
            assert_eq!(review_verdict(text).0, "unknown");
        }
    }

    #[tokio::test]
    async fn prompt_dependency_runs_while_its_review_reads_an_unchanged_snapshot() {
        for policy in ["on_findings", "approval"] {
            let (temp, manager, mut w) = fixture("on_findings", "pass").await;
            w.steps[1].review_policy = policy.into();
            manager
                .workspace_save(
                    "preferences:capacity".into(),
                    Some(json!({
                        "global": 4, "providers": { "codex": 4 }
                    })),
                )
                .unwrap();
            w.steps[2].depends_on = vec!["first".into()];
            w.steps[2].input_step_id = Some("first".into());
            w.steps[3].depends_on = vec!["second".into(), "review".into()];
            manager.save_workflow(&mut w).unwrap();
            std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'), path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line); if(msg.type !== 'start') return;
  const cfg = msg.config;
  const intermediate = cfg.read_only_review && cfg.prompt.includes('Review the first change');
  const finish = () => {
    if(!cfg.read_only_review) fs.appendFileSync(path.join(cfg.cwd,'README.md'), cfg.prompt.includes('SECOND_PROMPT') ? 'SECOND_OUTPUT\n' : 'FIRST_OUTPUT\n');
    const text = cfg.read_only_review ? 'RUNHQ_REVIEW_RESULT: {"verdict":"pass","summary":"No issues"}' : 'Done';
    emit({type:'item',item:{id:'answer',kind:'assistant',title:'Result',text,status:'completed',created_at:Date.now()}});
    emit({type:'finished',status:'completed'}); process.exit(0);
  };
  if(intermediate) {
    const timer = setInterval(() => { if(fs.existsSync(path.join(__dirname,'release-review'))) { clearInterval(timer); finish(); } },20);
  } else finish();
});
"#).unwrap();
            manager.workflow_launch(&w.id, None).await.unwrap();
            let overlap = wait(&manager, &w.id, |w| {
                w.steps[2].status == "completed" && w.steps[1].status == "running"
            })
            .await;
            let review_root = overlap.steps[1].root.as_ref().unwrap();
            assert_ne!(review_root, &overlap.root);
            let captured =
                std::fs::read_to_string(Path::new(review_root).join("README.md")).unwrap();
            assert!(captured.contains("FIRST_OUTPUT"));
            assert!(!captured.contains("SECOND_OUTPUT"));
            assert!(
                std::fs::read_to_string(Path::new(&overlap.root).join("README.md"))
                    .unwrap()
                    .contains("SECOND_OUTPUT")
            );
            assert_eq!(overlap.steps[3].status, "pending");
            std::fs::write(temp.path().join("release-review"), "ok").unwrap();
            if policy == "approval" {
                let paused = wait(&manager, &w.id, |w| w.stage == "awaiting_review").await;
                manager
                    .workflow_review_decision(
                        &w.id,
                        "review",
                        paused.steps[1].finished_at.unwrap(),
                        "approve",
                    )
                    .await
                    .unwrap();
            }
            let done = wait(&manager, &w.id, |w| w.stage == "ready").await;
            assert!(done.steps.iter().all(|step| step.status == "completed"));
            assert_eq!(done.review_fingerprint, done.current_fingerprint);
            assert_ne!(done.steps[1].input_revision, done.review_fingerprint);
        }
    }

    #[tokio::test]
    async fn live_edit_preserves_running_work_and_atomically_changes_only_future_steps() {
        let (temp, manager, w) = fixture("continue", "pass").await;
        manager.workflow_launch(&w.id, None).await.unwrap();
        wait(&manager, &w.id, |w| w.steps[0].status == "running").await;
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let original = editing.steps[0].clone();
        let mut declarations: Vec<_> = editing
            .steps
            .iter()
            .map(WorkflowStep::declaration)
            .collect();
        declarations[0].prompt = "Changed running work".into();
        assert!(manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declarations
                }
            )
            .await
            .is_err());
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        let finished = wait(&manager, &w.id, |w| w.steps[0].status == "completed").await;
        assert!(finished.editing);
        assert!(manager
            .workflow_run_named_step(&w.id, "review")
            .await
            .is_err());
        assert!(manager.workflow_run_step(&w.id).await.is_err());
        manager.workflow_schedule(&w.id).await.unwrap();
        assert_eq!(manager.workflow(&w.id).unwrap().steps[1].status, "pending");
        let mut declarations: Vec<_> = finished
            .steps
            .iter()
            .map(WorkflowStep::declaration)
            .collect();
        declarations[2].prompt = "EDITED_SECOND".into();
        declarations[2].model = "fixture-new".into();
        declarations[2].effort = "high".into();
        declarations[3].depends_on = Some(vec!["added".into()]);
        declarations.insert(
            3,
            CreateWorkflowStep {
                id: Some("added".into()),
                role: "implement".into(),
                target: "codex".into(),
                prompt: "ADDED_PROMPT".into(),
                depends_on: Some(vec!["second".into()]),
                workspace: "shared".into(),
                ..Default::default()
            },
        );
        assert!(manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision + 1,
                    steps: declarations.clone()
                }
            )
            .await
            .is_err());
        let saved = manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declarations.clone(),
                },
            )
            .await
            .unwrap();
        assert_eq!(saved.steps[0].session_id, original.session_id);
        assert_eq!(saved.steps[0].started_at, original.started_at);
        assert_eq!(saved.steps[0].status, "completed");
        assert!(!saved.editing);
        assert!(manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declarations
                }
            )
            .await
            .is_err());
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert!(ready.check_commands.is_empty() && ready.checks.is_empty());
        manager.workflow_preview(&w.id).await.unwrap();
        let calls = std::fs::read_to_string(temp.path().join("calls")).unwrap();
        assert!(
            calls.contains("EDITED_SECOND")
                && calls.contains("fixture-new")
                && calls.contains("ADDED_PROMPT")
        );
    }

    #[tokio::test]
    async fn reviews_gate_both_manual_and_automatic_progress_and_persist_explicit_decisions() {
        for (policy, verdict) in [
            ("on_findings", "findings"),
            ("on_findings", "unknown"),
            ("approval", "pass"),
        ] {
            let (temp, manager, w) = fixture(policy, verdict).await;
            std::fs::write(temp.path().join("release"), "ok").unwrap();
            manager.workflow_launch(&w.id, None).await.unwrap();
            let paused = wait(&manager, &w.id, |w| w.stage == "awaiting_review").await;
            assert_eq!(paused.steps[2].status, "pending");
            assert!(manager
                .workflow_run_named_step(&w.id, "second")
                .await
                .is_err());
            assert!(manager.workflow_commands(&w.id, false).await.is_err());
            assert!(manager.workflow_preview(&w.id).await.is_err());
            manager.workflow_schedule(&w.id).await.unwrap();
            assert_eq!(manager.workflow(&w.id).unwrap().steps[2].status, "pending");
            let stamp = paused.steps[1].finished_at.unwrap();
            assert!(manager
                .workflow_review_decision(&w.id, "review", stamp - 1, "approve")
                .await
                .is_err());
            manager
                .workflow_review_decision(&w.id, "review", stamp, "approve")
                .await
                .unwrap();
            let final_review = wait(&manager, &w.id, |w| w.steps[3].review_needs_decision()).await;
            assert_eq!(final_review.steps[2].status, "completed");
            assert_eq!(
                final_review.steps[1].review_decision.as_deref(),
                Some("approved")
            );
            manager
                .workflow_review_decision(
                    &w.id,
                    "final",
                    final_review.steps[3].finished_at.unwrap(),
                    "approve",
                )
                .await
                .unwrap();
            let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
            assert!(ready.checks.is_empty());
            manager.workflow_preview(&w.id).await.unwrap();
        }
    }

    #[tokio::test]
    async fn automatic_fix_adds_one_correction_and_recheck_then_waits_for_remaining_findings() {
        let (temp, manager, w) = fixture("auto_fix", "findings").await;
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        let paused = wait(&manager, &w.id, |w| {
            w.stage == "awaiting_review" && w.steps.len() == 6
        })
        .await;
        assert_eq!(paused.steps[2].role, "revise");
        assert_eq!(paused.steps[2].status, "completed");
        assert_eq!(paused.steps[3].review_fix_attempts, 1);
        assert_eq!(paused.steps[4].id, "second");
        assert_eq!(paused.steps[4].status, "pending");
        assert_eq!(paused.steps[4].depends_on, vec![paused.steps[3].id.clone()]);
        assert!(manager
            .workflow_run_named_step(&w.id, "second")
            .await
            .is_err());
        std::fs::write(temp.path().join("verdict"), "pass").unwrap();
        manager
            .workflow_review_decision(
                &w.id,
                &paused.steps[3].id,
                paused.steps[3].finished_at.unwrap(),
                "retry",
            )
            .await
            .unwrap();
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert_eq!(ready.steps.len(), 6);
        assert!(ready.steps.iter().all(|step| step.status == "completed"));
        manager.workflow_preview(&w.id).await.unwrap();
    }

    #[tokio::test]
    async fn three_corrections_rerun_checks_and_stop_at_the_configured_limit() {
        let (temp, manager, w) = fixture("auto_fix", "findings").await;
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared = steps("auto_fix");
        declared[1].execution.max_fix_attempts = 3;
        declared[1].execution.fix_commands =
            vec![r#"node -e "require('node:fs').appendFileSync('gates.log', 'gate\n')""#.into()];
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declared,
                },
            )
            .await
            .unwrap();
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        let paused = wait(&manager, &w.id, |w| {
            w.stage == "awaiting_review" && w.steps.len() == 13
        })
        .await;
        assert_eq!(
            paused.steps.iter().filter(|s| s.role == "revise").count(),
            3
        );
        assert_eq!(
            paused
                .steps
                .iter()
                .filter(|s| s.role == "shell" && s.status == "completed")
                .count(),
            3
        );
        let last = paused
            .steps
            .iter()
            .find(|s| s.review_needs_decision())
            .unwrap();
        assert_eq!(last.review_fix_attempts, 3);
        assert_eq!(
            std::fs::read_to_string(Path::new(&paused.cwd).join("gates.log"))
                .unwrap()
                .lines()
                .count(),
            3
        );
        assert_eq!(paused.step("second").unwrap().status, "pending");
        std::fs::write(temp.path().join("verdict"), "pass").unwrap();
        manager
            .workflow_review_decision(&w.id, &last.id, last.finished_at.unwrap(), "retry")
            .await
            .unwrap();
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert_eq!(ready.steps.len(), 13);
    }

    #[tokio::test]
    async fn shell_records_exit_output_and_retries_without_replaying_predecessors() {
        let (temp, manager, w) = fixture("on_findings", "pass").await;
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared = steps("on_findings");
        declared.insert(1, CreateWorkflowStep { id: Some("gate".into()), role: "shell".into(), target: "codex".into(), prompt: "Verify".into(), depends_on: Some(vec!["first".into()]), execution: WorkflowExecution { command: r#"node -e "const fs=require('node:fs'); if(fs.existsSync('retry-marker')) console.log('recovered'); else {fs.writeFileSync('retry-marker','');console.log('initial-failure');process.exit(7)}""#.into(), max_retries: 1, retry_delay_seconds: 0, ..Default::default() }, ..Default::default() });
        declared[2].depends_on = Some(vec!["gate".into()]);
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declared,
                },
            )
            .await
            .unwrap();
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        let gate = ready.step("gate").unwrap();
        assert_eq!(gate.result.attempts.len(), 2);
        assert_eq!(gate.result.attempts[0].exit_code, Some(7));
        assert!(gate.result.attempts[0].output.contains("initial-failure"));
        assert_eq!(gate.result.attempts[1].exit_code, Some(0));
        assert_eq!(ready.step("first").unwrap().result.attempts.len(), 1);
    }

    #[tokio::test]
    async fn shell_failure_stops_admission_and_can_be_retried_explicitly() {
        let (temp, manager, w) = fixture("on_findings", "pass").await;
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared = steps("on_findings");
        declared.insert(
            1,
            CreateWorkflowStep {
                id: Some("gate".into()),
                role: "shell".into(),
                target: "codex".into(),
                prompt: "Verify".into(),
                depends_on: Some(vec!["first".into()]),
                execution: WorkflowExecution {
                    command: r#"node -e "process.exit(require('node:fs').existsSync('allowed') ? 0 : 1)""#.into(),
                    ..Default::default()
                },
                ..Default::default()
            },
        );
        declared[2].depends_on = Some(vec!["gate".into()]);
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declared,
                },
            )
            .await
            .unwrap();
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        let stopped = wait(&manager, &w.id, |w| {
            w.step("gate").unwrap().status == "failed"
        })
        .await;
        assert_eq!(stopped.step("review").unwrap().status, "pending");
        std::fs::write(Path::new(&stopped.cwd).join("allowed"), "ok").unwrap();
        manager
            .workflow_run_named_step(&w.id, "gate")
            .await
            .unwrap();
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert_eq!(ready.step("gate").unwrap().result.attempts.len(), 2);
    }

    #[tokio::test]
    async fn a_named_resource_serializes_steps_across_workflows() {
        let (temp, manager, w) = fixture("on_findings", "pass").await;
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared = steps("on_findings");
        declared[0].execution.lock = "shared-database".into();
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declared.clone(),
                },
            )
            .await
            .unwrap();
        let other = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: w.project_id.clone(),
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Other workflow".into(),
                steps: declared,
                auto_progress: true,
                ..Default::default()
            })
            .await
            .unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        wait(&manager, &w.id, |w| {
            w.step("first").unwrap().status == "running"
        })
        .await;
        manager.workflow_launch(&other.id, None).await.unwrap();
        manager.workflow_schedule(&other.id).await.unwrap();
        assert_eq!(
            manager
                .workflow(&other.id)
                .unwrap()
                .step("first")
                .unwrap()
                .status,
            "pending"
        );
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        let first = wait(&manager, &w.id, |w| w.stage == "ready").await;
        let second = wait(&manager, &other.id, |w| w.stage == "ready").await;
        assert!(
            second.step("first").unwrap().started_at >= first.step("first").unwrap().finished_at
        );
    }

    #[tokio::test]
    async fn recorded_outcome_skips_a_conditional_step_without_starting_its_agent() {
        let (temp, manager, w) = fixture("on_findings", "pass").await;
        let bridge = temp.path().join("bridge.cjs");
        let source = std::fs::read_to_string(&bridge).unwrap().replace(
            "let text = 'Done';",
            "let text = 'PIPELINE_RESULT: SUCCESS';",
        );
        std::fs::write(&bridge, source).unwrap();
        let editing = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared = steps("on_findings");
        declared[0].execution.result_format = "pipeline".into();
        declared[2].depends_on = Some(vec!["review".into(), "first".into()]);
        declared[2].execution.run_if = Some(WorkflowCondition {
            step_id: "first".into(),
            outcomes: vec!["findings".into()],
        });
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: editing.edit_revision,
                    steps: declared,
                },
            )
            .await
            .unwrap();
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert_eq!(
            ready.step("second").unwrap().result.outcome.as_deref(),
            Some("skipped")
        );
        assert!(ready.step("second").unwrap().session_id.is_none());
        assert_eq!(
            std::fs::read_to_string(temp.path().join("calls"))
                .unwrap()
                .lines()
                .count(),
            3
        );
    }

    #[tokio::test]
    async fn deadline_interrupts_an_agent_and_records_a_recoverable_failure() {
        let (temp, manager, w) = fixture("on_findings", "pass").await;
        let bridge = temp.path().join("bridge.cjs");
        let source = std::fs::read_to_string(&bridge).unwrap().replace("if (msg.type !== 'start') return;", "if (msg.type === 'interrupt') { emit({type:'ack',command_id:msg.command_id}); emit({type:'finished',status:'cancelled'}); process.exit(0); } if (msg.type !== 'start') return;");
        std::fs::write(&bridge, source).unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        wait(&manager, &w.id, |w| {
            w.step("first").unwrap().status == "running"
        })
        .await;
        {
            let _gate = manager.workflow_gate.lock().await;
            let mut active = manager.workflow(&w.id).unwrap();
            active.steps[0].execution.timeout_minutes = 1;
            active.steps[0].started_at = Some(now() - 61000);
            manager.save_workflow(&mut active).unwrap();
            manager.workflow_monitor(&active, "first");
        }
        let stopped = wait(&manager, &w.id, |w| {
            w.step("first").unwrap().status == "failed"
        })
        .await;
        assert_eq!(
            stopped.step("first").unwrap().error.as_deref(),
            Some("workflow.timed_out")
        );
        assert_eq!(stopped.step("first").unwrap().result.attempts.len(), 1);
        assert_eq!(stopped.step("review").unwrap().status, "pending");
    }
    #[tokio::test]
    async fn editing_pause_survives_restart_and_stale_review_cannot_be_accepted() {
        let (temp, manager, w) = fixture("approval", "pass").await;
        let edit = manager.workflow_edit(&w.id, true).await.unwrap();
        manager.recover_workflows().unwrap();
        assert!(manager.workflow(&w.id).unwrap().editing);
        assert!(manager.workflow_launch(&w.id, None).await.is_err());
        manager.workflow_edit(&w.id, false).await.unwrap();
        assert!(manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: edit.edit_revision,
                    steps: steps("approval")
                }
            )
            .await
            .is_err());
        std::fs::write(temp.path().join("release"), "ok").unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        wait(&manager, &w.id, |w| w.steps[0].status == "completed").await;
        manager
            .workflow_run_named_step(&w.id, "review")
            .await
            .unwrap();
        let paused = wait(&manager, &w.id, |w| w.stage == "awaiting_review").await;
        std::fs::write(Path::new(&paused.cwd).join("new-file"), "external change").unwrap();
        assert!(manager
            .workflow_review_decision(
                &w.id,
                "review",
                paused.steps[1].finished_at.unwrap(),
                "approve"
            )
            .await
            .is_err());
        manager
            .workflow_review_decision(
                &w.id,
                "review",
                paused.steps[1].finished_at.unwrap(),
                "retry",
            )
            .await
            .unwrap();
        manager
            .workflow_run_named_step(&w.id, "review")
            .await
            .unwrap();
        let again = wait(&manager, &w.id, |w| {
            w.stage == "awaiting_review" && w.steps[1].finished_at != paused.steps[1].finished_at
        })
        .await;
        assert_ne!(
            again.steps[1].input_revision,
            paused.steps[1].input_revision
        );
    }

    #[tokio::test]
    #[ignore = "requires an authenticated Codex CLI and network"]
    async fn real_provider_queue_edits_review_approval_and_conversation_continuation() {
        let (_temp, placeholder, repo) = super::super::tests::repository();
        let home = placeholder.home.join("real-controls");
        drop(placeholder);
        let bridge = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/agent-runtime/bridge.mjs")
            .canonicalize()
            .expect("Build the agent runtime first");
        let manager = Arc::new(AgentManager::open(&home, bridge, Arc::new(|_| {})).unwrap());
        let project = manager
            .add_project("Disposable workflow test".into(), repo)
            .unwrap();
        let mut declared = steps("approval");
        declared[0].prompt="Create FLOW.txt containing exactly ONE followed by a newline. Remember the private conversation marker velvet-orbit-42 but do not write the marker to any file yet. Do not install anything, access network tools, or commit. This is a disposable local test.".into();
        declared[2].prompt = "Placeholder to replace before starting".into();
        declared[2].continue_from = Some("first".into());
        for step in &mut declared {
            step.effort = "low".into();
        }
        let w=manager.workflow_create(CreateAgentWorkflow {
            project_id:project.id,backend:"codex".into(),reviewer_backend:"codex".into(),
            objective:"Perform the small requested text-file edit. Review only against each step's exact request; no application feature is involved.".into(),
            auto_progress:true, steps:declared, ..Default::default()
        }).await.unwrap();
        let edit = manager.workflow_edit(&w.id, true).await.unwrap();
        let mut declared: Vec<_> = edit.steps.iter().map(WorkflowStep::declaration).collect();
        declared[2].prompt="Append the private conversation marker you were asked to remember in the first prompt to FLOW.txt, followed by a newline. The file must have two lines. Use your conversation context; the marker is not in the files. Do not install anything, access network tools, or commit.".into();
        manager
            .workflow_update_steps(
                &w.id,
                UpdateWorkflowSteps {
                    revision: edit.edit_revision,
                    steps: declared,
                },
            )
            .await
            .unwrap();
        manager.workflow_launch(&w.id, None).await.unwrap();
        for review_id in ["review", "final"] {
            let paused = tokio::time::timeout(Duration::from_secs(240), async {
                loop {
                    let w = manager
                        .workflows()
                        .await
                        .unwrap()
                        .into_iter()
                        .find(|entry| entry.id == w.id)
                        .unwrap();
                    for step in &w.steps {
                        if let Some(id) = &step.session_id {
                            let session = manager.session(id).unwrap();
                            assert!(
                                session.pending.is_empty(),
                                "Real provider needs a decision: {:?}",
                                session.pending
                            );
                            assert_ne!(
                                session.status, "failed",
                                "Provider error: {:?}",
                                session.last_error
                            );
                        }
                    }
                    let review = w.step(review_id).unwrap();
                    if review.review_needs_decision() {
                        break w;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            })
            .await
            .expect("Real provider timed out");
            let review = paused.step(review_id).unwrap();
            println!(
                "Real review {review_id}: {:?}: {:?}",
                review.review_outcome, review.review_summary
            );
            assert_eq!(
                review.review_outcome.as_deref(),
                Some("passed"),
                "{:?}",
                review.review_summary
            );
            manager
                .workflow_review_decision(&w.id, review_id, review.finished_at.unwrap(), "approve")
                .await
                .unwrap();
        }
        let ready = wait(&manager, &w.id, |w| w.stage == "ready").await;
        assert_eq!(ready.steps[0].session_id, ready.steps[2].session_id);
        assert_ne!(ready.steps[0].session_id, ready.steps[1].session_id);
        assert_eq!(
            std::fs::read_to_string(Path::new(&ready.cwd).join("FLOW.txt")).unwrap(),
            "ONE\nvelvet-orbit-42\n"
        );
        assert!(!Path::new(&ready.target).join("FLOW.txt").exists());
        manager.workflow_preview(&w.id).await.unwrap();
        println!("Real workflow completed: live edit, review decisions, same conversation, independent reviews and no-command validation.");
    }
}
