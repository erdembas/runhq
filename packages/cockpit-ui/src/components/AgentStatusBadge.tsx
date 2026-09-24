'use client';

import * as i18n from '../i18n';
import {
  Circle,
  CircleCheck,
  CircleHelp,
  Loader2,
  OctagonX,
  Pause,
  ShieldQuestion,
} from 'lucide-react';
import type { AgentStatus, AgentSession } from '@runhq/cockpit-types';

import { AGENT_STATUS_LABELS } from './agentStatus';

export function AgentStatusBadge({
  status,
  pauseState,
}: {
  status: AgentStatus;
  pauseState?: AgentSession['pause_state'];
}) {
  i18n.useLocale();
  const paused = pauseState === 'paused';
  const pausing = pauseState === 'pausing';
  const waiting = status === 'waiting_input' || status === 'waiting_permission';
  const spinning =
    !paused &&
    (pausing || status === 'running' || status === 'starting' || status === 'cancelling');
  const Icon = paused
    ? Pause
    : spinning
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
      {paused ? i18n.t('Paused') : pausing ? i18n.t('Pausing…') : AGENT_STATUS_LABELS[status]}
    </span>
  );
}
