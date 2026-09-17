import type { AgentSession, AgentTurnInput, CreateAgentSession } from '@runhq/cockpit-types';

/** Retain the created workspace and request ID if the first send needs a retry. */
export function createAgentTaskLauncher(deps: {
  create: (input: CreateAgentSession) => Promise<AgentSession>;
  start: (input: AgentTurnInput) => Promise<AgentSession>;
  created: (session: AgentSession, text: string) => void;
}) {
  let session: AgentSession | null = null;
  let turn: AgentTurnInput | null = null;
  let pending: Promise<AgentSession> | null = null;
  return {
    get session() {
      return session;
    },
    send(input: CreateAgentSession, text: string): Promise<AgentSession> {
      if (pending) return pending;
      if (!text.trim()) return Promise.reject(new Error('Write a message to start a task.'));
      pending = (async () => {
        if (!session) {
          session = await deps.create(input);
          turn = {
            session_id: session.id,
            request_id: crypto.randomUUID(),
            prompt: text,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            agent: session.agent,
          };
          deps.created(session, text);
        }
        return deps.start(turn!);
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
