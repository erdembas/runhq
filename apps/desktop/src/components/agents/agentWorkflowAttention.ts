import type { AgentWorkflow } from '@/lib/ipc/agentWorkflowIpc';
import { workflowReviewNeedsDecision } from './agentWorkflowGraph';

export interface WorkflowAttentionEntry {
  workflow: AgentWorkflow;
  kind: 'human' | 'review' | 'blocked' | 'failed' | 'apply';
  detail: string | null;
}

const failedStages = new Set([
  'launch_failed',
  'launch_paused',
  'setup_failed',
  'implementation_failed',
  'review_failed',
  'checks_failed',
  'integration_failed',
  'interrupted',
]);

/** Only actionable workflow states belong in Attention. Ordinary dependency waits do not. */
export function collectWorkflowAttention(workflows: AgentWorkflow[]): WorkflowAttentionEntry[] {
  return workflows
    .flatMap((workflow): WorkflowAttentionEntry[] => {
      if (workflow.cleaned || ['integrated', 'cancelled', 'completed'].includes(workflow.stage))
        return [];
      const human = workflow.steps.find(
        (step) => step.role === 'human' && step.status === 'awaiting_approval',
      );
      if (human) return [{ workflow, kind: 'human', detail: human.prompt || null }];
      const review = workflow.steps.find(workflowReviewNeedsDecision);
      if (review || workflow.stage === 'awaiting_review')
        return [{ workflow, kind: 'review', detail: review?.review_summary || null }];
      const blocked = workflow.steps.find(
        (step) => step.merge?.status === 'conflict' || step.status === 'blocked',
      );
      if (blocked)
        return [{ workflow, kind: 'blocked', detail: blocked.merge?.conflict || blocked.error }];
      const failed = workflow.steps.find((step) => step.status === 'failed');
      if (failedStages.has(workflow.stage) || failed)
        return [{ workflow, kind: 'failed', detail: workflow.error || failed?.error || null }];
      if (workflow.stage === 'ready' && workflow.context?.workspace_mode !== 'direct')
        return [{ workflow, kind: 'apply', detail: null }];
      return [];
    })
    .sort((left, right) => left.workflow.updated_at - right.workflow.updated_at);
}

export function filterWorkflowAttention(
  entries: WorkflowAttentionEntry[],
  { projectId, search = '' }: { projectId?: string; search?: string },
  projectName: (id: string) => string,
): WorkflowAttentionEntry[] {
  const query = search.trim().toLocaleLowerCase();
  return entries.filter(
    ({ workflow, detail }) =>
      (!projectId || workflow.project_id === projectId) &&
      (!query ||
        `${workflow.title} ${workflow.objective} ${projectName(workflow.project_id)} ${detail || ''}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}
