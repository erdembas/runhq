import type { ConversationOrigin } from '@/types';

/**
 * Surface-specific action embedded in an assistant turn.
 *
 * Drives the small "Use as commit message" / "Copy to standup" /
 * "Insert into editor" pill that appears under an answer when the
 * conversation was triggered from a non-chat surface. The frontend
 * owns the dispatch — the backend never sees these.
 */
export type AiActionHook =
  | { kind: 'use_as_commit'; service_id: string }
  | { kind: 'insert_standup' }
  | { kind: 'none' };

export interface AiDraft {
  /** Conversation this draft is tied to. The panel picks the draft
   *  up only when its `activeConversationId` matches — protects
   *  against stale drafts firing into the wrong chat after a fast
   *  rail-icon click. */
  conversationId: string;
  /** Pre-filled composer text. The panel injects it; the user sees
   *  it in the textarea and can edit before sending. */
  draftPrompt?: string;
  /** Hidden system message shipped with the first user send.
   *  Carries the surface-specific evidence (the diff blob, the log
   *  line, the project state JSON). NEVER persisted to the
   *  conversation row — that's the panel's job; this is just the
   *  runtime ferry. */
  contextSystemMessage?: string;
  /** Action hook stamped on the assistant turn that comes back.
   *  Used to render the "Use as commit message" / "Copy standup"
   *  buttons. `none` for free chat where there's nothing surface-
   *  specific to do with the answer. */
  actionHook?: AiActionHook;
  /** Whether to auto-send the draft on receipt. `false` is the
   *  "draft mode" the user explicitly asked for: the model picker
   *  stays interactive, the prompt is editable, send is manual. */
  autoSend?: boolean;
  /** When set, the panel forces this provider as the active one
   *  before dispatching the draft, bypassing both its current
   *  selection and the in-panel multi-model picker. Used by the
   *  surface-side popover (`useAiSurfaceTrigger`) — it captures
   *  the user's choice next to the trigger button so the panel
   *  doesn't need to ask again. */
  forcedProviderId?: string;
}

export interface OpenAiChatInput {
  origin: ConversationOrigin;
  /** Title shown in the History drawer. Keep it short — 60 chars
   *  max in practice, the drawer truncates anything longer. */
  title: string;
  /** Surface-specific evidence persisted on the `conversations`
   *  row. Free-form JSON; surfaces decide their own shape. */
  context?: Record<string, unknown>;
  draftPrompt?: string;
  contextSystemMessage?: string;
  actionHook?: AiActionHook;
  /** Default `false`: open the chat panel in draft mode so the user
   *  can pick a model / edit the prompt before sending. Pass `true`
   *  for fire-and-forget surfaces like Why? where the user already
   *  committed by clicking the action. */
  autoSend?: boolean;
  /** Pin a specific provider for the dispatched send. Surfaces that
   *  show their own model-chooser popover (via
   *  `useAiSurfaceTrigger`) capture the user's pick at click-time
   *  and pass it through here so the panel can fire immediately
   *  against the chosen model — no in-panel re-prompt. */
  forcedProviderId?: string;
}

export interface AiChatStoreSlice {
  /**
   * AI Chat Hub state.
   *
   * `activeConversationId` is the conversation currently rendered in
   * the chat panel. Null means "fresh chat / no conversation yet" —
   * the panel renders an empty state and creates a new conversation
   * on the first send.
   *
   * `aiDraft` is the surface-trigger handoff. When a button on the
   * dashboard / log / diff / commit panel asks "open chat with this
   * pre-filled prompt and this hidden context", it stuffs the
   * payload here, and the panel picks it up via a one-shot effect.
   * We keep it on the store rather than passing it as props because
   * the trigger and the chat panel live in completely different
   * subtrees (sidebar vs right rail) and prop-drilling through 6
   * layers of layout would be miserable.
   *
   * The draft is consumed by the panel exactly once on mount (or
   * when `aiDraft.conversationId` flips to the new one), then
   * cleared so reopening the panel later doesn't re-fire the same
   * prompt.
   */
  activeConversationId: string | null;
  aiDraft: AiDraft | null;
  /**
   * Multi-tab chat: ids the user is actively juggling, capped at
   * {@link MAX_OPEN_TABS}. Order = display order in the tab bar
   * (left → right). The active tab is the one whose id matches
   * {@link activeConversationId}.
   *
   * Adding a tab is implicit — any `setActiveConversation(id)` /
   * `openAiChat(...)` ensures the id lives in this list. Eviction
   * is FIFO from the head, but never evicts the *active* tab and
   * never evicts an in-flight (streaming) tab — those guarantees
   * are enforced by `setActiveConversation` and friends. The user
   * always has explicit control via `closeTab(id)`.
   */
  openTabs: string[];
  setActiveConversation: (id: string | null) => void;
  /**
   * Close a tab. If the tab being closed is the active one, the
   * active id snaps to the neighbour (next, then previous, then
   * null if nothing is left). Cancelling any in-flight stream
   * attached to the closing tab is the panel's job — the store
   * just keeps the list consistent.
   */
  closeTab: (id: string) => void;
  /**
   * Bulk-close every tab except `keepId`. The kept tab becomes
   * active so the user is never left looking at a now-closed tab.
   * No-op when `keepId` isn't in `openTabs`. Like {@link closeTab},
   * the panel is responsible for cancelling any streams attached
   * to closing tabs.
   */
  closeOtherTabs: (keepId: string) => void;
  /**
   * Close every tab to the right of (after) the given id, leaving
   * the id itself plus everything before it open. If the active
   * tab was in the closed range, active snaps back to the
   * right-clicked tab — same "you don't lose your place" guarantee
   * as `closeTab`.
   */
  closeTabsToRight: (id: string) => void;
  /**
   * Close every tab. `activeConversationId` becomes null so the
   * panel falls back to its empty state. Useful as a "reset the
   * rail" gesture; the underlying conversations are not deleted —
   * History drawer can still bring them back.
   */
  closeAllTabs: () => void;
  /**
   * Universal entry point for non-chat surfaces to send a request
   * into the chat panel. Creates a new conversation row, stashes
   * the draft, opens the AI panel, and switches the panel to that
   * conversation. The panel is responsible for rendering the draft
   * (auto-send vs draft-mode is decided by `autoSend`).
   *
   * Returns the new conversation id so the caller can navigate
   * the user to it later (e.g. an "Undo" toast that scrolls back
   * to the just-fired conversation).
   */
  openAiChat: (input: OpenAiChatInput) => Promise<string | null>;
  clearAiDraft: () => void;
}
