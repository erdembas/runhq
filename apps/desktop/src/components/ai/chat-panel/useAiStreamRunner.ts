import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { ipc } from '@/lib/ipc';
import type { AiProvider, StreamChunk } from '@/types';
import type { Turn } from '../chatPanelTypes';
import { handleDone, handleStreamError, safeDebugFlag } from './streamHandlers';
import type { RunStreamFn } from './useAiChatState';

interface Args {
  activeConversationId: string | null;
  bumpRequestId: (convId: string) => number;
  getPersistedSet: (convId: string) => Set<string>;
  inFlightConvsRef: MutableRefObject<Set<string>>;
  provider: AiProvider | null;
  requestIdsRef: MutableRefObject<Map<string, number>>;
  runStreamRef: MutableRefObject<RunStreamFn | null>;
  setProviderError: (value: string | null) => void;
  setTurnsForConv: (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  startedAtRef: MutableRefObject<number | null>;
}

export function useAiStreamRunner({
  activeConversationId,
  bumpRequestId,
  getPersistedSet,
  inFlightConvsRef,
  provider,
  requestIdsRef,
  runStreamRef,
  setProviderError,
  setTurnsForConv,
  startedAtRef,
}: Args) {
  const persistAssistantTurnRef = useRef<((turn: Turn, convId: string) => Promise<void>) | null>(
    null,
  );

  const persistUserMessage = useCallback(
    async (turn: Turn, conversationId: string) => {
      const persisted = getPersistedSet(conversationId);
      if (persisted.has(turn.id)) return;
      persisted.add(turn.id);
      try {
        await ipc.appendConversationMessage({
          conversation_id: conversationId,
          client_id: turn.id,
          role: 'user',
          content: turn.content,
        });
      } catch (e) {
        console.error('persistUserMessage failed:', e);
        persisted.delete(turn.id);
      }
    },
    [getPersistedSet],
  );

  const persistAssistantTurn = useCallback(async (turn: Turn, conversationId: string) => {
    try {
      await ipc.appendConversationMessage({
        conversation_id: conversationId,
        client_id: turn.id,
        role: 'assistant',
        content: turn.content,
        reasoning: turn.reasoning ?? null,
        provider_name: turn.providerName ?? null,
        model_name: turn.modelName ?? null,
        finish_reason: turn.finishReason ?? null,
        partial: turn.partial ?? false,
        error: turn.error ?? null,
      });
    } catch (e) {
      console.error('persistAssistantTurn failed:', e);
    }
  }, []);
  persistAssistantTurnRef.current = persistAssistantTurn;

  const cancelFor = useCallback(
    (convId: string | null) => {
      if (!convId) return;
      bumpRequestId(convId);
      inFlightConvsRef.current.delete(convId);
      setTurnsForConv(convId, (prev) =>
        prev.map((turn) => {
          if (!turn.streaming) return turn;
          const next = {
            ...turn,
            streaming: false,
            partial: turn.role === 'assistant' ? true : turn.partial,
          };
          if (next.role === 'assistant' && next.content.trim().length > 0) {
            Promise.resolve().then(() => {
              void persistAssistantTurnRef.current?.(next, convId);
            });
          }
          return next;
        }),
      );
    },
    [bumpRequestId, inFlightConvsRef, setTurnsForConv],
  );

  const cancel = useCallback(
    () => cancelFor(activeConversationId),
    [activeConversationId, cancelFor],
  );

  const runStream = useCallback<RunStreamFn>(
    async ({
      targetTurnId,
      targetConvId,
      history,
      appendOnly,
      retryAttempt = 0,
      providerOverride,
    }) => {
      const activeProvider = providerOverride ?? provider;
      if (!activeProvider) {
        setProviderError('No AI provider configured. Add one from Settings → AI.');
        return;
      }

      const requestId = bumpRequestId(targetConvId);
      const isStillCurrent = () => requestIdsRef.current.get(targetConvId) === requestId;
      inFlightConvsRef.current.add(targetConvId);
      startedAtRef.current = performance.now();
      const streamStart = performance.now();
      const debugAi = safeDebugFlag();
      const debug = (event: string, payload?: Record<string, unknown>) => {
        if (debugAi) {
          console.debug(
            `[ai.stream:${targetTurnId.slice(0, 8)}] +${Math.round(performance.now() - streamStart)}ms ${event}`,
            payload ?? {},
          );
        }
      };

      let sawAnyDelta = false;
      let deltaCount = 0;
      let reasoningChunkCount = 0;
      let firstDeltaAt: number | null = null;
      let lastDeltaAt: number | null = null;
      debug('begin', {
        appendOnly,
        retryAttempt,
        historyMessages: history.length,
        provider: activeProvider.name,
        model: activeProvider.model,
      });

      const onChunk = (chunk: StreamChunk) => {
        if (!isStillCurrent()) return;
        if (chunk.type === 'delta') {
          sawAnyDelta = true;
          deltaCount += 1;
          const nowPerf = performance.now();
          firstDeltaAt ??= nowPerf;
          lastDeltaAt = nowPerf;
          const now = Date.now();
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((turn) =>
              turn.id === targetTurnId
                ? {
                    ...turn,
                    content: turn.content + chunk.text,
                    reasoningEndedAtMs:
                      !appendOnly &&
                      turn.reasoningStartedAtMs !== undefined &&
                      turn.reasoningEndedAtMs === undefined
                        ? now
                        : turn.reasoningEndedAtMs,
                  }
                : turn,
            ),
          );
          return;
        }
        if (chunk.type === 'reasoning') {
          if (appendOnly) return;
          reasoningChunkCount += 1;
          const now = Date.now();
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((turn) =>
              turn.id === targetTurnId
                ? {
                    ...turn,
                    reasoning: (turn.reasoning ?? '') + chunk.text,
                    reasoningStartedAtMs: turn.reasoningStartedAtMs ?? now,
                  }
                : turn,
            ),
          );
          return;
        }
        if (chunk.type === 'reclassify_as_reasoning') {
          if (appendOnly) return;
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((turn) =>
              turn.id === targetTurnId
                ? {
                    ...turn,
                    reasoning: (turn.reasoning ?? '') + turn.content,
                    content: '',
                    reasoningStartedAtMs:
                      turn.reasoningStartedAtMs ?? turn.streamStartedAtMs ?? Date.now(),
                  }
                : turn,
            ),
          );
          return;
        }
        if (chunk.type === 'done') {
          handleDone({
            appendOnly,
            chunk,
            debug,
            deltaCount,
            firstDeltaAt,
            history,
            lastDeltaAt,
            persistAssistantTurnRef,
            reasoningChunkCount,
            retryAttempt,
            runStreamRef,
            sawAnyDelta,
            setTurnsForConv,
            streamStart,
            targetConvId,
            targetTurnId,
            inFlightConvsRef,
          });
          return;
        }
        if (chunk.type === 'error') {
          handleStreamError({
            appendOnly,
            chunkMessage: chunk.message,
            history,
            inFlightConvsRef,
            persistAssistantTurnRef,
            retryAttempt,
            runStreamRef,
            setTurnsForConv,
            targetConvId,
            targetTurnId,
          });
        }
      };

      try {
        await ipc.aiChatCompletionStream(
          { provider_id: activeProvider.id, messages: history, options: { temperature: 0.4 } },
          onChunk,
        );
      } catch (e) {
        if (!isStillCurrent()) return;
        handleStreamError({
          appendOnly,
          chunkMessage: e instanceof Error ? e.message : String(e),
          history,
          inFlightConvsRef,
          persistAssistantTurnRef,
          retryAttempt: 1,
          runStreamRef,
          setTurnsForConv,
          targetConvId,
          targetTurnId,
        });
      }
    },
    [
      bumpRequestId,
      inFlightConvsRef,
      provider,
      requestIdsRef,
      runStreamRef,
      setProviderError,
      setTurnsForConv,
      startedAtRef,
    ],
  );
  runStreamRef.current = runStream;

  return { cancel, cancelFor, persistAssistantTurn, persistUserMessage, runStream };
}
