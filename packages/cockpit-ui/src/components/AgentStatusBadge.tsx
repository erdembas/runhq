import { Circle, CircleCheck, CircleHelp, Loader2, OctagonX, ShieldQuestion } from 'lucide-react';
import type { AgentStatus } from '@runhq/cockpit-types';

import { AGENT_STATUS_LABELS } from './agentStatus';

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const waiting = status === 'waiting_input' || status === 'waiting_permission';
  const spinning = status === 'running' || status === 'starting' || status === 'cancelling';
  const Icon = spinning
    ? Loader2
    : status === 'waiting_input'
      ? CircleHelp
      : status === 'waiting_permission'
        ? ShieldQuestion
        : status === 'completed'
          ? CircleCheck
          : status === 'failed' || status === 'interrupted'
            ? OctagonX
            : Circle;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] ${waiting ? 'text-accent' : status === 'failed' ? 'text-status-error' : status === 'completed' ? 'text-status-running' : 'text-fg-muted'}`}
    >
      <Icon className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`} aria-hidden />
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}
