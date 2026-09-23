import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentSession } from '@runhq/cockpit-types';

/**
 * Turn timing is RunHQ's own measurement: providers report tokens, not duration. A turn interrupted
 * by a crash is never counted, so a task can show completed turns but no active one.
 */
export function agentElapsedMs(session: AgentSession, now: number): number | null {
  if (!session.turn_started_at) return null;
  return Math.max(0, now - session.turn_started_at);
}

/** Compact, non-misleading duration: whole units only, because the source clock is coarse. */
export function formatAgentDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return i18n.t('{seconds}s', { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return i18n.t('{minutes}m {value2}s', { minutes: minutes, value2: seconds % 60 });
  const hours = Math.floor(minutes / 60);
  return i18n.t('{hours}h {value2}m', { hours: hours, value2: minutes % 60 });
}

/**
 * What the usage table shows for one task: the running turn when there is one, otherwise the last
 * completed turn, plus the total across completed turns.
 */
export function agentTaskTiming(session: AgentSession, now: number) {
  const running = agentElapsedMs(session, now);
  return {
    running,
    current: formatAgentDuration(running ?? session.last_turn_ms),
    isRunning: running !== null,
    total: formatAgentDuration(session.total_run_ms || null),
  };
}
