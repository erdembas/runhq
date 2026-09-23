import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';

const replies = new Set<string>();

/** Revalidate live requests so a closed permission cannot be answered from stale UI. */
export async function answerPendingAgentRequest(
  sessionId: string,
  requestId: string,
  value: unknown,
) {
  const key = JSON.stringify([sessionId, requestId]);
  const session = useAgentStore.getState().sessions[sessionId];
  if (
    !session?.pending.some((request) => request.id === requestId) ||
    session.status === 'cancelling'
  )
    throw new Error(
      i18n.t(
        'This request is no longer waiting for an answer. Open the conversation to see its current state.',
      ),
    );
  if (replies.has(key)) throw new Error(i18n.t('This answer is already being sent.'));
  replies.add(key);
  try {
    await ipc.agentAnswer(sessionId, requestId, value);
    await useAgentStore.getState().refresh(true);
  } finally {
    replies.delete(key);
  }
}
