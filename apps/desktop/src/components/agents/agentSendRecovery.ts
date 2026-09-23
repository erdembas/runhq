import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentSession, AgentTurnInput } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { createAgentRecoveryPersistence } from '@/lib/agentRecoveryPersistence';
import { isAgentQueueRecord } from './agentTurnQueue';
import type { AgentInitialTaskPersistence, AgentInitialTaskRecovery } from './agentTaskLauncher';

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isTurn = (value: unknown): value is AgentTurnInput =>
  isObject(value) &&
  typeof value.session_id === 'string' &&
  isAgentQueueRecord({ [value.session_id]: [{ ...value, state: 'queued' }] });

export function isInitialAgentTaskRecoveryRecord(
  value: unknown,
): value is Record<string, AgentInitialTaskRecovery> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([projectId, record]) =>
        isObject(record) &&
        record.projectId === projectId &&
        typeof record.creationRequestId === 'string' &&
        !!record.creationRequestId &&
        typeof record.requestId === 'string' &&
        !!record.requestId &&
        typeof record.text === 'string' &&
        typeof record.draftText === 'string' &&
        isObject(record.input) &&
        record.input.project_id === projectId &&
        ['creating', 'ready', 'sending', 'accepted'].includes(String(record.phase)) &&
        (record.sourceSessionId === undefined || typeof record.sourceSessionId === 'string') &&
        isTurn({
          session_id: 'pending-creation',
          request_id: record.requestId,
          prompt: record.text,
          model: '',
          effort: '',
          attachments: record.attachments,
        }) &&
        (record.phase === 'creating'
          ? record.session === null && record.turn === null
          : isObject(record.session) &&
            typeof record.session.id === 'string' &&
            isTurn(record.turn) &&
            record.turn.session_id === record.session.id),
    )
  );
}

interface RecordPersistence<T> {
  load: (fallback: Record<string, T>) => { data: Record<string, T>; error: string | null };
  save: (data: Record<string, T>) => string | null;
}

/** Keep newly discovered session identity in memory even if a later disk write fails. */
export function createAgentSendRecordStore<T>(persistence: RecordPersistence<T>) {
  const loaded = persistence.load({});
  let records = loaded.data;
  return {
    load(id: string): T | null {
      if (loaded.error) throw new Error(loaded.error);
      return records[id] ?? null;
    },
    save(record: T | null, id: string) {
      const next = { ...records };
      if (record === null) delete next[id];
      else next[id] = record;
      const error = persistence.save(next);
      if (!error || record !== null) records = next;
      if (error) throw new Error(error);
      loaded.error = null;
    },
  };
}

export const initialAgentTaskRecovery: AgentInitialTaskPersistence = createAgentSendRecordStore(
  createAgentRecoveryPersistence('runhq.agent-first-send.v1', isInitialAgentTaskRecoveryRecord),
);

export interface AgentDirectSendRecovery {
  turn: AgentTurnInput;
  accepted?: AgentSession;
}
function isDirectRecord(value: unknown): value is Record<string, AgentDirectSendRecovery> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([id, record]) =>
        isObject(record) &&
        isTurn(record.turn) &&
        record.turn.session_id === id &&
        (record.accepted === undefined || (isObject(record.accepted) && record.accepted.id === id)),
    )
  );
}

const turnIdentity = (turn: AgentTurnInput) =>
  JSON.stringify([
    turn.session_id,
    turn.prompt,
    turn.model,
    turn.effort,
    turn.mode ?? 'default',
    turn.agent ?? '',
    (turn.attachments ?? []).map(({ name, mime_type, data }) => [name, mime_type, data]),
  ]);

export function createRecoverableAgentSender(deps: {
  start: (input: AgentTurnInput) => Promise<AgentSession>;
  recovery: {
    load: (id: string) => AgentDirectSendRecovery | null;
    save: (record: AgentDirectSendRecovery | null, id: string) => void;
  };
}) {
  const pending = new Map<string, { identity: string; promise: Promise<AgentSession> }>();
  return {
    recovered: deps.recovery.load,
    /** The UI may explicitly discard an uncertain send after reviewing its conversation. */
    discard: (id: string) => deps.recovery.save(null, id),
    /** Called only after the caller has saved its accepted-turn UI/context changes. */
    complete: (id: string) => {
      const record = deps.recovery.load(id);
      if (record && !record.accepted)
        throw new Error(i18n.t('Review the unconfirmed send before completing recovery.'));
      deps.recovery.save(null, id);
    },
    send(input: AgentTurnInput): Promise<AgentSession> {
      const current = pending.get(input.session_id);
      if (current)
        return current.identity === turnIdentity(input)
          ? current.promise
          : Promise.reject(
              new Error(i18n.t('Another message is already being sent to this task.')),
            );
      const run = (async () => {
        const previous = deps.recovery.load(input.session_id);
        const same = previous && turnIdentity(previous.turn) === turnIdentity(input);
        if (previous && !same && !previous.accepted)
          throw new Error(
            i18n.t(
              'A previous message has an unconfirmed send. Review the conversation and retry the original message before sending different text.',
            ),
          );
        const record: AgentDirectSendRecovery = same ? previous : { turn: input };
        deps.recovery.save(record, input.session_id);
        const result = record.accepted ?? (await deps.start(record.turn));
        deps.recovery.save({ ...record, accepted: result }, input.session_id);
        return result;
      })().finally(() => pending.delete(input.session_id));
      pending.set(input.session_id, { identity: turnIdentity(input), promise: run });
      return run;
    },
  };
}

export const recoverableAgentSender = createRecoverableAgentSender({
  start: ipc.agentStart,
  recovery: createAgentSendRecordStore(
    createAgentRecoveryPersistence('runhq.agent-direct-send.v1', isDirectRecord),
  ),
});
export const startAgentTurnRecoverably = (input: AgentTurnInput) =>
  recoverableAgentSender.send(input);
