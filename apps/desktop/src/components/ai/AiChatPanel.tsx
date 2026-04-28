import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CornerDownLeft,
  History,
  Loader2,
  Plus,
  Scissors,
  Settings,
  Square,
  X,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type {
  AiProvider,
  ChatMessage,
  Conversation,
  ConversationMessage,
  StreamChunk,
} from '@/types';
import type { AiActionHook } from '@/store/useAppStore';
import { useAppStore } from '@/store/useAppStore';
import { actionHookLabel, dispatchAiAction } from '@/lib/ai/actionHooks';
import { ReasoningPill } from './ReasoningPill';
import { COMPACT_MARKDOWN_COMPONENTS } from './markdownComponents';
import { HistoryDrawer } from './HistoryDrawer';
import { TokenMeter } from './TokenMeter';
import { ChatTabs } from './ChatTabs';

interface AiChatPanelProps {
  /**
   * Drawer mode (legacy): the panel positions itself as a fixed
   * right-edge slide-in. `open`/`onClose` control mount + dismiss.
   *
   * Inline mode (new): the panel is rendered inside the
   * `<RightSidePanel />` shell which owns visibility via the right
   * activity rail. In this mode `open`/`onClose` are ignored —
   * presence in the tree means "render". Pass `variant="inline"`.
   */
  variant?: 'drawer' | 'inline';
  open?: boolean;
  onClose?: () => void;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Chain-of-thought / reasoning trace for this turn. Kept separate
   * from `content` so the UI can hide it behind a collapsed panel
   * (default) and the "real" answer takes centre stage. */
  reasoning?: string;
  /** Epoch ms when the model entered its reasoning phase for this
   * turn. Drives the live "Thinking…" timer in the pill. */
  reasoningStartedAtMs?: number;
  /** Epoch ms when reasoning ended — first answer token arrived,
   * or the stream completed. While unset, the pill renders in
   * live mode and ticks the duration counter. */
  reasoningEndedAtMs?: number;
  /** Stream-start epoch ms for this turn. Used to anchor the
   * thinking start when a "naked </think>" reclassify fires (the
   * user has been waiting since this moment). */
  streamStartedAtMs?: number;
  /** True while this turn's tokens are still streaming in. Used to
   * gate the "stop" button and the pulsing caret. */
  streaming?: boolean;
  /** Set on the assistant turn when the stream errored — we render
   * a red note instead of the (probably empty) content. */
  error?: string;
  /** Why the model stopped, copied straight from the provider's
   * `finish_reason`. We act on:
   *   - `"length"`: shows the "cut off" banner + Continue button.
   *   - `"timeout"`: synthesised by the Rust SSE parser when the
   *     stream went idle for too long (no `finish_reason`, no
   *     `[DONE]`, no TCP close). Drives a distinct "stream stalled"
   *     banner so the user knows it wasn't the model deciding to
   *     stop early.
   *  Other values (most importantly `"stop"`) are recorded verbatim
   *  for a future debug surface but ignored visually. */
  finishReason?: string | null;
  /** True when the assistant turn ended in a non-clean state — i.e.
   * `finish_reason` was `"length"` (truncated) or `"timeout"`
   * (idle-stalled), or the user cancelled, or the transport errored.
   * Distinct from `finishReason` because it's the boolean we'll
   * persist to SQLite later (Phase 1) and use to drive a "this
   * answer is incomplete" badge — the raw reason matters for the
   * banner copy, but `partial` is the durable, persist-friendly flag.
   * NEVER set on user turns. */
  partial?: boolean;
  /** Snapshot of the provider used for this turn — captured at
   *  send-time so a later model switch in the picker doesn't
   *  retroactively re-label old turns. Pure UI metadata, never
   *  shipped back to the model. */
  providerName?: string;
  modelName?: string;
  /** Surface-specific action attached to this assistant turn. When
   *  set to a non-`none` kind, `TurnView` renders a primary button
   *  ("Use as commit message", "Insert into standup", …) under the
   *  answer. The hook is panel-scoped — it's stamped on every
   *  assistant turn created during this session that arose from a
   *  draft with an `actionHook`. NOT persisted: a re-loaded
   *  conversation just becomes a plain chat thread, which matches
   *  how the user thinks about it ("I asked once, took the action,
   *  the rest is just regular chat"). */
  actionHook?: AiActionHook;
}

// Note on style: written as terse second-person prose, not a
// bulleted "Rules:" list. Smaller models (and even some bigger
// reasoning models) treat lists as a template to reproduce in their
// answer — the user reported seeing the rules echoed verbatim. Prose
// instructions are dramatically less prone to that failure mode.
//
// The "no scratchpad" clause names exact phrases the model tends to
// leak (`Drafting the Response`, `Internal Monologue`, `Step 1:`).
// Smaller models follow concrete examples far more reliably than
// abstract directives, and the Rust-side `ThinkState` parser also
// catches these phrases as scratchpad-end markers if they slip past.
const SYSTEM_PROMPT =
  "You are RunHQ's in-app assistant for software engineers managing local services and git repos. " +
  'Answer in GitHub-flavoured Markdown. Be terse — give the shortest answer that actually answers the question, with no preamble like "Certainly!" or "Sure, here is". ' +
  'Put any suggested shell or code in fenced code blocks with the right language tag. ' +
  "Ground answers in whatever context the user pastes; do not invent files, services, or commands you can't see. " +
  "If you don't know, say so in one sentence and name the single piece of evidence that would resolve it. " +
  'Output the final answer directly — no preamble, no analysis steps, no scratchpad. ' +
  'Never write headings or bullets named "Drafting the Response", "Drafting the Content", "Drafting the Standup", "Drafting the Answer", "Drafting the Output", "Internal Monologue", "Inference:", "Final Answer:", "Step 1:", "Reasoning:", "Analysis:", or "Plan:". ' +
  'Never enumerate planning steps such as "1. Reading the input" or "2. Identifying the change". ' +
  'Never narrate what you are about to do — just do it. ' +
  'The very first character of your response must be the start of the actual answer.';

/**
 * Right-side slide-in chat drawer.
 *
 * Multi-turn conversation backed by the streaming `ai_chat_completion`
 * IPC. Lives entirely in component memory — closing the panel keeps
 * the conversation, "New chat" wipes it. Persisting across reloads
 * is a future tidy: it requires a per-conversation store, retention
 * limits, and a cost-aware redaction step before we treat any prior
 * turn as "context worth re-sending".
 *
 * Keyboard contract:
 *   - Esc: close
 *   - Enter: send (Shift+Enter for newline)
 *   - The trigger shortcut (Cmd/Ctrl+L) is owned by the parent.
 *
 * The panel uses overlay-free positioning (right-side z-index above
 * the dashboard, but no scrim) so the user can keep glancing at logs
 * / dashboards while typing — that's the whole point of "ask while
 * working" vs a modal interruption.
 */
export function AiChatPanel({ variant = 'drawer', open = true, onClose }: AiChatPanelProps) {
  // Inline mode is *always* "open" — the right activity rail decides
  // when this component is mounted. Collapse to a single boolean
  // here so the rest of the file doesn't need to special-case the
  // variant on every effect.
  const isOpen = variant === 'inline' ? true : open;
  // Memoised so the Esc-listener effect's dep array stays stable
  // across renders even when no `onClose` is wired (inline mode).
  const closePanel = useMemo(() => onClose ?? (() => {}), [onClose]);
  /**
   * Per-conversation turn state. Replaces the legacy `Turn[]` shape so
   * a stream that starts in conversation A keeps making progress when
   * the user switches to conversation B and back — the chunk handler
   * writes straight into A's slot regardless of which tab is on
   * screen. The displayed `turns` is derived from this map for the
   * active conversation; non-active conversations remain alive in
   * memory until the user explicitly closes the tab.
   *
   * Implementation note: we re-create the Map only when an entry
   * actually changes, so unrelated conversations retain referential
   * identity and React.memo'd children (TurnView etc.) skip their
   * re-render even when *some* tab made progress.
   */
  const [turnsByConv, setTurnsByConv] = useState<Map<string, Turn[]>>(() => new Map());
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Per-conversation contextSystemMessage delivered by a surface
   * trigger. Persists across rerenders for the lifetime of the
   * conversation — but is NOT persisted to SQLite. Reasoning: the
   * payload is huge (a full diff blob can hit 50KB) and we'd be
   * shipping it on every send, including continuations and follow-
   * up questions that don't need it. Better to keep it in-memory
   * for "as long as the user is working in this conversation",
   * fading away on reload.
   *
   * Now keyed by conversation id so a follow-up send into a tab the
   * user just navigated back to still grounds in the same evidence
   * the original surface trigger supplied — switching tabs no
   * longer wipes the panel-level slot.
   */
  const surfaceContextByConvRef = useRef<Map<string, string>>(new Map());
  /**
   * Action hook attached by a surface (Commit, Standup, etc.). Stamped
   * onto every assistant turn produced in this conversation so the
   * matching TurnView renders its primary action button. Cleared when
   * the panel switches conversations or the user explicitly starts a
   * new chat — same lifecycle as `surfaceContextByConvRef`.
   */
  const actionHookByConvRef = useRef<Map<string, AiActionHook>>(new Map());
  /**
   * Tracks which message IDs we've already persisted to SQLite so a
   * recovery / retry loop can't double-write. Per-conversation so
   * cross-tab streaming each maintains its own dedupe set.
   */
  const persistedTurnIdsByConvRef = useRef<Map<string, Set<string>>>(new Map());
  // Full provider list — drives the model picker. We used to only
  // store the active provider, which made the pill informational
  // ("here's your model") rather than functional ("change your
  // model"). Now we keep the list so clicking the pill opens a
  // real dropdown.
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // True once the very first `listAiProviders` IPC has resolved.
  // Empty `providers` is ambiguous between "no providers configured"
  // and "still loading"; this flag disambiguates so the auto-send
  // path doesn't fire into a null `provider` and silently bail.
  const [providersLoaded, setProvidersLoaded] = useState(false);
  // When a surface-triggered draft has `autoSend: true` *and* the
  // user has 2+ providers configured, we open the picker and wait
  // for them to choose — this ref says "as soon as a model is
  // selected, fire send()". Cleared on dismissal (Esc / outside
  // click) so the user can also choose to manually edit the prompt.
  // The mirrored state drives a visual hint inside ModelPicker so
  // the user knows the click will trigger an immediate send rather
  // than just changing their default. Kept in sync with the ref by
  // always setting both together.
  const pendingAutoSendRef = useRef(false);
  // Holds the original draft prompt while we wait for the user to
  // pick a model. We pass it explicitly to `send()` instead of
  // re-reading from `input` state, matching the single-provider
  // path and side-stepping any cross-render staleness.
  const pendingAutoSendPromptRef = useRef<string | null>(null);
  const [awaitingAutoSend, setAwaitingAutoSend] = useState(false);
  /**
   * Per-conversation request-id counters. The legacy single counter
   * meant cancelling any conversation invalidated EVERY in-flight
   * stream — exactly the source of "switched tabs and the answer
   * resets to the start". Now each conversation has its own bump
   * sequence so a cancel on A leaves B's stream untouched.
   *
   * The counter starts at 0 for unseen conversations; each `runStream`
   * call increments and remembers its own id; the chunk handler
   * compares against the latest id for *its* conversation, so a stale
   * stream from an earlier `cancel()` on the same conversation still
   * gets correctly orphaned without sweeping siblings.
   */
  const requestIdsRef = useRef<Map<string, number>>(new Map());
  /**
   * Tracks which conversations currently have a live stream running.
   * Used by the hydration effect to avoid clobbering live progress
   * with a (now stale) DB load when the user switches back to a tab
   * that's still mid-answer. Entries are added at the top of
   * `runStream` and removed when the stream resolves naturally
   * (`done`/`error`) or is explicitly cancelled.
   */
  const inFlightConvsRef = useRef<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // Holds the current `runStream` for the silent auto-retry path.
  // Direct self-reference inside `useCallback` would force `runStream`
  // into its own dep array (circular) and confuse ESLint; the ref
  // detour gives the inner closure a stable handle to the latest
  // function without thrashing its identity.
  type RunStreamFn = (args: {
    targetTurnId: string;
    targetConvId: string;
    history: ChatMessage[];
    appendOnly: boolean;
    retryAttempt?: number;
    providerOverride?: AiProvider;
  }) => Promise<void>;
  const runStreamRef = useRef<RunStreamFn | null>(null);

  const selectedService = useAppStore((s) =>
    s.selectedServiceId ? s.services.find((x) => x.id === s.selectedServiceId) : null,
  );
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const openTabs = useAppStore((s) => s.openTabs);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const aiDraft = useAppStore((s) => s.aiDraft);
  const clearAiDraft = useAppStore((s) => s.clearAiDraft);
  // Track which conversation ID we last hydrated so we don't refetch
  // on every render. The activeConversationId effect compares against
  // this ref and only reloads on actual id transitions.
  const loadedConversationIdRef = useRef<string | null>(null);
  // Same idea for the draft consumer — guard against firing the same
  // draft into the panel twice if React re-runs the effect.
  const consumedDraftIdRef = useRef<string | null>(null);

  /**
   * Derived turn array for the *currently active* conversation. All
   * existing render code keeps reading `turns` as a flat list — the
   * per-conversation map is an implementation detail. Memoised so a
   * write to a non-active conversation (chunk arriving in a tab
   * that's not on screen) doesn't change this reference and
   * therefore doesn't propagate a useless render through the message
   * list.
   */
  const turns = useMemo<Turn[]>(
    () => (activeConversationId ? (turnsByConv.get(activeConversationId) ?? []) : []),
    [turnsByConv, activeConversationId],
  );

  /**
   * Write into a specific conversation's turn list. Used by stream
   * chunk handlers (which capture the conversation ID at runStream
   * dispatch and never read it back from React state) so a chunk
   * still arriving for tab A while the user is looking at tab B
   * lands in A's slot.
   *
   * Returning the same array instance when the updater produced no
   * change preserves referential identity for downstream memoisation.
   */
  const setTurnsForConv = useCallback(
    (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => {
      setTurnsByConv((prev) => {
        const cur = prev.get(convId) ?? [];
        const nextTurns = typeof updater === 'function' ? updater(cur) : updater;
        if (nextTurns === cur) return prev;
        const next = new Map(prev);
        next.set(convId, nextTurns);
        return next;
      });
    },
    [],
  );

  /**
   * Convenience setter — writes into the active conversation's list.
   * Drop-in replacement for the legacy `setTurns(...)` API; if there
   * is no active conversation (`null` after newChat) the call is a
   * no-op rather than fabricating an entry under an empty key.
   */
  const setTurns = useCallback(
    (updater: Turn[] | ((prev: Turn[]) => Turn[])) => {
      if (!activeConversationId) return;
      setTurnsForConv(activeConversationId, updater);
    },
    [activeConversationId, setTurnsForConv],
  );

  /**
   * Bump the request id for `convId` so any in-flight chunk handler
   * that captured the previous id gets ignored on its next chunk.
   * Keeps every conversation's cancellation isolated — orphaning A's
   * stream must not also kill B's.
   */
  const bumpRequestId = useCallback((convId: string): number => {
    const cur = requestIdsRef.current.get(convId) ?? 0;
    const next = cur + 1;
    requestIdsRef.current.set(convId, next);
    return next;
  }, []);

  /**
   * Lazily-initialised per-conversation persisted-turn dedupe set.
   * Returns the same Set instance across calls for the same convId
   * so callers can both query (`.has`) and mutate (`.add`/`.delete`)
   * without having to write the result back. Newly-seen
   * conversations get a fresh empty Set on first access.
   */
  const getPersistedSet = useCallback((convId: string): Set<string> => {
    let s = persistedTurnIdsByConvRef.current.get(convId);
    if (!s) {
      s = new Set();
      persistedTurnIdsByConvRef.current.set(convId, s);
    }
    return s;
  }, []);

  /**
   * Read the current conversation's surface-context system message,
   * or `null` when none is attached (free chat or reloaded
   * conversation). Resolves against the active conversation by
   * default so prompt-builder code paths that already read this
   * "globally" still work after the per-conv refactor.
   */
  const getSurfaceContext = useCallback(
    (convId?: string | null): string | null => {
      const id = convId ?? activeConversationId;
      if (!id) return null;
      return surfaceContextByConvRef.current.get(id) ?? null;
    },
    [activeConversationId],
  );

  /**
   * Read the current conversation's action hook (Commit / Standup /
   * etc.), or `null` for free chats. Stamped onto every assistant
   * turn produced in that conversation.
   */
  const getActionHook = useCallback(
    (convId?: string | null): AiActionHook | null => {
      const id = convId ?? activeConversationId;
      if (!id) return null;
      return actionHookByConvRef.current.get(id) ?? null;
    },
    [activeConversationId],
  );

  /**
   * Map a row from SQLite back into a `Turn`. Reasoning, finish
   * reasons, and the partial flag round-trip exactly so a reloaded
   * conversation looks identical to the live one (modulo the
   * "Thinking…" timer which is intentionally not restored — it'd be
   * meaningless on a turn that completed an hour ago).
   */
  const turnFromMessage = useCallback((m: ConversationMessage): Turn => {
    // Prefer the client-side turn id when present so a future
    // re-persist (e.g. user clicks Continue after reload) finds the
    // same row to upsert into. For legacy/pre-upsert rows we fall
    // back to the server id so React still has a stable key — those
    // rows just become "fresh" turns from the panel's POV; the next
    // operation on them will write a new client_id row.
    const stableId = m.client_id ?? `${m.role === 'user' ? 'u' : 'a'}-loaded-${m.id}`;
    return {
      id: stableId,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning ?? undefined,
      // Don't reanimate timestamps — the pill renders in a frozen
      // "thought for Xs" state when both stamps are equal, which is
      // exactly what we want for historical turns.
      reasoningStartedAtMs: m.reasoning ? m.created_at_ms : undefined,
      reasoningEndedAtMs: m.reasoning ? m.created_at_ms : undefined,
      streaming: false,
      error: m.error ?? undefined,
      finishReason: m.finish_reason ?? null,
      partial: m.partial,
      providerName: m.provider_name ?? undefined,
      modelName: m.model_name ?? undefined,
    };
  }, []);

  /**
   * Hydrate the panel when the active conversation changes. Called
   * on mount, on rail-icon click that lands on a previously-active
   * conversation, and on click in the History drawer.
   */
  useEffect(() => {
    // Same id as last load? Skip — avoids a needless DB round-trip
    // every time the panel re-renders (which is constant during
    // streaming).
    if (loadedConversationIdRef.current === activeConversationId) return;

    // Tab-switch fast path: if the user is returning to a
    // conversation whose turns we already have in memory (either
    // because we hydrated it earlier OR because it has a live
    // stream actively writing into it), don't refetch from SQLite.
    // The map already holds the canonical state — going through DB
    // would risk replacing a streaming turn with whatever the last
    // commit looked like. This is the fix for "geri geldiğimde başa
    // sardığını görüyorum": the previous design cancelled on tab
    // switch, blanking the visible bubble; without that cancel, the
    // hydrate-from-DB call would still snap us back to a stale
    // pre-stream snapshot. Skipping when we have local state keeps
    // the live progress visible.
    if (activeConversationId && turnsByConv.has(activeConversationId)) {
      loadedConversationIdRef.current = activeConversationId;
      // Surface-context, action-hook, and persisted-turn sets are
      // already keyed per-conversation, so there's nothing to swap
      // back in — we just remember that this id is now "loaded".
      return;
    }

    loadedConversationIdRef.current = activeConversationId;

    if (!activeConversationId) {
      // No-op for the panel-level state because `turns` is derived;
      // the empty conversation simply has no map entry.
      return;
    }

    // If a surface-triggered draft is already lined up for this
    // conversation (Why? / Explain / Triage / Explain commit / etc),
    // the conversation is brand-new — `openAiChat` only just
    // created it, no rows in SQLite yet — and the draft consumer
    // effect is about to fire `send()` which appends user +
    // assistant turns synchronously. Racing a DB hydration here
    // would resolve a few ms later with `[]` and clobber those
    // freshly-appended turns; the symptom is exactly the bug the
    // user reported: "modeli seçiyorum ama analize başlamıyor"
    // (model selected, Rust streams, UI shows empty conversation
    // because the async load won the race against the auto-send's
    // appending update). Pre-seed an empty entry so the
    // `turnsByConv.has(...)` short-circuit above keeps subsequent
    // visits stable too.
    const pendingDraft = useAppStore.getState().aiDraft;
    if (pendingDraft && pendingDraft.conversationId === activeConversationId) {
      setTurnsForConv(activeConversationId, []);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const conv: Conversation = await ipc.getConversation(activeConversationId);
        if (cancelled) return;
        setTurnsForConv(activeConversationId, conv.messages.map(turnFromMessage));
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load conversation:', e);
        // Don't blank turns on a load failure — would be confusing
        // if the user had been mid-stream and something hiccupped.
        // Instead leave whatever's on screen and surface the error
        // via the existing provider-error banner slot.
        setProviderError(
          `Couldn't load conversation: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConversationId, turnFromMessage, turnsByConv, setTurnsForConv]);

  /**
   * Consume a surface-triggered draft. Fires once per draft (guarded
   * by `consumedDraftIdRef`). Pre-fills the composer text + stashes
   * the contextSystemMessage, then branches the auto-send path on
   * the number of configured providers:
   *
   *   • 0 providers → leave the prompt in the textarea, surface the
   *     "No AI provider configured" banner. User adds one from
   *     Settings → AI and clicks Send manually.
   *   • 1 provider → fire send() immediately. The user already
   *     committed by clicking Why? / Explain / Triage / etc; making
   *     them re-confirm here would be redundant friction.
   *   • 2+ providers → open the model picker and stash a "pending
   *     auto-send" flag. As soon as the user picks a model
   *     `selectProvider` consumes the flag and fires send() — so
   *     the picker click is the single confirmation gesture, not a
   *     two-step (pick model, then click send) ritual.
   *
   * We deliberately wait until `providersLoaded` is true before
   * consuming the draft. The surface trigger and the panel mount
   * race the IPC; without this gate, a cold-start auto-send fires
   * before `provider` is non-null and `send()` would silently bail.
   */
  useEffect(() => {
    if (!aiDraft) return;
    if (aiDraft.conversationId !== activeConversationId) return;
    if (consumedDraftIdRef.current === aiDraft.conversationId) return;
    if (!providersLoaded) return;
    consumedDraftIdRef.current = aiDraft.conversationId;

    if (aiDraft.contextSystemMessage) {
      surfaceContextByConvRef.current.set(aiDraft.conversationId, aiDraft.contextSystemMessage);
    } else {
      surfaceContextByConvRef.current.delete(aiDraft.conversationId);
    }
    if (aiDraft.actionHook) {
      actionHookByConvRef.current.set(aiDraft.conversationId, aiDraft.actionHook);
    } else {
      actionHookByConvRef.current.delete(aiDraft.conversationId);
    }
    if (aiDraft.draftPrompt) {
      setInput(aiDraft.draftPrompt);
    }
    const shouldAutoSend = aiDraft.autoSend === true;
    const forcedProviderId = aiDraft.forcedProviderId ?? null;
    const prompt = aiDraft.draftPrompt;
    // Clear the draft from the store BEFORE auto-send so a re-entry
    // (e.g. user switches away and back) doesn't double-fire.
    clearAiDraft();

    if (!shouldAutoSend) return;

    if (providers.length === 0) {
      // Banner already surfaced via reloadProviders' empty-list
      // check; nothing to do here, prompt sits in the textarea.
      return;
    }

    // The surface-side popover (`useAiSurfaceTrigger`) captured a
    // model choice next to the trigger button. Honor it: snap the
    // panel's active provider to that one and fire immediately,
    // bypassing the in-panel picker entirely. If the id no longer
    // resolves (provider deleted between click and arrival here)
    // we fall back to the count-based branches below.
    if (forcedProviderId) {
      const forced = providers.find((p) => p.id === forcedProviderId);
      if (forced) {
        setProvider(forced);
        // Persist as the new default for parity with the in-panel
        // picker — failure is non-fatal.
        void ipc
          .setDefaultAiProvider(forced.id)
          .then(() => {
            setProviders((prev) => prev.map((x) => ({ ...x, default: x.id === forced.id })));
          })
          .catch(() => {
            /* ignore — local override still wins for this dispatch */
          });
        // We can't read the just-set `provider` from `send`'s
        // closure on this same tick, so pass it explicitly.
        void sendRef.current?.(prompt, forced);
        return;
      }
    }

    if (providers.length === 1) {
      // Pass the prompt directly to send() — no rAF dance needed
      // since the override path doesn't depend on `setInput`
      // having propagated yet. We deliberately fire synchronously
      // (well, kick off the async dispatch synchronously): if we
      // deferred via rAF, the imminent `clearAiDraft()` re-render
      // would re-run this effect with `aiDraft = null` and the
      // returned cleanup would cancelAnimationFrame our pending
      // dispatch — silently dropping the auto-send. Synchronous
      // dispatch sidesteps that whole class of race.
      void sendRef.current?.(prompt);
      return;
    }
    // 2+ providers reached the panel without a `forcedProviderId`
    // — that means a manual `openAiChat` call (free-chat command,
    // legacy entry point) didn't go through `useAiSurfaceTrigger`.
    // Fall back to the in-panel picker path so the user still has
    // a chance to choose before we send.
    pendingAutoSendRef.current = true;
    pendingAutoSendPromptRef.current = aiDraft.draftPrompt ?? null;
    setAwaitingAutoSend(true);
    setPickerOpen(true);
  }, [aiDraft, activeConversationId, clearAiDraft, providers, providersLoaded]);

  /**
   * Persist a user message immediately on send. We don't wait for
   * the assistant turn to complete because the user's text is
   * already canonical content; if the stream errors out the user
   * still wants to see "I asked X" in the conversation history.
   */
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
        // Non-fatal — the user still sees their text on screen.
        // We log so a future toast layer can pick this up.
        console.error('persistUserMessage failed:', e);
        persisted.delete(turn.id);
      }
    },
    [getPersistedSet],
  );

  /**
   * Persist an assistant message at stream finalisation, or update
   * an in-place row when the same turn re-finalises (cancel after a
   * partial → continue loop). Idempotency is enforced backend-side
   * via the `client_id` upsert: passing the same `turn.id` collapses
   * to one row whose latest snapshot reflects the most recent
   * call. We deliberately do NOT track persisted ids in a Set —
   * that would block the "continue" path from updating the partial
   * row to its complete form on reload.
   */
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
  // Bind a ref so the auto-send effect (which fires before `send`
  // is in scope) can call into the freshest closure. Accepts an
  // optional override text — used by the surface-trigger auto-send
  // path so we don't depend on `setInput → re-render → send reads
  // input` happening in lockstep with our rAF (which has burned us
  // before in StrictMode dev replays). The second arg pins a
  // provider for this single dispatch (used when the surface-side
  // popover already captured the user's pick — we can't wait for
  // React to commit `setProvider` before reading `provider` in
  // send's closure).
  const sendRef = useRef<
    ((overrideText?: string, providerOverride?: AiProvider) => Promise<void>) | null
  >(null);
  // Same idea for `persistAssistantTurn` — the streaming reducer
  // schedules persistence via `queueMicrotask`, and the closure
  // captured at `runStream` definition would otherwise hold the
  // first-render version forever.
  const persistAssistantTurnRef = useRef<typeof persistAssistantTurn | null>(null);
  persistAssistantTurnRef.current = persistAssistantTurn;

  // Reload the provider list every time the panel opens, plus
  // whenever the picker is opened (in case the user added/edited a
  // provider in AI Settings without closing the chat). Cheap call
  // and it keeps the dropdown honest.
  const reloadProviders = useCallback(async () => {
    try {
      const list = await ipc.listAiProviders();
      setProviders(list);
      setProvider((current) => {
        if (current) {
          // Keep the user's active selection sticky across reloads.
          // If their previously-selected provider was deleted out
          // from under them in AI Settings, fall back to default.
          const stillExists = list.find((p) => p.id === current.id);
          if (stillExists) return stillExists;
        }
        return list.find((p) => p.default) ?? list[0] ?? null;
      });
      setProviderError(
        list.length === 0 ? 'No AI provider configured. Add one from Settings → AI.' : null,
      );
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : String(e));
    } finally {
      // Flip the loaded gate even on error — otherwise a transient
      // IPC failure would deadlock the auto-send path forever. The
      // surface-triggered consumer effect handles `providers.length
      // === 0` by surfacing the error banner, which is the right
      // user signal in either case (no providers / failed to list).
      setProvidersLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void reloadProviders();
  }, [isOpen, reloadProviders]);

  // Close the picker on outside click. We attach the listener only
  // while the picker is open so we're not paying for a global
  // mousedown handler in the steady state.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const node = pickerRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setPickerOpen(false);
        // Dismissal cancels any pending auto-send — the user
        // explicitly stepped out of the picker, which we read as
        // "let me edit the prompt before sending". The draft stays
        // in the textarea so they can tweak and click Send manually.
        pendingAutoSendRef.current = false;
        pendingAutoSendPromptRef.current = null;
        setAwaitingAutoSend(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerOpen(false);
        pendingAutoSendRef.current = false;
        pendingAutoSendPromptRef.current = null;
        setAwaitingAutoSend(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const selectProvider = useCallback(async (p: AiProvider) => {
    setProvider(p);
    setPickerOpen(false);
    // If the picker was opened by the auto-send path (2+ providers
    // and a surface-triggered draft), the click on a model row IS
    // the send confirmation — fire send() now. We consume the flag
    // before the rAF so a stray re-entry (e.g. user clicks twice)
    // can't double-fire. `send()` reads `provider` from state, but
    // React batches the setProvider call above so by the time the
    // animation frame runs the state has flushed.
    if (pendingAutoSendRef.current) {
      pendingAutoSendRef.current = false;
      const prompt = pendingAutoSendPromptRef.current ?? undefined;
      pendingAutoSendPromptRef.current = null;
      setAwaitingAutoSend(false);
      // Defer the dispatch one frame so React commits `setProvider(p)`
      // before send runs. Without this, `sendRef.current` still
      // points to the previous render's `send` closure (which
      // captured the OLD provider) and the request would go to
      // whatever model was selected *before* the user picked.
      // This is a useCallback (not a useEffect), so no cleanup
      // can cancel our rAF — safe to defer.
      requestAnimationFrame(() => {
        sendRef.current?.(prompt);
      });
    }
    // Persist the choice as the new default so the next session
    // (and other surfaces — diff/log popovers, commit message) all
    // pick up the same model. Failure here is non-fatal: the local
    // selection still wins for this chat session.
    try {
      await ipc.setDefaultAiProvider(p.id);
      setProviders((prev) => prev.map((x) => ({ ...x, default: x.id === p.id })));
    } catch {
      /* ignore — local state is enough for this session */
    }
  }, []);

  const openAiSettingsFromPicker = useCallback(() => {
    setPickerOpen(false);
    // User is detouring to AI Settings — they're not committing
    // to a send, so drop any pending auto-send. They'll come back
    // and click Send manually (or re-trigger the surface action).
    pendingAutoSendRef.current = false;
    pendingAutoSendPromptRef.current = null;
    setAwaitingAutoSend(false);
    window.dispatchEvent(new CustomEvent('runhq:open-ai-settings'));
  }, []);

  // Focus the input on every open. We deliberately don't autofocus
  // when the panel is closed (would pull keyboard focus away from
  // whatever the user just clicked) and we re-focus on every open
  // because closing-and-reopening is a common pattern for "ah let
  // me ask one more thing".
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Auto-scroll on new tokens. Only nudges if the user is near the
  // bottom — preserves their scroll position when re-reading older
  // turns mid-stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Esc to close — only meaningful in drawer mode where Esc dismissing
  // the panel is the natural exit. In inline (rail-driven) mode the
  // panel is part of the workspace shell, so Esc shouldn't yank it
  // away; the user collapses it by clicking the rail icon.
  useEffect(() => {
    if (variant !== 'drawer') return;
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, isOpen, closePanel]);

  /** Build the context chip block from current selection. Currently
   *  just the active service. Future surfaces (active file, last log
   *  error, current diff) plug into this list — kept small for v1
   *  to keep the prompt budget tight. */
  const contextChips = useMemo(() => {
    const chips: { id: string; label: string }[] = [];
    if (selectedService) {
      chips.push({ id: 'service', label: `service: ${selectedService.name}` });
    }
    return chips;
  }, [selectedService]);

  /** Inline context the model should know about, derived from chips.
   *  Inserted as a system message when present. */
  const contextSystemMessage = useMemo(() => {
    if (!selectedService) return null;
    const lines: string[] = ['User is currently looking at this RunHQ context:'];
    lines.push(`- Active service: \`${selectedService.name}\` (cwd: ${selectedService.cwd})`);
    if (selectedService.tags?.length) {
      lines.push(`  tags: ${selectedService.tags.join(', ')}`);
    }
    return lines.join('\n');
  }, [selectedService]);

  /**
   * Token-meter state. Lives at the panel scope so the gauge survives
   * re-renders without losing its last good value (which would cause
   * a flicker every keystroke as the IPC round-trips). We re-count
   * whenever the prompt material changes — turns, draft input,
   * context system messages — but debounce by 120ms so a fast typer
   * doesn't fire 60 IPCs per second.
   */
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const tokenSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++tokenSeqRef.current;
    const handle = window.setTimeout(() => {
      const texts: string[] = [];
      if (contextSystemMessage) texts.push(contextSystemMessage);
      const surfaceCtx = getSurfaceContext();
      if (surfaceCtx) texts.push(surfaceCtx);
      for (const t of turns) {
        if (t.content) texts.push(t.content);
      }
      if (input) texts.push(input);
      if (texts.length === 0) {
        setTokenCount(0);
        return;
      }
      void ipc
        .aiCountTokens(texts)
        .then((n) => {
          // Drop stale results — between the IPC call going out and
          // its response landing, the user may have typed more and
          // a newer count is already in flight.
          if (tokenSeqRef.current === seq) setTokenCount(n);
        })
        .catch(() => {
          // Token count is best-effort UI; on IPC failure leave the
          // last good value rather than flashing a placeholder.
        });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [turns, input, contextSystemMessage, getSurfaceContext]);

  /**
   * Cancel a stream targeting a specific conversation. Bumping that
   * conversation's request id orphans its in-flight chunk handler;
   * the assistant turn flips out of `streaming` so the UI stops the
   * spinner. We also mark any cancelled in-flight assistant turn as
   * `partial` so a reloaded conversation shows it as incomplete (the
   * user explicitly stopped the model mid-stream), and persist the
   * partial content to SQLite — losing a half-typed answer on a
   * hard panel close would be a real "where did my notes go?"
   * moment.
   *
   * Per-conversation cancel (rather than a panel-wide bump) is what
   * lets the user start streaming in tab A, switch to tab B, kick
   * off another stream, and have *both* keep going independently.
   * The legacy single-counter design swept every parallel stream on
   * every cancel — that was the source of "geri geldiğimde başa
   * sardığını görüyorum".
   */
  const cancelFor = useCallback(
    (convId: string | null) => {
      if (!convId) return;
      bumpRequestId(convId);
      inFlightConvsRef.current.delete(convId);
      setTurnsForConv(convId, (prev) =>
        prev.map((t) => {
          if (!t.streaming) return t;
          const next = {
            ...t,
            streaming: false,
            partial: t.role === 'assistant' ? true : t.partial,
          };
          if (
            next.role === 'assistant' &&
            // Don't persist an utterly blank cancelled turn — clutter
            // with no information value.
            next.content.trim().length > 0
          ) {
            Promise.resolve().then(() => {
              void persistAssistantTurnRef.current?.(next, convId);
            });
          }
          return next;
        }),
      );
    },
    [bumpRequestId, setTurnsForConv],
  );

  /**
   * Convenience: cancel the active conversation's stream. Used by
   * the visible Stop button and by `send()` to clear out any prior
   * in-flight request on the same conversation before starting a
   * new one. Tab switches deliberately do NOT call this — streams
   * keep running in the background until the user closes the tab
   * or hits Stop.
   */
  const cancel = useCallback(() => {
    cancelFor(activeConversationId);
  }, [activeConversationId, cancelFor]);

  /**
   * Run one streaming round-trip into a target assistant turn.
   *
   * Two callers:
   *   1. `send()` — fresh user message. `targetTurnId` is a brand-new
   *      assistant turn appended to the conversation, `appendOnly` is
   *      false so the first delta after a reasoning phase closes the
   *      pill, and the history ends with the user's own text.
   *   2. `continueTruncated()` — the previous assistant turn was cut
   *      off (`finish_reason === "length"`). We reuse the same turn
   *      ID and append, so the user sees one continuous answer
   *      instead of two stitched bubbles. `appendOnly: true` skips
   *      reasoning-pill mutations (the pill already froze when the
   *      truncated answer first started rendering — we don't want a
   *      second "Thinking…" indicator on what the user perceives as
   *      one answer).
   *
   * The runner accepts `history` ready-to-send so the caller controls
   * exactly which messages get shipped (e.g. `continueTruncated`
   * appends a synthetic "continue from where you stopped" instruction
   * the user never typed).
   */
  const runStream = useCallback(
    async (args: {
      targetTurnId: string;
      /** Conversation that owns this stream. Captured at the call
       *  site (typically the active conversation when the user hit
       *  Send) and threaded through every chunk handler so a tab
       *  switch mid-stream still routes deltas to the originating
       *  conversation rather than whichever tab happens to be on
       *  screen now. */
      targetConvId: string;
      history: ChatMessage[];
      appendOnly: boolean;
      /** 0 for the original send, 1 for an auto-retry. We cap at 1
       *  to prevent infinite retry storms on a permanently-broken
       *  upstream (e.g. wrong API key, model not loaded) — which
       *  would still surface as a single visible failure, not
       *  silently looping forever. The user-driven "Continue"
       *  button uses a separate code path (`appendOnly: true`) so
       *  it's unaffected by this cap. */
      retryAttempt?: number;
      /** Pin a provider for this dispatch instead of reading from
       *  closure-captured `provider`. Used by the surface-popover
       *  flow where `setProvider(forced)` was called moments ago
       *  but React hasn't committed it into our closure yet. */
      providerOverride?: AiProvider;
    }) => {
      const activeProvider = args.providerOverride ?? provider;
      if (!activeProvider) {
        setProviderError('No AI provider configured. Add one from Settings → AI.');
        return;
      }

      const { targetTurnId, targetConvId, history, appendOnly, retryAttempt = 0 } = args;
      const myId = bumpRequestId(targetConvId);
      // Mark this conversation as having a live stream so the
      // hydration effect knows to leave its turns alone if the user
      // navigates away and back before the stream lands `done`.
      inFlightConvsRef.current.add(targetConvId);
      const isStillCurrent = () => requestIdsRef.current.get(targetConvId) === myId;
      startedAtRef.current = performance.now();
      // Track whether ANY delta arrived during this stream. We need
      // this in the `done` handler to disambiguate two cases:
      //   - Normal streaming: deltas arrived, the turn's `content`
      //     is already the running concat — `chunk.content` from the
      //     backend should equal it (or be empty for a usage-only
      //     done). We pick the longer one.
      //   - "Bulk done" (some Ollama / LM Studio cold loads): the
      //     server collapses everything into the final `done` and
      //     never emits deltas. For appendOnly mode this matters:
      //     the turn's `content` is the truncated text from the
      //     prior run, and `chunk.content` is the new continuation
      //     segment. We need to APPEND, not replace.
      let sawAnyDelta = false;
      // Counters for the debug overlay. Folded into one
      // `console.debug` line on `done`/`error` so the user can
      // copy a single, self-contained event when filing reports.
      let deltaCount = 0;
      let reasoningChunkCount = 0;
      let firstDeltaAt: number | null = null;
      let lastDeltaAt: number | null = null;
      const streamStartPerf = performance.now();
      // Gated debug logging. Off by default (zero overhead in
      // production) — flip on with `localStorage.runhq_debug_ai = '1'`
      // in DevTools to capture per-chunk traces during repro.
      const debugAi = (() => {
        try {
          return (
            typeof window !== 'undefined' && window.localStorage?.getItem('runhq_debug_ai') === '1'
          );
        } catch {
          return false;
        }
      })();
      const dbg = (event: string, payload?: Record<string, unknown>) => {
        if (!debugAi) return;
        const elapsedMs = Math.round(performance.now() - streamStartPerf);
        console.debug(
          `[ai.stream:${targetTurnId.slice(0, 8)}] +${elapsedMs}ms ${event}`,
          payload ?? {},
        );
      };
      dbg('begin', {
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
          if (firstDeltaAt === null) firstDeltaAt = nowPerf;
          lastDeltaAt = nowPerf;
          dbg('delta', { len: chunk.text.length, count: deltaCount });
          const now = Date.now();
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((t) =>
              t.id === targetTurnId
                ? {
                    ...t,
                    content: t.content + chunk.text,
                    reasoningEndedAtMs:
                      !appendOnly &&
                      t.reasoningStartedAtMs !== undefined &&
                      t.reasoningEndedAtMs === undefined
                        ? now
                        : t.reasoningEndedAtMs,
                  }
                : t,
            ),
          );
        } else if (chunk.type === 'reasoning') {
          if (appendOnly) return;
          reasoningChunkCount += 1;
          dbg('reasoning', { len: chunk.text.length, count: reasoningChunkCount });
          const now = Date.now();
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((t) =>
              t.id === targetTurnId
                ? {
                    ...t,
                    reasoning: (t.reasoning ?? '') + chunk.text,
                    reasoningStartedAtMs: t.reasoningStartedAtMs ?? now,
                  }
                : t,
            ),
          );
        } else if (chunk.type === 'reclassify_as_reasoning') {
          if (appendOnly) return;
          dbg('reclassify_as_reasoning');
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((t) =>
              t.id === targetTurnId
                ? {
                    ...t,
                    reasoning: (t.reasoning ?? '') + t.content,
                    content: '',
                    reasoningStartedAtMs:
                      t.reasoningStartedAtMs ?? t.streamStartedAtMs ?? Date.now(),
                  }
                : t,
            ),
          );
        } else if (chunk.type === 'done') {
          dbg('done', {
            finish_reason: chunk.finish_reason ?? null,
            content_len: chunk.content?.length ?? 0,
            reasoning_len: chunk.reasoning?.length ?? 0,
            delta_count: deltaCount,
            reasoning_chunk_count: reasoningChunkCount,
            time_to_first_delta_ms:
              firstDeltaAt !== null ? Math.round(firstDeltaAt - streamStartPerf) : null,
            time_since_last_delta_ms:
              lastDeltaAt !== null ? Math.round(performance.now() - lastDeltaAt) : null,
            saw_any_delta: sawAnyDelta,
          });
          const now = Date.now();
          // Decide what kind of recovery (if any) this `done`
          // warrants. We have two silent recovery modes that both
          // gate on `retryAttempt === 0` so a permanently broken
          // upstream surfaces after one round-trip:
          //
          //   1. `triggerRetry` — fresh stream, blank the bubble.
          //      Used when the visible answer is essentially empty
          //      (<40 chars trimmed). Retrying with the same prompt
          //      from scratch is fine because there's nothing the
          //      user wants to keep.
          //
          //   2. `triggerAutoContinue` — appendOnly stream, keep
          //      what we have and ask the model to continue from
          //      where it stopped. Used when the answer has real
          //      substance (>=40 chars) but stalled mid-body. This
          //      is the same code path the user's manual "Continue"
          //      button uses — auto-firing it once means a half-
          //      streamed answer self-completes the way Cursor /
          //      ChatGPT do, instead of stranding the user with a
          //      partial bubble and an "incomplete" badge.
          //
          //   3. `triggerNudgeAnswer` — local reasoning-heavy
          //      models (GLM, Qwen, DeepSeek-R1 derivatives) often
          //      stuff the *entire* answer into the reasoning
          //      channel and emit only a token or two of actual
          //      response before stopping with `finish_reason:
          //      "stop"`. From the user's POV the bubble looks
          //      "incomplete" while the trace pill quietly holds
          //      the real answer. Detect that pattern (short body
          //      vs. fat reasoning) and silently re-prompt the
          //      model to write its final answer in the response
          //      channel. Same `appendOnly: true` so the bubble
          //      grows in place.
          //
          // The first two modes fire on `finish_reason === 'timeout'`
          // (the synthetic stall reason emitted by our Rust parser).
          // `length` already exposes Continue prominently. `stop`
          // alone is a legitimate finish, but combined with the
          // reasoning>>body asymmetry it almost always means the
          // model lost the thread between scratchpad and answer.
          // We also gate on `!appendOnly` so the manual Continue
          // button never recurses into another silent recovery if
          // it itself stalls (the user kicked it off explicitly;
          // failures must surface).
          let triggerRetry = false;
          let triggerAutoContinue = false;
          let triggerNudgeAnswer = false;
          let nextContentSnapshot = '';
          let finalisedTurnSnapshot: Turn | null = null;
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((t) => {
              if (t.id !== targetTurnId) return t;
              // Reconcile final content. Three cases to cover:
              //   1. Fresh run, normal stream: deltas built up
              //      `t.content` to roughly match `chunk.content`
              //      — pick the longer (handles trailing buffer
              //      flushes).
              //   2. Fresh run, bulk done (no deltas streamed):
              //      `t.content` is empty, `chunk.content` is the
              //      whole answer. Longer-wins still picks correctly.
              //   3. Continuation (`appendOnly`), bulk done: the
              //      turn already holds the truncated text and the
              //      backend just dumped the continuation as one
              //      `chunk.content`. Longer-wins would *replace*
              //      truncated with continuation — losing the user's
              //      original answer. We APPEND instead.
              let nextContent: string;
              if (appendOnly && !sawAnyDelta && chunk.content.length > 0) {
                nextContent = t.content + chunk.content;
              } else {
                nextContent = chunk.content.length > t.content.length ? chunk.content : t.content;
              }
              const reason = chunk.finish_reason ?? null;
              const bodyLen = nextContent.trim().length;
              const reasoningLen = (chunk.reasoning ?? t.reasoning ?? '').trim().length;
              // "Answer hidden in reasoning" heuristic. Triggers when
              // the model finished cleanly (`stop`) but produced a
              // body that's tiny next to a reasoning trace fat
              // enough to plausibly contain the real answer. The
              // 80/200 thresholds came from testing GLM-5.1 and
              // DeepSeek-R1 against the "Why is X flagged?" surface
              // prompt: legit short replies (e.g. "yes, it's clean")
              // run ~30 chars and ship with empty/short reasoning;
              // the failure mode we want to catch reliably has
              // reasoning >300 chars summarising the whole answer
              // while the body trails off after a sentence
              // fragment. Also requires `body < reasoning / 4` so
              // a normal short answer paired with a long ponder
              // doesn't get unfairly retried.
              const answerHiddenInReasoning =
                reason === 'stop' &&
                bodyLen < 80 &&
                reasoningLen >= 200 &&
                bodyLen * 4 < reasoningLen;
              const isPartial =
                reason === 'length' || reason === 'timeout' || answerHiddenInReasoning;
              if (retryAttempt === 0 && reason === 'timeout' && !appendOnly && bodyLen < 40) {
                triggerRetry = true;
              } else if (
                retryAttempt === 0 &&
                reason === 'timeout' &&
                !appendOnly &&
                bodyLen >= 40
              ) {
                // Mid-body stall with substance. Don't blank — fire
                // an appendOnly continuation so the answer self-
                // completes onto the same bubble.
                triggerAutoContinue = true;
                nextContentSnapshot = nextContent;
              } else if (retryAttempt === 0 && !appendOnly && answerHiddenInReasoning) {
                // The bubble looks empty but the reasoning trace
                // already has the answer. Re-ask the model with a
                // pointed instruction to dump the final answer in
                // the response channel; stream it in `appendOnly`
                // so whatever fragment did make it stays visible.
                triggerNudgeAnswer = true;
                nextContentSnapshot = nextContent;
              }
              const recovering = triggerRetry || triggerAutoContinue || triggerNudgeAnswer;
              const next: Turn = {
                ...t,
                // If we're about to auto-retry, freeze the visible
                // bubble in "still streaming" state so the user
                // never sees a flicker of a failed answer. The
                // retry below resets content+reasoning before the
                // next stream starts. For auto-continue we KEEP
                // the content and just keep `streaming: true` so
                // the caret stays attached to the existing text
                // while the continuation streams in on top.
                content: triggerRetry ? t.content : nextContent,
                reasoning:
                  !appendOnly && (chunk.reasoning?.length ?? 0) > (t.reasoning?.length ?? 0)
                    ? (chunk.reasoning ?? t.reasoning)
                    : t.reasoning,
                reasoningEndedAtMs:
                  !appendOnly &&
                  t.reasoningStartedAtMs !== undefined &&
                  t.reasoningEndedAtMs === undefined
                    ? now
                    : t.reasoningEndedAtMs,
                streaming: recovering ? true : false,
                finishReason: recovering ? null : reason,
                partial: recovering ? false : isPartial || t.partial,
              };
              if (!recovering) {
                finalisedTurnSnapshot = next;
              }
              return next;
            }),
          );
          // Persist outside the reducer (the reducer must stay
          // pure). `queueMicrotask` keeps it on the same tick so a
          // panel-unmount race can't drop the write.
          if (finalisedTurnSnapshot) {
            const snap = finalisedTurnSnapshot as Turn;
            // Stream lifecycle complete — drop the in-flight marker
            // so a subsequent navigation back to this conversation
            // hydrates from DB normally.
            inFlightConvsRef.current.delete(targetConvId);
            Promise.resolve().then(() => {
              void persistAssistantTurnRef.current?.(snap, targetConvId);
            });
          }
          if (triggerRetry) {
            dbg('auto_retry', { reason: 'short_content_after_timeout' });
            // Hand off to a fresh attempt. We re-enter `runStream`
            // synchronously here (no await): the surrounding async
            // call site is already awaiting the original IPC, and
            // we don't want to extend that closure's lifetime past
            // its own `done`. Wiping the visible content+reasoning
            // first prevents the user from seeing a half-second
            // flash of the failed nub when the retry races.
            setTurnsForConv(targetConvId, (prev) =>
              prev.map((t) =>
                t.id === targetTurnId
                  ? {
                      ...t,
                      content: '',
                      reasoning: undefined,
                      reasoningStartedAtMs: t.streamStartedAtMs ?? Date.now(),
                      reasoningEndedAtMs: undefined,
                    }
                  : t,
              ),
            );
            void runStreamRef.current?.({
              targetTurnId,
              targetConvId,
              history,
              appendOnly: false,
              retryAttempt: 1,
            });
          } else if (triggerAutoContinue) {
            dbg('auto_continue', { reason: 'mid_body_stall' });
            // Mid-body stall recovery. We mirror what the user's
            // manual `Continue` button does: ship the original
            // history + the partial answer + a synthetic "keep
            // going from where you stopped" instruction, and
            // stream the continuation back into the same bubble
            // (`appendOnly: true`).
            //
            // We deliberately don't reuse `continueTruncated`'s
            // closure because (a) it walks `turns` state which
            // may not have flushed yet, and (b) we already have
            // the exact pre-prompt history and the just-finalized
            // content right here in scope — no need to round-trip
            // through component state. The instruction phrasing
            // matches `continueTruncated`'s so the model behaves
            // identically whether the recovery was auto or manual.
            const continueHistory: ChatMessage[] = [
              ...history,
              { role: 'assistant', content: nextContentSnapshot },
              {
                role: 'user',
                content:
                  'Continue your previous response from exactly where you stopped. Do not repeat any sentence you already wrote. Output the continuation directly with no preamble.',
              },
            ];
            void runStreamRef.current?.({
              targetTurnId,
              targetConvId,
              history: continueHistory,
              appendOnly: true,
              retryAttempt: 1,
            });
          } else if (triggerNudgeAnswer) {
            dbg('nudge_answer', { reason: 'answer_hidden_in_reasoning' });
            // "Answer is in reasoning" recovery. The model already
            // worked out the answer privately; we just need it to
            // emit that answer as the actual response. We pass a
            // synthetic assistant turn carrying whatever fragment
            // it did produce (so the model knows where to pick up
            // from), then a user turn with a hard, channel-aware
            // instruction. `appendOnly: true` keeps the existing
            // fragment visible so the user doesn't see a flicker
            // of empty content during the retry.
            const continueHistory: ChatMessage[] = [
              ...history,
              { role: 'assistant', content: nextContentSnapshot },
              {
                role: 'user',
                content:
                  'Your answer was incomplete in the response. Re-emit your final answer now as the assistant message — do not put it in the reasoning or scratchpad. Cover the same points you already worked through, formatted for direct user consumption (markdown allowed). Continue from where you stopped without repeating yourself.',
              },
            ];
            void runStreamRef.current?.({
              targetTurnId,
              targetConvId,
              history: continueHistory,
              appendOnly: true,
              retryAttempt: 1,
            });
          }
        } else if (chunk.type === 'error') {
          dbg('error', { message: chunk.message });
          // Symmetric to the `done` recovery path: a transport-
          // level abort (SSE socket reset, JSON parse failure, TLS
          // hiccup) mid-body shouldn't strand the user with a
          // half-sentence either. Same auto-continue conditions:
          // first attempt, not appendOnly, content has substance.
          // Below threshold or already on a continuation, we do
          // the boring thing — set the error banner and stop.
          let recover = false;
          let snapshot = '';
          let errorTurnSnapshot: Turn | null = null;
          setTurnsForConv(targetConvId, (prev) =>
            prev.map((t) => {
              if (t.id !== targetTurnId) return t;
              const length = t.content.trim().length;
              if (retryAttempt === 0 && !appendOnly && length >= 40) {
                recover = true;
                snapshot = t.content;
                return { ...t, streaming: true, error: undefined, partial: false };
              }
              const next: Turn = {
                ...t,
                streaming: false,
                error: chunk.message,
                partial: true,
              };
              errorTurnSnapshot = next;
              return next;
            }),
          );
          if (errorTurnSnapshot) {
            const snap = errorTurnSnapshot as Turn;
            // Terminal error path — no retry coming, mark the
            // conversation idle so subsequent navigations hydrate
            // normally.
            inFlightConvsRef.current.delete(targetConvId);
            Promise.resolve().then(() => {
              void persistAssistantTurnRef.current?.(snap, targetConvId);
            });
          }
          if (recover) {
            const continueHistory: ChatMessage[] = [
              ...history,
              { role: 'assistant', content: snapshot },
              {
                role: 'user',
                content:
                  'Continue your previous response from exactly where you stopped. Do not repeat any sentence you already wrote. Output the continuation directly with no preamble.',
              },
            ];
            void runStreamRef.current?.({
              targetTurnId,
              targetConvId,
              history: continueHistory,
              appendOnly: true,
              retryAttempt: 1,
            });
          }
        }
      };

      try {
        await ipc.aiChatCompletionStream(
          {
            provider_id: activeProvider.id,
            messages: history,
            // No surface-level `max_tokens` cap. We used to send 1200
            // here, which was the silent culprit behind the user's
            // "yanıtlar yarıda kesiliyor" reports — a 1200-token
            // budget is comfortably exhausted by a small reasoning
            // model that uses 400 tokens of internal scratchpad
            // before its first answer token. Now we defer to the
            // provider's `max_output_tokens` (configured globally in
            // AI Settings) and to the model's own context cap. When
            // either still triggers truncation, the backend captures
            // `finish_reason: "length"` and we surface a Continue
            // affordance so the user is never left with a half-
            // sentence and no recourse.
            options: { temperature: 0.4 },
          },
          onChunk,
        );
      } catch (e) {
        if (!isStillCurrent()) return;
        const message = e instanceof Error ? e.message : String(e);
        let outerErrorSnapshot: Turn | null = null;
        setTurnsForConv(targetConvId, (prev) =>
          prev.map((t) => {
            if (t.id !== targetTurnId) return t;
            const next: Turn = {
              ...t,
              streaming: false,
              error: message,
              partial: true,
            };
            outerErrorSnapshot = next;
            return next;
          }),
        );
        if (outerErrorSnapshot) {
          const snap = outerErrorSnapshot as Turn;
          inFlightConvsRef.current.delete(targetConvId);
          Promise.resolve().then(() => {
            void persistAssistantTurnRef.current?.(snap, targetConvId);
          });
        }
      }
    },
    [provider, bumpRequestId, setTurnsForConv],
  );
  // Keep the ref pointed at the latest `runStream`. Reassigned every
  // render; cheap and avoids the circular-dep problem described at
  // the ref's declaration. The auto-retry path inside `runStream`
  // dereferences this ref so it always invokes the freshest closure
  // (with the current `provider`, etc.).
  runStreamRef.current = runStream;

  const send = useCallback(
    async (overrideText?: string, providerOverride?: AiProvider) => {
      // `overrideText` lets the surface-triggered auto-send path
      // hand the prompt in directly. We previously relied on
      // `setInput(prompt)` landing before `send()` reads `input`,
      // which is fragile when React schedules the re-render across
      // an rAF (StrictMode dev replays in particular dropped the
      // prompt). Accepting an explicit text source removes the race
      // entirely. Manual sends still pass nothing → fall back to
      // the live composer state.
      //
      // `providerOverride` lets the same path pin a specific
      // provider for this single dispatch — important for the
      // surface popover flow where `setProvider(p)` was just called
      // and `provider` from closure is still pointing at the
      // previous selection. Manual sends omit this and use the
      // live `provider` state.
      const text = (overrideText ?? input).trim();
      if (!text) return;
      const activeProvider = providerOverride ?? provider;
      if (!activeProvider) {
        setProviderError('No AI provider configured. Add one from Settings → AI.');
        return;
      }

      cancel();
      setInput('');

      // Ensure a conversation row exists. First send into an empty
      // panel auto-creates a `'free'` conversation seeded from the
      // user's first prompt (truncated to 60 chars for the title).
      // Surface-triggered chats already have an id from `openAiChat`
      // — we keep it.
      let convId = activeConversationId;
      if (!convId) {
        try {
          const newId = await ipc.createConversation({
            title: text.slice(0, 60),
            origin: 'free',
            context_json: null,
          });
          convId = newId;
          // Mark this id as "loaded" before we set it on the store
          // so our hydration effect's id-change guard skips the
          // round-trip — the conversation is empty, no need to fetch.
          loadedConversationIdRef.current = newId;
          setActiveConversation(newId);
        } catch (e) {
          setProviderError(
            `Couldn't start conversation: ${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        }
      }

      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      const startedAt = Date.now();
      const assistantTurn: Turn = {
        id: `a-${startedAt}`,
        role: 'assistant',
        content: '',
        streaming: true,
        streamStartedAtMs: startedAt,
        reasoningStartedAtMs: startedAt,
        // Snapshot the *active* provider into the turn. Without this,
        // switching models mid-conversation would silently relabel
        // every prior assistant turn with the new model name (the
        // header just read from the live `provider` state). The user
        // explicitly asked for "hangi mesaj hangi modele gitmiş bunu
        // tutalım" — capturing at send-time is the only way to make
        // that promise honest.
        providerName: activeProvider.name,
        modelName: activeProvider.model || undefined,
        // Stamp the action hook (if any) onto the turn at creation
        // time. We deliberately apply it to *every* assistant turn in
        // the session — a follow-up question still benefits from the
        // primary "Use as commit" / "Insert standup" affordance, and
        // computing "first turn only" on the fly during render would
        // need extra state to track whether the action was already
        // taken. Cheap to over-stamp; harmless for free chat (kind:
        // 'none' renders nothing).
        actionHook: getActionHook(convId) ?? undefined,
      };

      const history: ChatMessage[] = [];
      history.push({ role: 'system', content: SYSTEM_PROMPT });
      if (contextSystemMessage) {
        history.push({ role: 'system', content: contextSystemMessage });
      }
      // Surface-triggered chats carry a one-shot system message with
      // the actual evidence (diff blob, log line, project state). We
      // ship it on EVERY turn in the conversation (not just the
      // first) so the model still grounds in that evidence on a
      // follow-up question — without this, "explain again in fewer
      // words" would silently drop the diff context.
      const surfaceCtxForSend = getSurfaceContext(convId);
      if (surfaceCtxForSend) {
        history.push({ role: 'system', content: surfaceCtxForSend });
      }
      for (const t of turns) {
        if (t.error) continue;
        history.push({ role: t.role, content: t.content });
      }
      history.push({ role: 'user', content: text });

      if (!convId) {
        // Should be impossible — either the panel had an active
        // conversation or the createConversation block above
        // populated `convId`. Bail loudly rather than appending
        // turns to a phantom slot.
        setProviderError("Couldn't resolve a conversation id for this send.");
        return;
      }
      // Append directly into THIS conversation's slot. Going through
      // the active-conv setter would race the just-fired
      // `setActiveConversation(newId)` because React hasn't committed
      // it yet — `setTurns` would see activeConversationId === null
      // and silently no-op, losing the user's message.
      setTurnsForConv(convId, (prev) => [...prev, userTurn, assistantTurn]);
      // Persist the user's message immediately. Don't await — IPC is
      // a few-ms round-trip even on cold cache, blocking the stream
      // start would add visible latency. If it fails, the stream
      // still proceeds; persistence is best-effort and the in-memory
      // turn is canonical for the rest of this session.
      void persistUserMessage(userTurn, convId);

      await runStream({
        targetTurnId: assistantTurn.id,
        // Pin the stream to this conversation regardless of what the
        // user does next — switching tabs mid-stream now leaves this
        // request happily writing into the originating slot rather
        // than silently retargeting (or being cancelled) when active
        // changes.
        targetConvId: convId,
        history,
        appendOnly: false,
        // Forward the override so the IPC actually goes to the
        // user's just-picked provider rather than whatever React's
        // committed `provider` state holds at this exact moment.
        providerOverride: providerOverride,
      });
    },
    [
      cancel,
      contextSystemMessage,
      input,
      provider,
      runStream,
      turns,
      activeConversationId,
      setActiveConversation,
      setTurnsForConv,
      persistUserMessage,
      getSurfaceContext,
      getActionHook,
    ],
  );
  sendRef.current = send;

  /**
   * Resume a truncated assistant turn (last `done` had
   * `finish_reason === "length"`). Appends new tokens onto the same
   * bubble so the result reads as one continuous answer.
   */
  const continueTruncated = useCallback(async () => {
    if (!provider) return;
    // Continue is always invoked from the visible conversation —
    // pin the stream there so a later tab switch doesn't drift the
    // chunks onto the wrong slot.
    const convId = activeConversationId;
    if (!convId) return;
    // Find the most recent assistant turn that ended in a state we
    // can resume: truncation by max_tokens (`length`), an upstream
    // stall (`timeout` — synthesised by the Rust parser), or a
    // generally `partial` turn (model bailed early or stuffed the
    // answer into reasoning). We walk turns end-to-front to handle
    // the case where the user already kept typing past the cut-off
    // — Continue still resumes the original interruption, not
    // whatever came after.
    const target = [...turns]
      .reverse()
      .find(
        (t) =>
          t.role === 'assistant' &&
          !t.streaming &&
          !t.error &&
          (t.finishReason === 'length' || t.finishReason === 'timeout' || t.partial === true),
      );
    if (!target) return;

    cancel();

    // Pick a continuation prompt that matches the failure mode.
    // A `length`/`timeout` cut-off needs "pick up exactly where you
    // stopped"; a "partial without finish reason" almost always
    // means the model emitted its reasoning as a final answer and
    // sent only a fragment as the response — for that case we
    // explicitly tell it to write the answer in the response
    // channel this time.
    const reasoningHeavyBail =
      target.finishReason !== 'length' &&
      target.finishReason !== 'timeout' &&
      (target.reasoning?.trim().length ?? 0) >= 200 &&
      target.content.trim().length < 80;
    const continuationPrompt = reasoningHeavyBail
      ? 'Your answer was incomplete in the response. Re-emit your final answer now as the assistant message — do not put it in the reasoning or scratchpad. Cover the same points you already worked through, formatted for direct user consumption (markdown allowed). Continue from where you stopped without repeating yourself.'
      : 'Continue your previous response from exactly where you stopped. Do not repeat any sentence you already wrote. Output the continuation directly with no preamble.';

    // Build history including the truncated answer as-is, then a
    // synthetic user message that nudges the model to continue.
    // Phrased to discourage repetition (small models love to
    // restate their last sentence as a "warm-up" before continuing).
    const history: ChatMessage[] = [];
    history.push({ role: 'system', content: SYSTEM_PROMPT });
    if (contextSystemMessage) {
      history.push({ role: 'system', content: contextSystemMessage });
    }
    const surfaceCtxForContinue = getSurfaceContext(convId);
    if (surfaceCtxForContinue) {
      history.push({ role: 'system', content: surfaceCtxForContinue });
    }
    for (const t of turns) {
      if (t.error) continue;
      history.push({ role: t.role, content: t.content });
    }
    history.push({
      role: 'user',
      content: continuationPrompt,
    });

    // Mark target as streaming again, clear the truncation flag so
    // the banner disappears immediately (avoids a double-click
    // creating two continuations). We also clear `partial` — the
    // user is actively recovering it, so don't leave a stale
    // "incomplete" badge attached to a turn that's about to grow.
    setTurns((prev) =>
      prev.map((t) =>
        t.id === target.id ? { ...t, streaming: true, finishReason: null, partial: false } : t,
      ),
    );

    await runStream({
      targetTurnId: target.id,
      targetConvId: convId,
      history,
      appendOnly: true,
    });
  }, [
    activeConversationId,
    cancel,
    contextSystemMessage,
    getSurfaceContext,
    provider,
    runStream,
    setTurns,
    turns,
  ]);

  const newChat = useCallback(() => {
    // Drop active to null so the panel shows its empty/welcome
    // state and the next send auto-creates a fresh `'free'`
    // conversation row. We deliberately do NOT cancel the outgoing
    // tab's stream (if any) or purge its per-conv state — the tab
    // stays in the rail; navigating back to it should resume the
    // running answer (or show its partial state) intact. This is
    // the symmetric counterpart to selectTab leaving streams alone.
    setActiveConversation(null);
    consumedDraftIdRef.current = null;
    setInput('');
    inputRef.current?.focus();
  }, [setActiveConversation]);

  /**
   * Switch to a different tab. Streams in the OUTGOING tab keep
   * running — only an explicit Stop or tab-close cancels. This is
   * the fix for "geri geldiğimde başa sardığını görüyorum": the
   * legacy implementation called `cancel()` here, which bumped the
   * shared request id and marked any streaming turn as `partial`.
   * With per-conversation request ids and per-conversation turn
   * state, we can let the chunk handler keep writing into A's slot
   * while the user is reading B.
   */
  const selectTab = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      setActiveConversation(id);
    },
    [activeConversationId, setActiveConversation],
  );

  /**
   * Drop all per-conv state for a closed tab so the maps don't leak
   * across long sessions. Only called for genuine closures — tab
   * switches retain everything for "go back and resume" UX.
   */
  const purgeConvState = useCallback(
    (id: string) => {
      cancelFor(id);
      surfaceContextByConvRef.current.delete(id);
      actionHookByConvRef.current.delete(id);
      persistedTurnIdsByConvRef.current.delete(id);
      // Keep turnsByConv around briefly? No — once the tab is gone
      // the user can't see it; the History drawer reloads from DB.
      setTurnsByConv((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [cancelFor],
  );

  /**
   * Close a tab from the bar. Cancel + purge that specific tab's
   * stream and per-conv state so a long session doesn't accumulate
   * abandoned conversations in memory. Sibling tabs are untouched —
   * they keep streaming if they were mid-answer.
   */
  const closeTabFromBar = useCallback(
    (id: string) => {
      purgeConvState(id);
      closeTab(id);
    },
    [purgeConvState, closeTab],
  );

  /**
   * "Close Others" handler. The store collapses the rail down to
   * just `keepId`; we purge per-conv state for every tab being
   * closed so their streams stop and their state doesn't linger.
   * `keepId` itself is left alone — its stream (if any) keeps
   * running.
   */
  const closeOthersFromBar = useCallback(
    (keepId: string) => {
      for (const id of openTabs) {
        if (id !== keepId) purgeConvState(id);
      }
      closeOtherTabs(keepId);
    },
    [openTabs, purgeConvState, closeOtherTabs],
  );

  /**
   * "Close to the Right" handler. Purge each conversation we're
   * about to close; everything at or before the anchor stays put,
   * including any streams those tabs have running.
   */
  const closeToRightFromBar = useCallback(
    (id: string) => {
      const idx = openTabs.indexOf(id);
      if (idx < 0) return;
      for (let i = idx + 1; i < openTabs.length; i += 1) {
        const closingId = openTabs[i];
        if (closingId) purgeConvState(closingId);
      }
      closeTabsToRight(id);
    },
    [openTabs, purgeConvState, closeTabsToRight],
  );

  /**
   * "Close All" handler. Purge every conversation in the rail —
   * everything in the panel collapses back to the empty state.
   */
  const closeAllFromBar = useCallback(() => {
    for (const id of openTabs) {
      purgeConvState(id);
    }
    closeAllTabs();
  }, [openTabs, purgeConvState, closeAllTabs]);

  const isStreaming = turns.some((t) => t.streaming);
  /**
   * Set of tab ids whose conversation has at least one streaming
   * turn — including tabs that aren't currently on screen. Drives
   * the per-tab spinner in ChatTabs so the user can see at a glance
   * which background tabs are still working. We rebuild on every
   * turnsByConv change, but the set creation is cheap (O(N) over
   * open tabs) and the ChatTabs prop is referentially compared so
   * downstream re-renders are gated by content, not identity.
   */
  const streamingTabIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of openTabs) {
      const tabTurns = turnsByConv.get(id);
      if (tabTurns && tabTurns.some((t) => t.streaming)) ids.add(id);
    }
    return ids;
  }, [openTabs, turnsByConv]);

  /**
   * Auto-grow the composer textarea to fit its content.
   *
   * The textarea ships with `rows={1}` so a fresh chat looks like a
   * single-line input (Cursor / ChatGPT / Linear all do this). The
   * tradeoff: as the user types `Shift+Enter` for a multi-line
   * prompt, the textarea would otherwise just gain an internal
   * scrollbar — they can no longer see what they wrote without
   * scrolling, which is awful for prompts that are deliberately
   * long (paste a stack trace, draft a careful question).
   *
   * Fix: on every value change, snap the height to `auto` (so the
   * browser recomputes intrinsic content height into `scrollHeight`)
   * and then commit the measured height back, capped at 180px so a
   * 30-line paste doesn't crowd the answer pane off-screen. Past the
   * cap the textarea reveals a scrollbar — same behaviour as
   * Cursor's composer when you exceed its ~10-line cap.
   *
   * `useLayoutEffect` (not plain `useEffect`) so the height update
   * happens before paint. With `useEffect`, programmatic value
   * changes — e.g. consuming an AI draft or clearing on send — would
   * paint one frame at the *old* height and then snap, which reads
   * as a visible flicker on slower machines.
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 180 mirrors the Tailwind `max-h-[180px]` on the textarea — kept
    // identical here so the cap is the *same* number regardless of
    // whether the browser hits it via CSS (paste) or JS (typing).
    const next = Math.min(el.scrollHeight, 180);
    el.style.height = `${next}px`;
  }, [input]);

  /**
   * Best-effort live title for the currently-active tab. We use the
   * first user turn as the source of truth — same heuristic the
   * conversation row's `title` column uses when it gets persisted —
   * so a brand-new chat shows a meaningful label on the active tab
   * the moment the user types, instead of waiting for the IPC
   * round-trip that creates the conversation row. Falls back to
   * undefined which lets `ChatTabs` use its cached title (or the
   * "New chat" placeholder).
   */
  const activeTabTitle = useMemo(() => {
    const firstUser = turns.find((t) => t.role === 'user');
    if (!firstUser) return null;
    const trimmed = firstUser.content.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 60);
  }, [turns]);

  if (!isOpen) return null;

  // Drawer = legacy fixed-position slide-in (used when the right
  // activity rail isn't part of the layout). Inline = mounted inside
  // the rail-driven shell which already provides positioning, border,
  // and (most importantly) the close affordance via the active icon.
  const isInline = variant === 'inline';

  return (
    <div
      className={cn(
        // `relative` so the History drawer (absolute, right-anchored)
        // can pin itself to this panel's bounding box rather than
        // escaping to the nearest positioned ancestor.
        'relative flex flex-col',
        // Inline mode is always hosted by `RightSidePanel`, which
        // already paints `chrome-gradient` + `bg-surface-raised` to
        // match the left rail. Painting our own `bg-surface` on top
        // hides that chrome and makes the right panel feel like a
        // different "kind" of UI than the left — exactly the visual
        // mismatch the user flagged. Drop our background in inline
        // mode and let the parent show through; the floating
        // overlay variant still needs its own opaque background
        // because it sits on top of the dashboard.
        isInline
          ? 'h-full min-h-0 w-full flex-1 bg-transparent'
          : 'bg-surface border-border fixed top-9 right-0 bottom-7 z-60 w-[440px] max-w-[100vw] border-l shadow-[-12px_0_40px_rgba(0,0,0,0.35)]',
      )}
      role={isInline ? undefined : 'dialog'}
      aria-label={isInline ? undefined : 'AI Chat'}
    >
      {/* Header: chat title + lifecycle controls only.
       *  Provider/model used to live here as a `· name / model`
       *  suffix, but now that the composer carries a proper model
       *  pill (Cursor-style) showing it twice felt redundant and
       *  cramped the title row when long model names truncated.
       *  The pill in the composer is the single source of truth. */}
      <header className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="text-accent h-3.5 w-3.5" />
        <div className="text-fg text-[12px] font-semibold">AI Chat</div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          title="Chat history"
          className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] transition"
        >
          <History className="h-3 w-3" />
          History
        </button>
        {/* Header "New" is the cold-start affordance (no tabs yet).
         *  Once at least one tab exists the bar's own "+" takes
         *  over — keeping both visible would have two different-
         *  looking controls firing the same action right next to
         *  each other, which is the visual debt the user explicitly
         *  flagged earlier in the chat. */}
        {openTabs.length === 0 && (
          <button
            type="button"
            onClick={newChat}
            disabled={turns.length === 0 && !activeConversationId && !isStreaming}
            title="New chat"
            className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        )}
        {/* In inline mode the rail icon doubles as the close button —
            a per-panel × would be a confusing second control surface
            for the same job. Drawer mode keeps its explicit close
            affordance (no rail to fall back on). */}
        {!isInline && (
          <button
            type="button"
            onClick={closePanel}
            title="Close (Esc)"
            className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 w-6 items-center justify-center rounded transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      <ChatTabs
        openTabs={openTabs}
        activeConversationId={activeConversationId}
        activeTitleOverride={activeTabTitle}
        activeStreaming={isStreaming}
        streamingTabIds={streamingTabIds}
        onSelect={selectTab}
        onClose={closeTabFromBar}
        onCloseOthers={closeOthersFromBar}
        onCloseToRight={closeToRightFromBar}
        onCloseAll={closeAllFromBar}
        onNew={newChat}
        // Disable "+" when the active chat is already a fresh empty
        // one: spawning another would be a no-op and just confuse
        // the user with an "I clicked but nothing happened" state.
        newDisabled={turns.length === 0 && !activeConversationId && !isStreaming}
      />

      {providerError && (
        <div className="border-status-error/30 bg-status-error/5 text-status-error flex items-center gap-1.5 border-b px-3 py-2 text-[11px]">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="flex-1">{providerError}</span>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((t, idx) => {
              // Show the Continue affordance only on the *last*
              // resumable assistant turn — chaining multiple
              // continuations off mid-conversation interruptions
              // would be confusing (which one would Continue
              // resume?). The last turn is also what the user is
              // looking at right now, which is the only place a
              // banner reads "fix this".
              //
              // Resumable = truncated by `max_tokens` (`length`),
              // stalled mid-stream (`timeout` — synthesised by the
              // Rust parser), OR generally `partial` (model bailed
              // early / stuffed the answer into reasoning). All
              // three leave the user staring at an unfinished
              // bubble; Continue is the same fix — re-ask the
              // model to pick up from where it stopped.
              const isLastResumable =
                idx === turns.length - 1 &&
                t.role === 'assistant' &&
                !t.streaming &&
                !t.error &&
                (t.finishReason === 'length' || t.finishReason === 'timeout' || t.partial === true);
              return (
                <TurnView
                  key={t.id}
                  turn={t}
                  onContinue={isLastResumable ? continueTruncated : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {contextChips.length > 0 && (
        <div className="border-border/60 flex flex-wrap gap-1 border-t px-3 pt-2 pb-1">
          <span className="text-fg-dim text-[9px] font-semibold tracking-[0.12em] uppercase">
            Context
          </span>
          {contextChips.map((chip) => (
            <span
              key={chip.id}
              className="bg-accent/10 text-accent rounded px-1.5 py-0.5 font-mono text-[10px]"
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {/* Composer footer — Cursor-style.
       *
       * Anatomy (top-down):
       *   1. A single rounded "shell" that owns *all* the chrome.
       *      The shell uses a soft `bg-fg/3` base and a transparent
       *      border that lights up to `border-border/70` on
       *      `focus-within`. We REPLACE the global accent
       *      `:focus-visible` outline (set in `styles.css`) with a
       *      contained, neutral border-glow so the composer doesn't
       *      get an angry orange box around it the moment the user
       *      clicks in — that was the #1 visual complaint.
       *   2. Borderless textarea on top, full-width. We disable the
       *      global focus ring with `focus-visible:outline-none` and
       *      let the parent shell render the focus state instead.
       *   3. Bottom row: model pill on the left (mirrors Cursor's
       *      "Opus 4.7 High" affordance, but ours is informational
       *      — clicking opens the AI Settings provider list), and a
       *      single circular send/stop button on the right. No
       *      separate "Enter to send" footer; the keyboard hint
       *      lives inside the send button's tooltip + a tiny dim
       *      glyph on the button itself, so it's always visible
       *      without taking a third row.
       *
       * The whole composer is `cursor-text` so anywhere inside the
       * shell counts as "click to focus the input" — matching how
       * Cursor / ChatGPT / Linear all behave.
       */}
      <div className="px-3 pb-3">
        <div
          className={cn(
            // Shell: rounded card that holds the textarea + controls.
            // `border-transparent` keeps layout stable when focus
            // lands; on focus-within we swap to a neutral border so
            // the shell glows in the muted way Cursor does — never
            // the loud accent ring browsers draw by default.
            'rounded-app bg-fg/3 cursor-text border',
            'border-border/40 focus-within:border-border/80 focus-within:bg-fg/5',
            'shadow-[inset_0_1px_0_rgb(255_255_255/0.02)]',
            'transition-colors',
          )}
          onClick={(e) => {
            // Avoid stealing focus when the user is clicking a
            // child button (model pill, send) — only the shell's
            // own dead space should refocus the input.
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming) void send();
              }
            }}
            placeholder={
              selectedService
                ? `Ask about ${selectedService.name}, your logs, or anything else…`
                : 'Ask anything about your projects, diffs, or logs…'
            }
            rows={1}
            className={cn(
              // Reset all the form-input chrome the global stylesheet
              // and `*:focus-visible` rule would otherwise paint.
              'block w-full resize-none border-0 bg-transparent',
              'px-3 pt-2.5 pb-1.5',
              'text-fg placeholder:text-fg/35 text-[13px] leading-snug',
              'outline-none focus:ring-0 focus:outline-none',
              // The global `*:focus-visible` rule (1.5px accent ring)
              // is the source of the orange box. `!` outranks it.
              'focus-visible:ring-0! focus-visible:outline-none!',
              // Cap height so a 30-line paste doesn't push the bottom
              // controls off the bottom of the panel.
              'max-h-[180px] min-h-[24px]',
            )}
          />

          {/* Bottom control row. */}
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            {provider ? (
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  title={`${provider.name} · ${provider.model || 'no model'}`}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  // `tabIndex={-1}` keeps Tab from cycling onto the
                  // pill — the textarea is the focal control here,
                  // and the pill is a secondary affordance. (Cursor
                  // uses the same pattern: their model selector is
                  // reachable but skipped by default Tab order.)
                  tabIndex={-1}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                    'text-fg-dim hover:text-fg hover:bg-fg/5 transition-colors',
                    pickerOpen && 'text-fg bg-fg/5',
                  )}
                >
                  <Sparkles className="text-accent/70 h-3 w-3" />
                  <span className="max-w-[180px] truncate">{provider.model || provider.name}</span>
                  <ChevronDown
                    className={cn(
                      'h-2.5 w-2.5 opacity-50 transition-all group-hover:opacity-90',
                      pickerOpen && 'rotate-180 opacity-90',
                    )}
                  />
                </button>
                {pickerOpen && (
                  <ModelPicker
                    providers={providers}
                    activeId={provider.id}
                    onSelect={selectProvider}
                    onManage={openAiSettingsFromPicker}
                    awaitingAutoSend={awaitingAutoSend}
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={openAiSettingsFromPicker}
                tabIndex={-1}
                className={cn(
                  'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                  'text-fg-dim hover:text-fg hover:bg-fg/5 transition-colors',
                )}
              >
                <Settings className="h-3 w-3" />
                <span>Configure model…</span>
              </button>
            )}

            <span className="flex-1" />

            {/* Token meter — Cursor-style "12.4k / 128k" gauge. Hidden
             *  when there's literally nothing to count (fresh empty
             *  composer with no history) so the empty state stays
             *  uncluttered. */}
            {(tokenCount == null || tokenCount > 0) && (
              <TokenMeter
                count={tokenCount}
                contextWindow={provider?.context_window ?? null}
                className="mr-1.5"
              />
            )}

            {/* Send / stop. One slot, two roles — same pattern as
             * Cursor / ChatGPT. The icon morphs to communicate
             * state; the slot itself never moves so the user's
             * mouse muscle memory survives mid-stream cancels. */}
            {isStreaming ? (
              <button
                type="button"
                onClick={cancel}
                title="Stop (Esc)"
                aria-label="Stop generating"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  'bg-fg/10 hover:bg-fg/20 text-fg/90 transition-colors',
                )}
              >
                <Square className="h-3 w-3" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || !provider}
                title="Send · Enter"
                aria-label="Send message"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                  // Active: solid accent fill so the button is the
                  // composer's clear focal point.
                  'bg-accent text-accent-fg hover:bg-accent-hover',
                  // Disabled: drop into the same neutral tone as the
                  // stop button so an "empty + idle" composer doesn't
                  // shout for attention with a glowing accent block.
                  'disabled:bg-fg/10 disabled:text-fg-dim/70 disabled:cursor-not-allowed',
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>

        {/* Hint row — tucked outside the shell so the shell stays
         *  visually clean. We only show it when the user hasn't
         *  typed yet *and* there's no chat history; once either is
         *  true the user already knows how the input works and the
         *  hint is just visual debt. */}
        {input.length === 0 && turns.length === 0 && !isStreaming && (
          <div className="text-fg-dim/60 mt-1.5 flex items-center gap-1.5 px-1 text-[10px]">
            <CornerDownLeft className="h-2.5 w-2.5" />
            <span>Enter to send · Shift+Enter for newline{!isInline ? ' · Esc to close' : ''}</span>
          </div>
        )}
      </div>

      <HistoryDrawer
        open={historyOpen}
        activeConversationId={activeConversationId}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => {
          setHistoryOpen(false);
          if (id !== activeConversationId) {
            // cancel any in-flight stream attached to the previous
            // conversation before swapping rosters; otherwise the
            // pending tokens would land on whichever turn id the
            // new conversation happens to have first.
            cancel();
            setActiveConversation(id);
          }
        }}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-fg-dim flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[12px]">
      <Sparkles className="text-accent/60 h-6 w-6" />
      <div className="flex flex-col gap-1.5">
        <p className="text-fg/80 font-medium">Ask anything about your projects.</p>
        <p className="text-[11px] leading-snug">
          The active service is automatically attached as context. For diff or log explanations
          right-click those surfaces — they have purpose-built popovers.
        </p>
      </div>
    </div>
  );
}

/**
 * Single chat turn renderer.
 *
 * Wrapped in `React.memo` because mid-stream the parent calls
 * `setTurns` on every delta — without memoisation, *every* historical
 * turn's `ReactMarkdown` re-parses on every keystroke-of-the-model.
 * That's the bulk of the "burası biraz donuyor" freeze the user
 * reported on long answers (200+ deltas × N turns × full markdown
 * AST rebuild).
 *
 * Memo's referential-equality comparison is enough here: the parent
 * mutates only the streaming turn's object reference (`.map` returns
 * a new object only for `t.id === targetTurnId`), so non-streaming
 * turns hand the same `turn` reference back next render and skip.
 *
 * The streaming turn DOES have to re-render — that's the whole
 * point — but we additionally route its content through
 * `useDeferredValue` so React can drop intermediate frames under
 * pressure and the markdown parser doesn't run on every single
 * 5-token delta.
 */
const TurnView = memo(function TurnView({
  turn,
  onContinue,
}: {
  turn: Turn;
  /** Provided iff this turn was truncated by `max_tokens` AND it's
   *  the most recent assistant turn — see the call-site comment in
   *  `AiChatPanel` for the "last truncated only" rule. When set,
   *  the truncation banner renders a Continue button that resumes
   *  the answer in-place. */
  onContinue?: () => void;
}) {
  // Defer the markdown source for the streaming turn. React will
  // schedule the markdown re-render at a lower priority than user
  // interaction, so typing in the textarea or scrolling stays
  // responsive even while a 50-token-per-second model is firing
  // deltas at us. For non-streaming turns this is a no-op (the
  // value is already settled).
  const deferredContent = useDeferredValue(turn.content);

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-accent/10 text-fg/95 max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2 text-[12.5px] leading-snug wrap-break-word whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  // Compact model label shown next to the "RunHQ AI" header. We
  // prefer the model id (what the user actually picked in the
  // picker — "gpt-4o-mini", "glm-5.1") over the provider's display
  // name, falling back to the latter when the provider has no
  // explicit model. Truncated to keep multi-paragraph turn headers
  // single-line on the narrow chat panel.
  const modelLabel = turn.modelName || turn.providerName;

  return (
    <div className="flex flex-col gap-1">
      <div className="text-fg-dim flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.12em] uppercase">
        {turn.streaming ? (
          <Loader2 className="text-accent h-2.5 w-2.5 animate-spin" />
        ) : turn.error ? (
          <AlertTriangle className="text-status-error h-2.5 w-2.5" />
        ) : (
          <Sparkles className="text-accent h-2.5 w-2.5" />
        )}
        <span>RunHQ AI</span>
        {modelLabel && (
          <>
            <span className="text-fg-dim/40 font-normal tracking-normal normal-case" aria-hidden>
              ·
            </span>
            <span
              className="text-fg-dim/80 max-w-[180px] truncate font-mono text-[9.5px] font-normal tracking-normal normal-case"
              title={
                turn.providerName && turn.modelName
                  ? `${turn.providerName} · ${turn.modelName}`
                  : modelLabel
              }
            >
              {modelLabel}
            </span>
          </>
        )}
        {/*
         * "Incomplete" pill — fires whenever the assistant turn ends
         * in a non-clean state (cancellation, transport error, or any
         * future reason that doesn't already get a dedicated banner).
         * The `length` and `timeout` cases get their own actionable
         * banners below, so we suppress the pill there to avoid
         * piling redundant chrome on the same turn. For everything
         * else the pill is the single visible signal that this
         * answer didn't finish naturally — important once Phase 1
         * persists conversations and the user revisits an old chat
         * where they don't remember why a turn looks short.
         */}
        {turn.partial &&
          !turn.streaming &&
          !turn.error &&
          turn.finishReason !== 'length' &&
          turn.finishReason !== 'timeout' && (
            <>
              <span className="text-fg-dim/40 font-normal tracking-normal normal-case" aria-hidden>
                ·
              </span>
              <span
                className="border-status-starting/40 bg-status-starting/10 text-status-starting rounded-sm border px-1 py-px text-[9px] font-semibold tracking-normal normal-case"
                title="This answer ended before the model finished — it was cancelled or interrupted."
              >
                incomplete
              </span>
            </>
          )}
      </div>
      {!turn.error && (
        <ReasoningPill
          reasoning={turn.reasoning ?? ''}
          startedAtMs={turn.reasoningStartedAtMs ?? null}
          endedAtMs={turn.reasoningEndedAtMs ?? null}
        />
      )}
      {turn.error ? (
        <p className="text-status-error text-[11.5px] leading-snug wrap-break-word">{turn.error}</p>
      ) : (
        <div className="ai-answer-body text-fg/90 text-[12.5px] leading-[1.55] wrap-break-word">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPACT_MARKDOWN_COMPONENTS}>
            {deferredContent || (turn.streaming ? '…' : '')}
          </ReactMarkdown>
          {turn.streaming && (
            <span className="bg-accent ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle" />
          )}
        </div>
      )}

      {/* Truncation banner.
       *
       * Shows up under any non-streaming assistant turn whose stream
       * stopped because it hit `max_tokens` (`finish_reason === "length"`).
       * The button only appears on the *last* such turn — see the
       * call-site filter that decides whether to pass `onContinue`.
       *
       * Why this matters: before this banner, a truncated answer was
       * indistinguishable from "the model finished, that's just a
       * short answer". The user reported repeated mid-sentence
       * cutoffs ("yanıtlar yarıda kesiliyor abi"). Surfacing the
       * cause (and offering a one-click fix) is the only durable
       * solution — token budgets will always run out for some
       * combination of model, prompt, and reasoning depth.
       */}
      {!turn.streaming && !turn.error && turn.finishReason === 'length' && (
        <div
          className={cn(
            'border-status-starting/30 bg-status-starting/5 mt-1 flex items-center gap-2',
            'rounded-md border px-2.5 py-1.5 text-[11px]',
          )}
          role="status"
        >
          <Scissors className="text-status-starting h-3 w-3 shrink-0" />
          <span className="text-fg-dim flex-1 leading-snug">
            Response was cut off (max tokens reached). Increase{' '}
            <span className="text-fg/70 font-mono">max_output_tokens</span> in AI Settings, or:
          </span>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className={cn(
                'bg-accent text-accent-fg hover:bg-accent-hover',
                'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
              )}
            >
              Continue
            </button>
          )}
        </div>
      )}

      {/* Generic "incomplete" banner — fires for any non-streaming
       *  partial turn that doesn't already match the `length` or
       *  `timeout` cases above. Most common trigger: a local
       *  reasoning-heavy model emitted its full answer in the
       *  reasoning channel and only a fragment in the body, then
       *  closed cleanly with `finish_reason: stop`. Without a
       *  Continue affordance the user is stranded — the badge
       *  alone isn't actionable. */}
      {!turn.streaming &&
        !turn.error &&
        turn.partial &&
        turn.finishReason !== 'length' &&
        turn.finishReason !== 'timeout' && (
          <div
            className={cn(
              'border-status-starting/30 bg-status-starting/5 mt-1 flex items-center gap-2',
              'rounded-md border px-2.5 py-1.5 text-[11px]',
            )}
            role="status"
          >
            <AlertTriangle className="text-status-starting h-3 w-3 shrink-0" />
            <span className="text-fg-dim flex-1 leading-snug">
              Answer looks incomplete — the model may have stopped early or kept its reply in the
              reasoning trace.
            </span>
            {onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className={cn(
                  'bg-accent text-accent-fg hover:bg-accent-hover',
                  'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
                )}
                title="Ask the model to continue and place the final answer here"
              >
                Continue
              </button>
            )}
          </div>
        )}

      {/* Idle-timeout banner — synthesised by the Rust parser when
       *  the upstream went silent without sending `finish_reason`,
       *  `[DONE]`, or closing the TCP socket. Distinct copy from
       *  the truncation banner because the failure mode is
       *  different: there's nothing the user can do about token
       *  budgets here, the model itself (or its proxy) flatlined.
       *  Telling them to "increase max_output_tokens" would be
       *  actively misleading. */}
      {!turn.streaming && !turn.error && turn.finishReason === 'timeout' && (
        <div
          className={cn(
            'border-status-error/30 bg-status-error/5 mt-1 flex items-center gap-2',
            'rounded-md border px-2.5 py-1.5 text-[11px]',
          )}
          role="status"
        >
          <AlertTriangle className="text-status-error h-3 w-3 shrink-0" />
          <span className="text-fg-dim flex-1 leading-snug">
            Stream stalled — the model stopped sending tokens. This is usually a flaky upstream; try
            again or switch models.
          </span>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className={cn(
                'bg-accent text-accent-fg hover:bg-accent-hover',
                'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
              )}
              title="Resume from where the stream stalled"
            >
              Continue
            </button>
          )}
        </div>
      )}

      {/* Surface action hook button.
       *
       * Renders only on completed, non-error assistant turns whose
       * action hook isn't `none`. We deliberately don't show it
       * while streaming — half a commit message is worse than
       * waiting another second, and the visual churn of the button
       * appearing/disappearing as the answer grows would be
       * distracting.
       *
       * The click dispatches a window-level event the originating
       * surface listens for. We don't auto-close the chat panel
       * after the action — the user might want to send a follow-up
       * ("make it shorter", "use imperative tense") and re-fire the
       * action with the refined version. The receiving surface is
       * responsible for any local UX (selecting its own input,
       * showing a "filled" toast, etc.).
       */}
      {!turn.streaming &&
        !turn.error &&
        turn.actionHook &&
        turn.actionHook.kind !== 'none' &&
        turn.content.trim().length > 0 && (
          <ActionHookButton hook={turn.actionHook} content={turn.content} />
        )}
    </div>
  );
});

/**
 * Primary CTA rendered below an assistant turn whose conversation
 * was opened from a non-chat surface (Commit, Standup, …). Kept as
 * its own component so the imports for `dispatchAiAction` /
 * `actionHookLabel` don't bloat the giant TurnView memo, and so the
 * "applied" feedback state can live in local state without forcing a
 * `TurnView` re-render on every click.
 */
function ActionHookButton({ hook, content }: { hook: AiActionHook; content: string }) {
  const [applied, setApplied] = useState(false);
  const label = actionHookLabel(hook);
  if (!label) return null;
  const onClick = () => {
    const ok = dispatchAiAction(hook, content);
    if (!ok) return;
    setApplied(true);
    // Reset to the primary state after a beat — the user can re-run
    // the action against an edited follow-up turn, and showing a
    // permanent "Applied ✓" would imply the button is one-shot.
    window.setTimeout(() => setApplied(false), 1800);
  };
  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
          applied
            ? 'bg-status-success/15 text-status-success border-status-success/30 border'
            : 'bg-accent text-accent-fg hover:bg-accent-hover',
        )}
      >
        {applied ? (
          <>
            <Check className="h-3 w-3" />
            <span>Applied</span>
          </>
        ) : (
          <>
            <Sparkles className="h-3 w-3" />
            <span>{label}</span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Floating model picker shown above the composer's pill button.
 *
 * Anatomy:
 *   - Provider list: each row shows the human name + the configured
 *     model id (smaller, dim) so the user can disambiguate two
 *     providers pointing at the same model id (e.g. local Ollama
 *     vs. OpenAI for `gpt-4o`).
 *   - Active row gets a check mark on the right and an accent text
 *     colour. Hover lifts non-active rows.
 *   - Footer divider + "Manage providers…" item that opens the AI
 *     Settings dialog. Even with one provider configured we keep
 *     this visible so the user can edit `max_output_tokens` /
 *     base URL without hunting for the gear icon.
 *
 * Positioning: the pill is anchored bottom-aligned, the picker
 * pops up *above* it (`bottom-full mb-1`) so it doesn't push the
 * send button off-screen. Width is capped at 280px which fits
 * even the longest provider name + model combos we've seen
 * without truncating ("OpenAI Production · gpt-4o-mini-2024-07-18").
 */
function ModelPicker({
  providers,
  activeId,
  onSelect,
  onManage,
  awaitingAutoSend = false,
}: {
  providers: AiProvider[];
  activeId: string;
  onSelect: (p: AiProvider) => void;
  onManage: () => void;
  /** When true, the picker was opened by a surface-triggered draft
   *  (Why? / Diff Explain / etc) with `autoSend: true` and 2+
   *  configured providers. Selecting a row will fire the send
   *  immediately. We surface a one-line hint at the top of the list
   *  so the click doesn't feel like a surprise. */
  awaitingAutoSend?: boolean;
}) {
  return (
    <div
      role="listbox"
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1.5',
        'bg-surface-raised border-border/80 max-w-[320px] min-w-[260px]',
        'rounded-app overflow-hidden border shadow-lg shadow-black/30',
      )}
    >
      {awaitingAutoSend && (
        <div
          className={cn(
            'border-border/60 bg-accent/8 text-accent',
            'border-b px-2.5 py-1.5 text-[10.5px] font-medium tracking-wide uppercase',
          )}
        >
          Pick a model to send
        </div>
      )}
      <div className="max-h-[280px] overflow-y-auto py-1">
        {providers.length === 0 ? (
          <div className="text-fg-dim px-2.5 py-2 text-[11px]">No providers configured.</div>
        ) : (
          providers.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => onSelect(p)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                  'hover:bg-fg/5',
                  isActive && 'bg-accent/8',
                )}
              >
                <Sparkles
                  className={cn('h-3 w-3 shrink-0', isActive ? 'text-accent' : 'text-fg-dim/70')}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-[11.5px] font-medium',
                      isActive ? 'text-fg' : 'text-fg/85',
                    )}
                  >
                    {p.name}
                  </div>
                  {p.model && (
                    <div className="text-fg-dim/70 truncate font-mono text-[10px]">{p.model}</div>
                  )}
                </div>
                {isActive && <Check className="text-accent h-3 w-3 shrink-0" />}
              </button>
            );
          })
        )}
      </div>
      <div className="border-border/60 border-t">
        <button
          type="button"
          onClick={onManage}
          className={cn(
            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
            'text-fg-dim hover:bg-fg/5 hover:text-fg text-[11px]',
          )}
        >
          <Settings className="h-3 w-3" />
          <span>Manage providers…</span>
        </button>
      </div>
    </div>
  );
}
