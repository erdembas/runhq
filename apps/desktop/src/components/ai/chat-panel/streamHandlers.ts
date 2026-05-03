import type { MutableRefObject } from 'react';
import type { ChatMessage, StreamChunk } from '@/types';
import type { Turn } from '../chatPanelTypes';
import { CONTINUE_PROMPT, NUDGE_FINAL_ANSWER_PROMPT } from './constants';
import type { RunStreamFn } from './useAiChatState';

export function handleDone(args: {
  appendOnly: boolean;
  chunk: Extract<StreamChunk, { type: 'done' }>;
  debug: (event: string, payload?: Record<string, unknown>) => void;
  deltaCount: number;
  firstDeltaAt: number | null;
  history: ChatMessage[];
  inFlightConvsRef: MutableRefObject<Set<string>>;
  lastDeltaAt: number | null;
  persistAssistantTurnRef: MutableRefObject<((turn: Turn, convId: string) => Promise<void>) | null>;
  reasoningChunkCount: number;
  retryAttempt: number;
  runStreamRef: MutableRefObject<RunStreamFn | null>;
  sawAnyDelta: boolean;
  setTurnsForConv: (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  streamStart: number;
  targetConvId: string;
  targetTurnId: string;
}) {
  const now = Date.now();
  let triggerRetry = false;
  let triggerAutoContinue = false;
  let triggerNudgeAnswer = false;
  let contentSnapshot = '';
  let finalised: Turn | null = null;
  args.debug('done', {
    finish_reason: args.chunk.finish_reason ?? null,
    delta_count: args.deltaCount,
    reasoning_chunk_count: args.reasoningChunkCount,
    time_to_first_delta_ms:
      args.firstDeltaAt !== null ? Math.round(args.firstDeltaAt - args.streamStart) : null,
    time_since_last_delta_ms:
      args.lastDeltaAt !== null ? Math.round(performance.now() - args.lastDeltaAt) : null,
    saw_any_delta: args.sawAnyDelta,
  });
  args.setTurnsForConv(args.targetConvId, (prev) =>
    prev.map((turn) => {
      if (turn.id !== args.targetTurnId) return turn;
      const nextContent =
        args.appendOnly && !args.sawAnyDelta && args.chunk.content.length > 0
          ? turn.content + args.chunk.content
          : args.chunk.content.length > turn.content.length
            ? args.chunk.content
            : turn.content;
      const reason = args.chunk.finish_reason ?? null;
      const bodyLen = nextContent.trim().length;
      const reasoningLen = (args.chunk.reasoning ?? turn.reasoning ?? '').trim().length;
      const answerHidden =
        reason === 'stop' && bodyLen < 80 && reasoningLen >= 200 && bodyLen * 4 < reasoningLen;
      const isPartial = reason === 'length' || reason === 'timeout' || answerHidden;
      if (args.retryAttempt === 0 && reason === 'timeout' && !args.appendOnly && bodyLen < 40) {
        triggerRetry = true;
      } else if (
        args.retryAttempt === 0 &&
        reason === 'timeout' &&
        !args.appendOnly &&
        bodyLen >= 40
      ) {
        triggerAutoContinue = true;
        contentSnapshot = nextContent;
      } else if (args.retryAttempt === 0 && !args.appendOnly && answerHidden) {
        triggerNudgeAnswer = true;
        contentSnapshot = nextContent;
      }
      const recovering = triggerRetry || triggerAutoContinue || triggerNudgeAnswer;
      const next: Turn = {
        ...turn,
        content: triggerRetry ? turn.content : nextContent,
        reasoning:
          !args.appendOnly && (args.chunk.reasoning?.length ?? 0) > (turn.reasoning?.length ?? 0)
            ? (args.chunk.reasoning ?? turn.reasoning)
            : turn.reasoning,
        reasoningEndedAtMs:
          !args.appendOnly &&
          turn.reasoningStartedAtMs !== undefined &&
          turn.reasoningEndedAtMs === undefined
            ? now
            : turn.reasoningEndedAtMs,
        streaming: recovering,
        finishReason: recovering ? null : reason,
        partial: recovering ? false : isPartial || turn.partial,
      };
      if (!recovering) finalised = next;
      return next;
    }),
  );
  if (finalised) {
    const snap = finalised;
    args.inFlightConvsRef.current.delete(args.targetConvId);
    Promise.resolve().then(
      () => void args.persistAssistantTurnRef.current?.(snap, args.targetConvId),
    );
  }
  if (triggerRetry) retryFromScratch(args);
  else if (triggerAutoContinue || triggerNudgeAnswer) {
    continueStream(args, contentSnapshot, triggerNudgeAnswer);
  }
}

export function handleStreamError(args: {
  appendOnly: boolean;
  chunkMessage: string;
  history: ChatMessage[];
  inFlightConvsRef: MutableRefObject<Set<string>>;
  persistAssistantTurnRef: MutableRefObject<((turn: Turn, convId: string) => Promise<void>) | null>;
  retryAttempt: number;
  runStreamRef: MutableRefObject<RunStreamFn | null>;
  setTurnsForConv: (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  targetConvId: string;
  targetTurnId: string;
}) {
  let recover = false;
  let snapshot = '';
  let finalised: Turn | null = null;
  args.setTurnsForConv(args.targetConvId, (prev) =>
    prev.map((turn) => {
      if (turn.id !== args.targetTurnId) return turn;
      if (args.retryAttempt === 0 && !args.appendOnly && turn.content.trim().length >= 40) {
        recover = true;
        snapshot = turn.content;
        return { ...turn, streaming: true, error: undefined, partial: false };
      }
      const next = { ...turn, streaming: false, error: args.chunkMessage, partial: true };
      finalised = next;
      return next;
    }),
  );
  if (finalised) {
    const snap = finalised;
    args.inFlightConvsRef.current.delete(args.targetConvId);
    Promise.resolve().then(
      () => void args.persistAssistantTurnRef.current?.(snap, args.targetConvId),
    );
  }
  if (recover) {
    void args.runStreamRef.current?.({
      targetTurnId: args.targetTurnId,
      targetConvId: args.targetConvId,
      history: [
        ...args.history,
        { role: 'assistant', content: snapshot },
        { role: 'user', content: CONTINUE_PROMPT },
      ],
      appendOnly: true,
      retryAttempt: 1,
    });
  }
}

export function safeDebugFlag() {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('runhq_debug_ai') === '1';
  } catch {
    return false;
  }
}

function retryFromScratch(args: Parameters<typeof handleDone>[0]) {
  args.setTurnsForConv(args.targetConvId, (prev) =>
    prev.map((turn) =>
      turn.id === args.targetTurnId
        ? {
            ...turn,
            content: '',
            reasoning: undefined,
            reasoningStartedAtMs: turn.streamStartedAtMs ?? Date.now(),
            reasoningEndedAtMs: undefined,
          }
        : turn,
    ),
  );
  void args.runStreamRef.current?.({
    targetTurnId: args.targetTurnId,
    targetConvId: args.targetConvId,
    history: args.history,
    appendOnly: false,
    retryAttempt: 1,
  });
}

function continueStream(
  args: Parameters<typeof handleDone>[0],
  contentSnapshot: string,
  nudgeFinalAnswer: boolean,
) {
  void args.runStreamRef.current?.({
    targetTurnId: args.targetTurnId,
    targetConvId: args.targetConvId,
    history: [
      ...args.history,
      { role: 'assistant', content: contentSnapshot },
      { role: 'user', content: nudgeFinalAnswer ? NUDGE_FINAL_ANSWER_PROMPT : CONTINUE_PROMPT },
    ],
    appendOnly: true,
    retryAttempt: 1,
  });
}
