import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type {
  AgentAttachment,
  AgentSession,
  AgentTurnInput,
  CreateAgentSession,
} from '@runhq/cockpit-types';
import type { AgentTaskStartDependency } from './agentTaskStart';

export interface AgentInitialTaskRecovery {
  projectId: string;
  creationRequestId: string;
  requestId: string;
  input: CreateAgentSession;
  text: string;
  draftText: string;
  attachments?: AgentAttachment[];
  sourceSessionId?: string;
  startAfter?: AgentTaskStartDependency;
  phase: 'creating' | 'ready' | 'sending' | 'accepted';
  session: AgentSession | null;
  turn: AgentTurnInput | null;
}

export interface AgentInitialTaskPersistence {
  load: (projectId: string) => AgentInitialTaskRecovery | null;
  save: (record: AgentInitialTaskRecovery | null, projectId: string) => void;
}

/** Retain the created workspace and request ID if the first send needs a retry. */
export function createAgentTaskLauncher(deps: {
  create: (input: CreateAgentSession, sourceSessionId?: string) => Promise<AgentSession>;
  start: (input: AgentTurnInput) => Promise<AgentSession>;
  queue?: (input: AgentTurnInput, startAfter: AgentTaskStartDependency) => Promise<AgentSession>;
  created: (session: AgentSession, text: string) => void;
  recovery?: AgentInitialTaskPersistence;
}) {
  let session: AgentSession | null = null;
  let turn: AgentTurnInput | null = null;
  let pending: Promise<AgentSession> | null = null;
  let recovery: AgentInitialTaskRecovery | null = null;
  let restoredProject: string | null = null;
  const persist = () => {
    if (recovery) deps.recovery?.save(recovery, recovery.projectId);
  };
  const restore = (projectId: string) => {
    if (!deps.recovery || restoredProject === projectId || pending) return recovery;
    const saved = deps.recovery.load(projectId);
    restoredProject = projectId;
    recovery = saved;
    session = saved?.session ?? null;
    turn = saved?.turn ?? null;
    return recovery;
  };
  return {
    get session() {
      return session;
    },
    get recovery() {
      return recovery;
    },
    restore,
    /** Clear only after every post-launch save/link has succeeded. */
    complete() {
      if (pending)
        throw new Error(i18n.t('Wait for the first message before completing this task.'));
      if (recovery) deps.recovery?.save(null, recovery.projectId);
      recovery = null;
      session = null;
      turn = null;
    },
    send(
      input: CreateAgentSession,
      text: string,
      attachments?: AgentAttachment[],
      metadata?: {
        sourceSessionId?: string;
        draftText?: string;
        startAfter?: AgentTaskStartDependency;
      },
    ): Promise<AgentSession> {
      if (pending) return pending;
      try {
        restore(input.project_id);
      } catch (error) {
        return Promise.reject(error);
      }
      if (!text.trim())
        return Promise.reject(new Error(i18n.t('Write a message to start a task.')));
      pending = (async () => {
        if (deps.recovery && !recovery) {
          recovery = {
            projectId: input.project_id,
            creationRequestId: input.creation_request_id || crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            input,
            text,
            draftText: metadata?.draftText ?? text,
            attachments,
            sourceSessionId: metadata?.sourceSessionId,
            startAfter: metadata?.startAfter,
            phase: 'creating',
            session: null,
            turn: null,
          };
        }
        // Record creation intent BEFORE IPC. The backend uses the same creation id
        // after a lost acknowledgement, including isolated worktree creation.
        persist();
        if (recovery?.phase === 'accepted' && recovery.session) return recovery.session;
        if (!session) {
          const createInput = recovery
            ? { ...recovery.input, creation_request_id: recovery.creationRequestId }
            : input;
          session = await deps.create(
            createInput,
            recovery?.sourceSessionId ?? metadata?.sourceSessionId,
          );
          turn = {
            session_id: session.id,
            request_id: recovery?.requestId ?? crypto.randomUUID(),
            prompt: recovery?.text ?? text,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            agent: session.agent,
            attachments: recovery?.attachments ?? attachments,
          };
          if (recovery) recovery = { ...recovery, phase: 'ready', session, turn };
          persist();
          deps.created(session, turn.prompt);
        }
        if (recovery) recovery = { ...recovery, phase: 'sending' };
        persist();
        const startAfter = recovery ? recovery.startAfter : metadata?.startAfter;
        if (startAfter && !deps.queue)
          throw new Error(
            i18n.t('Could not save the queued task. Retry saving before continuing.'),
          );
        const result = startAfter ? await deps.queue!(turn!, startAfter) : await deps.start(turn!);
        session = result;
        if (recovery) recovery = { ...recovery, phase: 'accepted', session: result };
        persist();
        return result;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
