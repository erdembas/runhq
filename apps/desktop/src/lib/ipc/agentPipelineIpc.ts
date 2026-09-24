import { invoke } from '@tauri-apps/api/core';
export interface PipelineStep {
  id: string;
  type: 'agent' | 'shell' | 'human' | 'barrier';
  title: string;
  dependsOn: string[];
  prompt: string;
  command: string;
  message: string;
  lock: string;
  model: string;
  mode: string;
  timeoutMinutes?: number | null;
  maxRuns: number;
  capture?: { verdict: string | { lastLineRegex: string; group: number } } | null;
  runIf: string;
  completeIf: string;
}
export interface PipelineAttempt {
  id: string;
  round: number;
  started_at: number;
  finished_at: number | null;
  session_id: string | null;
  exit_code: number | null;
  output: string;
  outcome: string;
}
export interface PipelineStepState {
  status: string;
  runs: number;
  verdict: string | null;
  error: string | null;
  attempts: PipelineAttempt[];
}
export interface PipelineRun {
  id: string;
  state: string;
  revision: number;
  backend: string;
  reviewer: string;
  project_id: string;
  package_root: string;
  run_root: string;
  repositories: { name: string; path: string; branch: string }[];
  issues: { code: string; detail: string; blocking: boolean }[];
  manifest: {
    name: string;
    description: string;
    steps: PipelineStep[];
    settings: { agentTimeoutMinutes: number; shellTimeoutMinutes: number };
  };
  steps: Record<string, PipelineStepState>;
}
export interface PipelineSummary {
  id: string;
  name: string;
  state: string;
  revision: number;
  total: number;
  completed: number;
  issue_count: number;
  attention: string;
  project_id: string;
  notify_human: boolean;
}
export const agentPipelineIpc = {
  import: (path: string) => invoke<PipelineRun>('agent_pipeline_import', { path }),
  list: () => invoke<PipelineSummary[]>('agent_pipelines'),
  get: (id: string) => invoke<PipelineRun>('agent_pipeline_get', { id }),
  control: (
    run: PipelineRun,
    action: string,
    stepId?: string,
    backend = run.backend,
    reviewer = run.reviewer,
  ) =>
    invoke<PipelineRun>('agent_pipeline_control', {
      id: run.id,
      revision: run.revision,
      action,
      stepId,
      backend,
      reviewer,
    }),
};
