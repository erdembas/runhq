import type { AgentStatus } from '@runhq/cockpit-types';

export const agentIsActive = (status: AgentStatus) =>
  ['starting', 'running', 'waiting_input', 'waiting_permission', 'cancelling'].includes(status);
export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Ready',
  starting: 'Starting',
  running: 'Working',
  waiting_input: 'Needs your answer',
  waiting_permission: 'Needs approval',
  cancelling: 'Stopping',
  completed: 'Response ready',
  failed: 'Failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
};
