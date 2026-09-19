import type { AgentSession } from '@runhq/cockpit-types';

export function agentSessionIsHistoryOnly(session: Pick<AgentSession, 'runtime_state'>) {
  const state = session.runtime_state;
  return (
    !!state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    'history_only' in state &&
    state.history_only === true
  );
}

export function agentComposerContent(text: string, contextCount: number, contextReady: boolean) {
  return contextReady && (!!text.trim() || contextCount > 0);
}

export function agentCanSteer(
  session: AgentSession,
  text: string,
  contextCount: number,
  contextReady: boolean,
) {
  return (
    (session.adapter || session.backend) === 'codex' &&
    session.status === 'running' &&
    !session.archived &&
    !agentSessionIsHistoryOnly(session) &&
    contextReady &&
    contextCount === 0 &&
    !!text.trim()
  );
}
