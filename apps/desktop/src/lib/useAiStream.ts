import { useCallback, useReducer, useRef } from 'react';
import type { StreamChunk } from '@/types';

/**
 * Streaming state for any AI surface in RunHQ.
 *
 * One `useAiStream()` instance per UI surface (commit panel explainer,
 * log triage popover, chat panel turn, etc.). The hook is intentionally
 * **transport-agnostic** — callers pass any function that takes
 * `(onChunk) => Promise<void>`, which keeps the hook reusable for the
 * five different streaming IPC commands without subclassing.
 *
 * Cancellation strategy: Tauri 2 has no first-class abort handle, so we
 * issue every run a monotonically-increasing `requestId` and the
 * dispatcher drops chunks that arrive after `cancel()` (or after a
 * subsequent `start()`). The backend keeps emitting until the model
 * stops — but the user sees an instant cancel because the UI stops
 * appending tokens.
 */

export type AiStreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface AiStreamUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
}

/**
 * Why the stream stopped, mirrored from the backend's `Done.finish_reason`.
 *
 * UI surfaces should treat `"length"` as the trigger to show a
 * "response was cut off" affordance — that's the only value the
 * dashboard explicitly acts on today. Other values are passed
 * through verbatim for future debug/telemetry surfaces.
 */
export type AiFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'function_call'
  // Local servers (LM Studio, Ollama) sometimes report unexpected
  // strings; we keep the union open via `string` so the type
  // doesn't lie about the runtime surface.
  | (string & {});

export interface AiStreamState {
  status: AiStreamStatus;
  text: string;
  /// Reasoning / chain-of-thought tokens, kept separate from `text`
  /// so the UI can render them in a collapsible "Thinking…" panel
  /// instead of mixing them into the answer body. Sourced from
  /// `delta.reasoning_content`, `delta.reasoning`, or `<think>...
  /// </think>` blocks inside `delta.content` — backend already does
  /// the classification, this is just the merged stream.
  reasoning: string;
  /// Epoch ms (Date.now()) when the model entered its reasoning
  /// phase, or `null` if it never did. Set on the first reasoning
  /// chunk OR on a reclassify event (where we use the stream-start
  /// time, since the user has been waiting since then). Drives the
  /// live "Thinking…" timer in the UI.
  reasoningStartedAtMs: number | null;
  /// Epoch ms (Date.now()) when reasoning ended — either because
  /// the model started emitting answer tokens, or because the
  /// stream finished without an answer. `null` while the model is
  /// still in its thinking phase.
  reasoningEndedAtMs: number | null;
  model: string | null;
  usage: AiStreamUsage | null;
  error: string | null;
  /// Wall-clock ms since `start()` returned the first delta. Useful
  /// for "Streamed in 1.4s" attribution. `null` until the first delta
  /// arrives (avoids surfacing latency-only timings).
  durationMs: number | null;
  /// Provider-reported reason the stream ended. `null` while
  /// streaming, set on `done`. Surfaces `"length"` so callers can
  /// render a "response was truncated" banner on AiAnswer / triage
  /// popovers — same fix as the chat panel's Continue button, but
  /// for the read-only surfaces where Continue doesn't apply.
  finishReason: AiFinishReason | null;
}

const INITIAL: AiStreamState = {
  status: 'idle',
  text: '',
  reasoning: '',
  reasoningStartedAtMs: null,
  reasoningEndedAtMs: null,
  model: null,
  usage: null,
  error: null,
  durationMs: null,
  finishReason: null,
};

type Action =
  | { type: 'reset' }
  | { type: 'start'; startedAtMs: number }
  | { type: 'delta'; text: string; firstDeltaAtMs: number | null; atMs: number }
  | { type: 'reasoning'; text: string; atMs: number }
  | { type: 'reclassify_as_reasoning'; streamStartedAtMs: number }
  | {
      type: 'done';
      content: string;
      reasoning?: string | null;
      model?: string | null;
      promptTokens?: number | null;
      completionTokens?: number | null;
      finishReason?: AiFinishReason | null;
      durationMs: number | null;
      atMs: number;
    }
  | { type: 'error'; message: string }
  | { type: 'cancel' };

function reducer(state: AiStreamState, action: Action): AiStreamState {
  switch (action.type) {
    case 'reset':
      return INITIAL;
    case 'start':
      // Eager "Thinking…" pill: anchor the reasoning start to the
      // moment we send the request so every surface (chat, log
      // triage, project explain, standup) shows a live indicator
      // the instant the user triggers an AI run — even before a
      // single byte streams back. The first answer `delta` will
      // close the thinking phase via the `delta` action.
      return { ...INITIAL, status: 'streaming', reasoningStartedAtMs: action.startedAtMs };
    case 'delta':
      return {
        ...state,
        status: 'streaming',
        text: state.text + action.text,
        durationMs: action.firstDeltaAtMs,
        // First answer token after a thinking phase ends thinking.
        reasoningEndedAtMs:
          state.reasoningStartedAtMs !== null && state.reasoningEndedAtMs === null
            ? action.atMs
            : state.reasoningEndedAtMs,
      };
    case 'reasoning':
      return {
        ...state,
        status: 'streaming',
        reasoning: state.reasoning + action.text,
        reasoningStartedAtMs: state.reasoningStartedAtMs ?? action.atMs,
      };
    case 'reclassify_as_reasoning':
      // Promote everything we'd been showing as the answer into the
      // reasoning bucket. Triggered when a "naked </think>" arrives
      // mid-stream from a proxy that stripped the opener. The user
      // has been "thinking-waiting" since the stream started, so we
      // anchor the start to that moment rather than `now`.
      return {
        ...state,
        reasoning: state.reasoning + state.text,
        text: '',
        reasoningStartedAtMs: state.reasoningStartedAtMs ?? action.streamStartedAtMs,
      };
    case 'done':
      return {
        ...state,
        status: 'done',
        // Some providers send a final `done` with the full assembled
        // content but never streamed any deltas (Ollama on certain
        // model loads). Prefer the assembled `content` whenever it's
        // longer than what we've accumulated locally — keeps the user
        // from staring at a half-truncated answer.
        text: action.content.length > state.text.length ? action.content : state.text,
        reasoning:
          (action.reasoning?.length ?? 0) > state.reasoning.length
            ? (action.reasoning ?? state.reasoning)
            : state.reasoning,
        model: action.model ?? state.model,
        usage: {
          promptTokens: action.promptTokens ?? state.usage?.promptTokens ?? null,
          completionTokens: action.completionTokens ?? state.usage?.completionTokens ?? null,
        },
        durationMs: action.durationMs,
        finishReason: action.finishReason ?? null,
        // If we were thinking and the stream ended without an answer
        // token (or with the answer arriving in this same `done`),
        // close the thinking phase out at this moment.
        reasoningEndedAtMs:
          state.reasoningStartedAtMs !== null && state.reasoningEndedAtMs === null
            ? action.atMs
            : state.reasoningEndedAtMs,
      };
    case 'error':
      return { ...state, status: 'error', error: action.message };
    case 'cancel':
      return { ...state, status: 'cancelled' };
    default:
      return state;
  }
}

export interface UseAiStreamApi extends AiStreamState {
  /** Begin a streaming request. The `runner` callback receives the
   * raw `onChunk` handler and is expected to invoke whatever IPC
   * command it likes, threading chunks through. Stale invocations
   * (after `cancel()` or another `start()`) are silently ignored. */
  start: (runner: (onChunk: (chunk: StreamChunk) => void) => Promise<void>) => Promise<void>;
  /** Stop appending tokens to the UI. Backend stream keeps running
   * until the model finishes — that's a Tauri 2 limitation we accept
   * to avoid plumbing AbortController into every IPC. */
  cancel: () => void;
  /** Wipe everything back to `idle`. */
  reset: () => void;
  /** True while a request is in flight (token actively appended or
   * channel still open). UI uses this to disable the send button and
   * show a spinner. */
  busy: boolean;
}

export function useAiStream(): UseAiStreamApi {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  // Monotonic request id. Bumping invalidates all in-flight chunks
  // for previous runs without us having to subscribe-then-unsubscribe.
  const requestIdRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  // Date.now() at start, used to anchor the "thinking" timer when a
  // naked-close reclassify happens. Distinct from `startedAtRef`,
  // which uses performance.now() and is for delta latency tracking.
  const streamStartedAtEpochRef = useRef<number | null>(null);

  const start = useCallback(
    async (runner: (onChunk: (chunk: StreamChunk) => void) => Promise<void>) => {
      const myId = ++requestIdRef.current;
      startedAtRef.current = performance.now();
      const startedAtEpoch = Date.now();
      streamStartedAtEpochRef.current = startedAtEpoch;
      dispatch({ type: 'start', startedAtMs: startedAtEpoch });

      const onChunk = (chunk: StreamChunk) => {
        // Stale chunk from a cancelled or superseded run — ignore.
        if (myId !== requestIdRef.current) return;

        if (chunk.type === 'delta') {
          dispatch({
            type: 'delta',
            text: chunk.text,
            firstDeltaAtMs:
              startedAtRef.current !== null
                ? Math.round(performance.now() - startedAtRef.current)
                : null,
            atMs: Date.now(),
          });
        } else if (chunk.type === 'reasoning') {
          dispatch({ type: 'reasoning', text: chunk.text, atMs: Date.now() });
        } else if (chunk.type === 'reclassify_as_reasoning') {
          dispatch({
            type: 'reclassify_as_reasoning',
            streamStartedAtMs: streamStartedAtEpochRef.current ?? Date.now(),
          });
        } else if (chunk.type === 'done') {
          dispatch({
            type: 'done',
            content: chunk.content,
            reasoning: chunk.reasoning ?? null,
            model: chunk.model,
            promptTokens: chunk.prompt_tokens,
            completionTokens: chunk.completion_tokens,
            finishReason: chunk.finish_reason ?? null,
            durationMs:
              startedAtRef.current !== null
                ? Math.round(performance.now() - startedAtRef.current)
                : null,
            atMs: Date.now(),
          });
        } else if (chunk.type === 'error') {
          dispatch({ type: 'error', message: chunk.message });
        }
      };

      try {
        await runner(onChunk);
      } catch (e) {
        if (myId !== requestIdRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: 'error', message });
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    dispatch({ type: 'cancel' });
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    dispatch({ type: 'reset' });
  }, []);

  return {
    ...state,
    start,
    cancel,
    reset,
    busy: state.status === 'streaming',
  };
}
