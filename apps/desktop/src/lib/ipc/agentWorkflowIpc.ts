import { invoke } from '@tauri-apps/api/core';

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
/**
 * One agent's part of a workflow. `target` is a connection id or a `pool:` target, because the
 * account is only chosen when the step starts; `input_step_id` names the step whose revision this
 * one begins from, and null means the workflow's own base.
 */
export interface WorkflowStep {
  id: string;
  role: 'plan' | 'implement' | 'review' | 'revise' | 'validate';
  target: string;
  model: string;
  effort: string;
  mode: string;
  session_id: string | null;
  input_step_id: string | null;
}
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
}
export const agentWorkflowIpc = {
  list: () => invoke<AgentWorkflow[]>('agent_workflows'),
  create: (input: CreateAgentWorkflow) => invoke<AgentWorkflow>('agent_workflow_create', { input }),
  implement: (id: string) => invoke<AgentWorkflow>('agent_workflow_implement', { id }),
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
