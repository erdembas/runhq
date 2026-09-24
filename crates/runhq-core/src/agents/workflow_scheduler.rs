//! Which of a workflow's steps may run now, and starting them.
//!
//! A workflow is a graph of tasks, so at any moment several of them can be free to run: everything
//! whose dependencies have finished and whose results have landed. What actually starts is bounded
//! by three things that have nothing to do with the graph — one agent per checkout, the account
//! slots the person configured, and the workflow's own limit — and a step that cannot start yet is
//! left waiting rather than failed, because the next pass will find it again.
//!
//! Nothing here applies or integrates anything. Automatic progression runs the steps that were
//! declared and the checks that were recorded; what to do with the result stays an explicit choice.
use super::*;
use tokio::sync::Notify;

/// How long a pass waits before looking again when nothing woke it.
const SCHEDULER_TICK: Duration = Duration::from_secs(2);

/// Why a step is not starting in this pass. A reason is not a failure — it is what the person sees
/// when they ask why twelve tasks are ready and only three are running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepWait {
    Ready,
    Dependencies,
    Checkout,
    Capacity,
    WorkflowLimit,
    Resource,
}

impl AgentManager {
    /// Whether the workflow as a whole can start steps at all.
    ///
    /// A phase that owns the whole checkout — setup, checks, integration — is not something a step
    /// may run underneath, and setup that was asked for has to have passed first.
    pub(super) fn workflow_accepts_steps(w: &AgentWorkflow) -> bool {
        !w.cleaned
            && !w.editing
            && !w.awaiting_review()
            && w.start_after.is_none()
            && !matches!(
                w.stage.as_str(),
                "setting_up"
                    | "checking"
                    | "integrating"
                    | "integrated"
                    | "cancelled"
                    | "waiting"
                    | "launching"
                    | "launch_failed"
                    | "launch_paused"
            )
            && (w.setup_commands.is_empty() || commands_passed(&w.setup_commands, &w.setup))
    }

    /// Why this step is or is not startable right now, given what is already running.
    ///
    /// `claimed` holds the checkout roots taken by steps admitted earlier in the same pass, so two
    /// steps of one workflow cannot both be handed the same checkout.
    pub(super) fn workflow_step_wait(
        &self,
        w: &AgentWorkflow,
        step: &WorkflowStep,
        claimed: &[PathBuf],
    ) -> StepWait {
        if step.status != "pending" || !w.runnable_steps().iter().any(|next| next.id == step.id) {
            return StepWait::Dependencies;
        }
        let limit = if w.concurrency == 0 {
            usize::MAX
        } else {
            w.concurrency as usize
        };
        if self.workflow_resource_busy(w, step) {
            return StepWait::Resource;
        }
        if w.steps.iter().filter(|s| s.status == "running").count() >= limit {
            return StepWait::WorkflowLimit;
        }
        // A step that has not opened its checkout yet will be given a new one, which nothing else
        // can be holding. Everything else names a checkout that has to be free.
        let checkout = if step.owns_workspace() && step.cwd.is_none() {
            None
        } else {
            // Reviews capture the current shared checkout, including on a retry.
            Some(PathBuf::from(if workflow_role_produces(&step.role) {
                step.step_root(w)
            } else {
                &w.root
            }))
        };
        let state = self.state.lock();
        if let Some(root) = &checkout {
            let overlap = |path: &Path| path.starts_with(root) || root.starts_with(path);
            if state.running.values().any(|running| overlap(&running.cwd))
                || state.workflow_leases.values().any(|path| overlap(path))
                || claimed.iter().any(|path| overlap(path))
            {
                return StepWait::Checkout;
            }
        }
        if step.role == "shell" {
            return StepWait::Ready;
        }
        // A pool is resolved when the step starts; until then only the number of free slots for the
        // whole provider can be judged, which is what the pool itself would pick from.
        let backend = step
            .session_id
            .as_ref()
            .or_else(|| {
                step.continue_from
                    .as_ref()
                    .and_then(|id| w.step(id))
                    .and_then(|previous| previous.session_id.as_ref())
            })
            .and_then(|id| state.sessions.get(id))
            .map(|session| session.backend.clone())
            .unwrap_or_else(|| step.target.clone());
        if backend.starts_with("pool:") {
            drop(state);
            return if self
                .resolve_step_target(&backend, !workflow_role_produces(&step.role))
                .is_ok()
            {
                StepWait::Ready
            } else {
                StepWait::Capacity
            };
        }
        let Ok((global, provider)) = Self::capacity_limits(&state.db.conn, &backend) else {
            return StepWait::Capacity;
        };
        if state.running.len() >= global {
            return StepWait::Capacity;
        }
        let busy = state
            .running
            .keys()
            .filter(|id| {
                state
                    .sessions
                    .get(*id)
                    .is_some_and(|session| session.backend == backend)
            })
            .count();
        if busy >= provider {
            return StepWait::Capacity;
        }
        StepWait::Ready
    }

    /// Start a saved workflow now, or after a task in the same project succeeds.
    /// Launching never reuses the preceding task's conversation or edits its working copy.
    pub async fn workflow_launch(
        self: &Arc<Self>,
        id: &str,
        after_session_id: Option<String>,
    ) -> AppResult<AgentWorkflow> {
        let workflow = {
            let _gate = self.workflow_gate.lock().await;
            let mut w = self.workflow(id)?;
            if w.cleaned
                || w.editing
                || w.steps.iter().any(|step| step.started_at.is_some())
                || !matches!(
                    w.stage.as_str(),
                    "setup_ready"
                        | "setup_failed"
                        | "implementation_ready"
                        | "waiting"
                        | "launching"
                        | "launch_failed"
                        | "launch_paused"
                        | "cancelled"
                        | "interrupted"
                )
            {
                return Err(invalid(
                    "Choose launch timing before this workflow's first task starts",
                ));
            }
            let dependency = after_session_id
                .map(|id| {
                    let session = self.session(&id)?;
                    if session.project_id != w.project_id
                        || session.archived
                        || id == w.implementation_session_id
                        || w.steps
                            .iter()
                            .any(|step| step.session_id.as_ref() == Some(&id))
                        || (!session.active() && session.status != "completed")
                    {
                        return Err(invalid(
                            "Choose an active task in the same project, or start this workflow now",
                        ));
                    }
                    Ok(WorkflowStartDependency {
                        session_id: id,
                        title: session.title,
                    })
                })
                .transpose()?;
            w.start_after = dependency;
            w.generation += 1;
            w.launch_pending = true;
            w.stage = if w.start_after.is_some() {
                "waiting"
            } else {
                "launching"
            }
            .into();
            w.error = None;
            self.save_workflow(&mut w)?;
            w
        };
        let manager = Arc::clone(self);
        let id = workflow.id.clone();
        let generation = workflow.generation;
        tokio::spawn(async move {
            manager.workflow_scheduler_loop(id, generation).await;
        });
        self.workflow_notify();
        Ok(workflow)
    }

    /// Resolve the dependency under the same gate used by scheduling and cancellation.
    async fn workflow_release_launch(&self, id: &str, generation: u64) -> AppResult<()> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        if !w.launch_pending || w.generation != generation {
            return Ok(());
        }
        if let Some(dependency) = &w.start_after {
            let session = self.session(&dependency.session_id)?;
            if session.archived || session.project_id != w.project_id {
                return Err(invalid(
                    "The preceding task is no longer available in this project",
                ));
            }
            if session.active() || !session.pending.is_empty() {
                return Ok(());
            }
            if session.status != "completed" {
                return Err(invalid("The preceding task did not complete successfully. Review it, then choose when to start this workflow."));
            }
        }
        w.start_after = None;
        w.stage =
            if !w.setup_commands.is_empty() && !commands_passed(&w.setup_commands, &w.setup) {
                "setup_ready"
            } else {
                "implementation_ready"
            }
            .into();
        self.save_workflow(&mut w)
    }

    /// One scheduling pass: land what finished, then start what can start.
    ///
    /// The gate is held while the decision is made and released before any provider turn runs, the
    /// same discipline the long command runner already follows.
    pub async fn workflow_schedule(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let started = self.workflow_schedule_pass(id).await?;
        if started {
            self.workflow_notify();
        }
        let workflow = self.workflow(id)?;
        if workflow.auto_progress {
            let manager = Arc::clone(self);
            let id = workflow.id.clone();
            let generation = workflow.generation;
            tokio::spawn(async move {
                manager.workflow_scheduler_loop(id, generation).await;
            });
        }
        Ok(workflow)
    }

    async fn workflow_schedule_pass(self: &Arc<Self>, id: &str) -> AppResult<bool> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        if !Self::workflow_accepts_steps(&w)
            || w.steps
                .iter()
                .any(|s| matches!(s.status.as_str(), "failed" | "blocked"))
        {
            return Ok(false);
        }
        // Results land before anything new is admitted, because landing one changes the checkout the
        // next step would read.
        let unjoined: Vec<String> = w.unjoined().iter().map(|step| step.id.clone()).collect();
        let landed = !unjoined.is_empty();
        for step_id in unjoined {
            if let Err(error) = self.workflow_join_step(&mut w, &step_id).await {
                w.error = Some(format!(
                    "Applying what step {step_id:?} produced failed: {error}"
                ));
                self.save_workflow(&mut w)?;
                return Ok(false);
            }
        }
        // Only a result that landed in this pass changes where the graph stands; a phase that owns
        // the checkout keeps its own stage otherwise.
        if landed && workflow_step_stage(&w.stage) {
            w.stage = w.steps_stage();
        }
        self.save_workflow(&mut w)?;
        if w.unjoined().iter().any(|step| {
            step.merge
                .as_ref()
                .is_some_and(|merge| merge.status == "conflict")
        }) {
            // A conflict is a decision for the person. Nothing else starts on top of it.
            return Ok(false);
        }
        let mut claimed: Vec<PathBuf> = Vec::new();
        let mut started = false;
        while let Some(step) = w
            .runnable_steps()
            .into_iter()
            .filter(|step| self.workflow_step_wait(&w, step, &claimed) == StepWait::Ready)
            // Capture ready reviews before a sibling producer changes the shared checkout.
            .min_by_key(|step| workflow_role_produces(&step.role))
            .cloned()
        {
            let outcome = self.workflow_start_execution(&mut w, step.clone()).await;
            match outcome {
                Ok(_) => started = true,
                Err(error) => {
                    // One step that cannot start does not stop the others; it is recorded on itself
                    // and the pass moves on.
                    if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id)
                    {
                        current.status = "failed".into();
                        current.finished_at = Some(now());
                        current.error = Some(error.to_string());
                    }
                    w.error = Some(error.to_string());
                    w.stage = w.steps_stage();
                    self.save_workflow(&mut w)?;
                }
            }
            // A step that owns its checkout records it while starting, so re-read before the next.
            w = self.workflow(id)?;
            if let Some(started) = w.step(&step.id).filter(|step| step.status == "running") {
                claimed.push(PathBuf::from(started.step_root(&w)));
            }
            if !Self::workflow_accepts_steps(&w)
                || w.steps
                    .iter()
                    .any(|s| matches!(s.status.as_str(), "failed" | "blocked"))
            {
                break;
            }
        }
        if started && w.launch_pending {
            w.launch_pending = false;
            self.save_workflow(&mut w)?;
        }
        Ok(started)
    }

    /// Wake the scheduler now rather than at the next tick.
    pub(super) fn workflow_notify(&self) {
        self.workflow_wake.notify_waiters();
    }

    /// Run a workflow's steps as they become free, until there is nothing left it may do on its own.
    ///
    /// Progression is bounded: it starts declared steps and runs the recorded checks once, and it
    /// stops at the first failure rather than working around it. Applying the result is never
    /// automatic. On restart nothing is replayed — `recover_workflows` pauses automation instead.
    pub(super) async fn workflow_scheduler_loop(self: Arc<Self>, id: String, generation: u64) {
        let key = (id.clone(), generation);
        if !self.workflow_schedulers.lock().insert(key.clone()) {
            return;
        }
        let _registration = SchedulerRegistration {
            manager: &self,
            key,
        };
        let mut checked = false;
        loop {
            let (stage, launching, editing) = {
                let _gate = self.workflow_gate.lock().await;
                match self.workflow(&id) {
                    Ok(mut workflow)
                        if (workflow.auto_progress || workflow.launch_pending)
                            && workflow.generation == generation =>
                    {
                        if let Err(error) = self.reconcile_workflow(&mut workflow).await {
                            tracing::warn!("Workflow status refresh failed: {error}");
                            return;
                        }
                        (workflow.stage, workflow.launch_pending, workflow.editing)
                    }
                    _ => return,
                }
            };
            if editing || stage == "awaiting_review" {
                self.workflow_wait().await;
                continue;
            }
            let outcome = match stage.as_str() {
                "waiting" | "launching" if launching => self.workflow_release_launch(&id, generation).await,
                "setup_ready" if launching => self.workflow_commands(&id, true).await.map(|_| ()),
                "checking" | "setting_up" | "integrating" => {
                    self.workflow_wait().await;
                    continue;
                }
                "implementing" | "reviewing" | "implementation_ready" | "review_ready" => {
                    self.workflow_schedule_pass(&id).await.map(|_| ())
                }
                "checks_ready" if !checked => {
                    checked = true;
                    self.workflow_commands(&id, false).await.map(|_| ())
                }
                _ if launching => Err(invalid("Workflow launch stopped. Inspect the recorded task or setup error before retrying.")),
                _ => return,
            };
            if let Err(error) = outcome {
                let _gate = self.workflow_gate.lock().await;
                if let Ok(mut workflow) = self.workflow(&id) {
                    if workflow.generation != generation {
                        return;
                    }
                    // An editor or review decision may have paused admission after this loop
                    // read the stage. That pause is not a failed launch or failed automation.
                    if workflow.editing || workflow.awaiting_review() {
                        continue;
                    }
                    workflow.auto_progress = false;
                    if workflow.launch_pending {
                        workflow.launch_pending = false;
                        workflow.stage = "launch_failed".into();
                    }
                    workflow.error = Some(format!("Automatic progression paused: {error}"));
                    let _ = self.save_workflow(&mut workflow);
                }
                return;
            }
            // A pass that started nothing waits to be woken; one that did looks again straight away,
            // because a step may have been admitted while another was still being set up.
            self.workflow_wait().await;
        }
    }

    async fn workflow_wait(&self) {
        let woken = self.workflow_wake.notified();
        tokio::select! {
            _ = woken => {}
            _ = tokio::time::sleep(SCHEDULER_TICK) => {}
        }
    }
}

/// The signal a finished turn sends so the scheduler looks again immediately.
pub(super) fn workflow_wake() -> Arc<Notify> {
    Arc::new(Notify::new())
}

struct SchedulerRegistration<'a> {
    manager: &'a AgentManager,
    key: (String, u64),
}
impl Drop for SchedulerRegistration<'_> {
    fn drop(&mut self) {
        self.manager.workflow_schedulers.lock().remove(&self.key);
    }
}
