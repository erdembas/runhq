import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { ipc } from '@/lib/ipc';
import type { AiProvider, ChatMessage } from '@/types';
import type { Turn } from '../chatPanelTypes';
import { CONTINUE_PROMPT, NUDGE_FINAL_ANSWER_PROMPT, SYSTEM_PROMPT } from './constants';

interface Args {
  activeConversationId: string | null;
  cancel: () => void;
  contextSystemMessage: string | null;
  getActionHook: (convId?: string | null) => Turn['actionHook'] | null;
  getSurfaceContext: (convId?: string | null) => string | null;
  input: string;
  loadedConversationIdRef: MutableRefObject<string | null>;
  persistUserMessage: (turn: Turn, conversationId: string) => Promise<void>;
  provider: AiProvider | null;
  runStream: (args: {
    targetTurnId: string;
    targetConvId: string;
    history: ChatMessage[];
    appendOnly: boolean;
    retryAttempt?: number;
    providerOverride?: AiProvider;
  }) => Promise<void>;
  sendRef: MutableRefObject<
    ((overrideText?: string, providerOverride?: AiProvider) => Promise<void>) | null
  >;
  setActiveConversation: (id: string | null) => void;
  setInput: (value: string) => void;
  setProviderError: (value: string | null) => void;
  setTurns: (updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  setTurnsForConv: (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  turns: Turn[];
}

export function useAiChatSending(args: Args) {
  const send = useCallback(
    async (overrideText?: string, providerOverride?: AiProvider) => {
      const text = (overrideText ?? args.input).trim();
      if (!text) return;
      const activeProvider = providerOverride ?? args.provider;
      if (!activeProvider) {
        args.setProviderError('No AI provider configured. Add one from Settings → AI.');
        return;
      }

      args.cancel();
      args.setInput('');
      let convId = args.activeConversationId;
      if (!convId) {
        try {
          convId = await ipc.createConversation({
            title: text.slice(0, 60),
            origin: 'free',
            context_json: null,
          });
          args.loadedConversationIdRef.current = convId;
          args.setActiveConversation(convId);
        } catch (e) {
          args.setProviderError(
            `Couldn't start conversation: ${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        }
      }

      const userTurn: Turn = { id: `u-${Date.now()}`, role: 'user', content: text };
      const startedAt = Date.now();
      const assistantTurn: Turn = {
        id: `a-${startedAt}`,
        role: 'assistant',
        content: '',
        streaming: true,
        streamStartedAtMs: startedAt,
        reasoningStartedAtMs: startedAt,
        providerName: activeProvider.name,
        modelName: activeProvider.model || undefined,
        actionHook: args.getActionHook(convId) ?? undefined,
      };
      const history = buildHistory({
        contextSystemMessage: args.contextSystemMessage,
        getSurfaceContext: args.getSurfaceContext,
        convId,
        turns: args.turns,
      });
      history.push({ role: 'user', content: text });
      args.setTurnsForConv(convId, (prev) => [...prev, userTurn, assistantTurn]);
      void args.persistUserMessage(userTurn, convId);
      await args.runStream({
        targetTurnId: assistantTurn.id,
        targetConvId: convId,
        history,
        appendOnly: false,
        providerOverride,
      });
    },
    [args],
  );
  args.sendRef.current = send;

  const continueTruncated = useCallback(async () => {
    if (!args.provider || !args.activeConversationId) return;
    const target = [...args.turns]
      .reverse()
      .find(
        (t) =>
          t.role === 'assistant' &&
          !t.streaming &&
          !t.error &&
          (t.finishReason === 'length' || t.finishReason === 'timeout' || t.partial === true),
      );
    if (!target) return;
    args.cancel();
    const reasoningHeavy =
      target.finishReason !== 'length' &&
      target.finishReason !== 'timeout' &&
      (target.reasoning?.trim().length ?? 0) >= 200 &&
      target.content.trim().length < 80;
    const history = buildHistory({
      contextSystemMessage: args.contextSystemMessage,
      getSurfaceContext: args.getSurfaceContext,
      convId: args.activeConversationId,
      turns: args.turns,
    });
    history.push({
      role: 'user',
      content: reasoningHeavy ? NUDGE_FINAL_ANSWER_PROMPT : CONTINUE_PROMPT,
    });
    args.setTurns((prev) =>
      prev.map((t) =>
        t.id === target.id ? { ...t, streaming: true, finishReason: null, partial: false } : t,
      ),
    );
    await args.runStream({
      targetTurnId: target.id,
      targetConvId: args.activeConversationId,
      history,
      appendOnly: true,
    });
  }, [args]);

  return { continueTruncated, send };
}

function buildHistory(args: {
  contextSystemMessage: string | null;
  getSurfaceContext: (convId?: string | null) => string | null;
  convId: string;
  turns: Turn[];
}) {
  const history: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (args.contextSystemMessage)
    history.push({ role: 'system', content: args.contextSystemMessage });
  const surface = args.getSurfaceContext(args.convId);
  if (surface) history.push({ role: 'system', content: surface });
  for (const turn of args.turns) {
    if (!turn.error) history.push({ role: turn.role, content: turn.content });
  }
  return history;
}
