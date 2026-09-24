import { invoke } from '@tauri-apps/api/core';

export interface WorkflowExecution {
  command?: string;
  working_directory?: string;
  lock?: string;
  timeout_minutes?: number;
  idle_timeout_minutes?: number;
  max_retries?: number;
  retry_delay_seconds?: number;
  max_fix_attempts?: number;
  fix_commands?: string[];
  fix_prompt?: string;
  result_format?: 'none' | 'json' | 'pipeline' | 'review';
  success_regex?: string;
  failure_regex?: string;
  on_failure?: 'pause' | 'cancel';
  run_if?: { step_id: string; outcomes: ('pass' | 'findings' | 'skipped')[] } | null;
}
export interface WorkflowAttempt {
  started_at: number;
  finished_at: number;
  outcome: string;
  exit_code: number | null;
  output: string;
  error: string | null;
}
export interface WorkflowStepResult {
  outcome: string | null;
  output: string;
  exit_code: number | null;
  attempts: WorkflowAttempt[];
  retries: number;
  retry_at: number | null;
  forced_error: string | null;
}

export interface WorkflowCheck {
  command: string;
  cwd: string;
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
  output: string;
  fingerprint: string;
  status: string;
}
export interface WorkflowPreview {
  target: string;
  target_branch: string;
  target_fingerprint: string;
  source_fingerprint: string;
  patch: string;
  conflict: string | null;
}
/** How a step's result landed in the workflow's shared checkout. A conflict is never resolved. */
export interface WorkflowStepMerge {
  applied_at: number;
  base_revision: string;
  source_fingerprint: string;
  target_fingerprint: string | null;
  patch_bytes: number;
  status: 'applied' | 'conflict' | 'empty';
  conflict: string | null;
}
/**
 * One task in a workflow. `target` is a connection id or a `pool:` target, because the account is
 * only chosen when the task starts; `depends_on` names every task that must finish first, and an
 * empty list is a task that waits for nothing. `input_step_id` is the first of those, kept for
 * readers that predate the graph.
 */
export interface WorkflowStep {
  id: string;
  role: WorkflowRole;
  target: string;
  model: string;
  effort: string;
  mode: string;
  session_id: string | null;
  /** Continue this earlier producing step's conversation. Reviews always use their own session. */
  continue_from?: string | null;
  input_step_id: string | null;
  depends_on: string[];
  /** This task's own instruction. Empty means it is described by the workflow objective alone. */
  prompt: string;
  /** `shared` runs in the workflow's checkout; `own` gets one of its own, so it can run beside a sibling. */
  workspace: WorkflowWorkspace;
  cwd: string | null;
  root: string | null;
  status: WorkflowStepStatus;
  /** The workspace revision this step actually started from, recorded when it starts. */
  input_revision: string | null;
  output_tree: string | null;
  output_revision: string | null;
  merge: WorkflowStepMerge | null;
  generation: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  review_policy?: WorkflowReviewPolicy | '';
  execution?: WorkflowExecution;
  review_outcome?: 'passed' | 'findings' | 'unknown' | null;
  review_summary?: string | null;
  review_decision?: 'approved' | 'fix_requested' | null;
  review_fix_attempts?: number;
  result?: WorkflowStepResult;
}
export type WorkflowReviewPolicy = 'continue' | 'on_findings' | 'approval' | 'auto_fix';
export type WorkflowRole = 'plan' | 'implement' | 'review' | 'revise' | 'validate' | 'shell';
export type WorkflowWorkspace = 'shared' | 'own';
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
export interface AgentWorkflow {
  id: string;
  project_id: string;
  title: string;
  objective: string;
  acceptance: string;
  implementation_session_id: string;
  review_session_id: string | null;
  reviewer_backend: string;
  /** The ordered roles this workflow runs. Older rows are migrated on read, so this is never empty. */
  steps: WorkflowStep[];
  reviewer_model: string;
  base_revision: string;
  cwd: string;
  root: string;
  target: string;
  stage: string;
  setup_commands: string[];
  check_commands: string[];
  setup: WorkflowCheck[];
  checks: WorkflowCheck[];
  review_fingerprint: string | null;
  current_fingerprint: string | null;
  preview: WorkflowPreview | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  cleaned: boolean;
  auto_progress: boolean;
  launch_pending?: boolean;
  editing?: boolean;
  edit_revision?: number;
  start_after?: { session_id: string; title: string } | null;
  /** How many tasks may run at once. 0 derives the bound from the capacity settings. */
  concurrency: number;
  /** Tasks whose results were applied to the shared checkout, in the order they landed. */
  joined: string[];
  transferred_files: {
    path: string;
    source: string;
    size: number;
    captured_at: number;
    digest: string;
  }[];
  /** Set when integration created a branch and commit instead of leaving the patch uncommitted. */
  integration_branch: string | null;
  integration_commit: string | null;
}
/** Where reviewed work lands. Pushing and opening a pull request stay outside RunHQ. */
export type WorkflowDestination =
  { mode: 'working_tree' } | { mode: 'branch'; branch: string; message: string };
export interface WorkflowWorktree {
  workflow_id: string | null;
  session_id: string;
  project_id: string;
  path: string;
  branch: string | null;
  base_revision: string;
  dirty: boolean;
  status: string;
  active: boolean;
  size_bytes: number;
  size_incomplete: boolean;
  missing: boolean;
}
export interface CreateAgentWorkflow {
  project_id: string;
  backend: string;
  model: string;
  effort: string;
  reviewer_backend: string;
  reviewer_model: string;
  objective: string;
  acceptance: string;
  base_ref: string;
  setup_commands: string[];
  check_commands: string[];
  auto_progress: boolean;
  /** How many tasks may run at once. 0 lets the capacity settings decide. */
  concurrency: number;
  /** The tasks to run. Empty keeps the two-role shape built from the backend fields. */
  steps: CreateWorkflowStep[];
}
/** A task as the creating screen states it; session, status and revision are RunHQ's to fill in. */
export interface CreateWorkflowStep {
  /** The key this task is known by, and that other tasks name in `depends_on`. */
  id: string;
  role: WorkflowRole;
  target: string;
  model: string;
  effort: string;
  mode: string;
  /** This task's own instruction. */
  prompt: string;
  /** Tasks that must finish first. An empty list is a task that starts straight away. */
  depends_on: string[];
  workspace: WorkflowWorkspace;
  continue_from?: string | null;
  review_policy?: WorkflowReviewPolicy | '';
  execution?: WorkflowExecution;
}
export const agentWorkflowIpc = {
  importRecipes: (path: string) => invoke<unknown>('agent_workflow_import_recipes', { path }),
  edit: (id: string, editing: boolean) =>
    invoke<AgentWorkflow>('agent_workflow_edit', { id, editing }),
  updateSteps: (id: string, revision: number, steps: CreateWorkflowStep[]) =>
    invoke<AgentWorkflow>('agent_workflow_update_steps', { id, input: { revision, steps } }),
  reviewDecision: (
    id: string,
    stepId: string,
    finishedAt: number,
    decision: 'approve' | 'fix' | 'retry',
  ) =>
    invoke<AgentWorkflow>('agent_workflow_review_decision', { id, stepId, finishedAt, decision }),
  list: () => invoke<AgentWorkflow[]>('agent_workflows'),
  create: (input: CreateAgentWorkflow) => invoke<AgentWorkflow>('agent_workflow_create', { input }),
  launch: (id: string, afterSessionId?: string) =>
    invoke<AgentWorkflow>('agent_workflow_launch', { id, afterSessionId: afterSessionId ?? null }),
  implement: (id: string) => invoke<AgentWorkflow>('agent_workflow_implement', { id }),
  runStep: (id: string, stepId?: string) =>
    invoke<AgentWorkflow>('agent_workflow_run_step', { id, stepId }),
  /** Start every task that can run now, and land the results that are ready. */
  schedule: (id: string) => invoke<AgentWorkflow>('agent_workflow_schedule', { id }),
  review: (id: string) => invoke<AgentWorkflow>('agent_workflow_review', { id }),
  setup: (id: string) => invoke<AgentWorkflow>('agent_workflow_setup', { id }),
  checks: (id: string) => invoke<AgentWorkflow>('agent_workflow_checks', { id }),
  preview: (id: string) => invoke<AgentWorkflow>('agent_workflow_preview', { id }),
  integrate: (id: string, destination: WorkflowDestination = { mode: 'working_tree' }) =>
    invoke<AgentWorkflow>('agent_workflow_integrate', { id, destination }),
  cancel: (id: string) => invoke<AgentWorkflow>('agent_workflow_cancel', { id }),
  cleanup: (id: string) => invoke<AgentWorkflow>('agent_workflow_cleanup', { id }),
  transferFiles: (id: string, paths: string[]) =>
    invoke<AgentWorkflow>('agent_workflow_transfer_files', { id, paths }),
  inventory: () => invoke<WorkflowWorktree[]>('agent_workflow_inventory'),
};
