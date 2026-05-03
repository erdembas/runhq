import { create } from 'zustand';
import type {
  ConversationOrigin,
  DependencyScanEntry,
  DependencyScanResult,
  DetectedEditor,
  GitStatus,
  ListeningPort,
  LogLine,
  OverviewSummary,
  PersistedScan,
  ResourceSample,
  Section,
  SectionColor,
  SectionId,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
} from '@/types';
import { nextSectionColor } from '@/lib/sectionColors';
import { ipc } from '@/lib/ipc';

/**
 * Identifier for each Settings hub page.
 *
 * Lives in the store (not next to `SettingsView`) so the store can
 * type its `settingsCategory` slot without importing from the
 * component layer — that import direction would create a cycle
 * because `SettingsView` already pulls store actions for category
 * content (AI provider list, sidebar pin, etc.). Components import
 * the type from here.
 */
export type SettingsCategoryId = 'shortcuts' | 'ai' | 'data' | 'about' | 'danger';

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

interface LogBuffer {
  lines: LogLine[];
  lastSeq: number;
}

/**
 * A tab in the main content area.
 *
 * Three kinds:
 *   - `dashboard` — the workspace overview. Always present, never closable;
 *     acts as the "home" tab the user can fall back to when every other
 *     tab has been closed.
 *   - `service`  — an individual service's log/terminal view. `refId` is
 *     the service id.
 *   - `stack`    — a stack detail view. `refId` is the stack id.
 *
 * Tabs are addressed by a stable composite key `${kind}:${refId}` so the
 * tab strip can dedup and React can use it as a list key.
 */
export type MainTabKind = 'dashboard' | 'service' | 'stack' | 'settings' | 'release-notes';
export interface MainTab {
  kind: MainTabKind;
  refId: string;
}

export const DASHBOARD_TAB: MainTab = { kind: 'dashboard', refId: 'dashboard' };

/**
 * Singleton tab for the Settings hub. Settings used to live as a
 * fullscreen overlay that unmounted the entire main-tabs tree on
 * open/close — with 5+ service tabs that meant a 200–500 ms freeze
 * on every round trip (xterm DOM re-attach + buffer replay, split
 * layouts re-reading localStorage, dashboard filter pipeline, etc.).
 *
 * Settings is now a regular main tab so it benefits from the same
 * mount-stability guarantees the rest of the strip enjoys: opening
 * it just *adds* a tab next to whatever's already there, closing it
 * snaps focus back to the previous tab, and switching between tabs
 * is CSS visibility (no remount).
 *
 * `refId` is constant — there's only ever one Settings tab at a
 * time. The composite key `mainTabKey(SETTINGS_TAB)` doubles as the
 * tab-strip address and the dedup key.
 */
export const SETTINGS_TAB: MainTab = { kind: 'settings', refId: 'settings' };

/**
 * Singleton tab for the Release Notes archive — same rationale as
 * `SETTINGS_TAB` above (fullscreen-overlay re-mount thrash → real
 * tab so the rest of the workspace stays warm).
 */
export const RELEASE_NOTES_TAB: MainTab = { kind: 'release-notes', refId: 'release-notes' };

export function mainTabKey(tab: MainTab): string {
  return `${tab.kind}:${tab.refId}`;
}

export const DASHBOARD_TAB_KEY = mainTabKey(DASHBOARD_TAB);
export const SETTINGS_TAB_KEY = mainTabKey(SETTINGS_TAB);
export const RELEASE_NOTES_TAB_KEY = mainTabKey(RELEASE_NOTES_TAB);

export type SidebarGroupBy = 'none' | 'category' | 'runtime' | 'status';
export type DashboardGroupBy = 'none' | 'category' | 'runtime' | 'status';
/**
 * Dashboard intra-group sort axis.
 *   • name      — alphabetical (default, stable)
 *   • activity  — most-recent commit first, never-touched last
 *   • risk      — CVE+outdated composite, worst first (zero-risk projects
 *                 keep their alphabetical order to avoid a weird reshuffle)
 *   • memory    — running projects by RSS desc, then non-running alphabetical
 *   • cpu       — running projects by CPU% desc, then non-running alphabetical
 */
export type DashboardSortBy = 'name' | 'activity' | 'risk' | 'memory' | 'cpu';
export type SidebarStatusFilter = 'all' | 'running' | 'stopped';

interface AppStore {
  services: ServiceDef[];
  /**
   * Whether the very first `listServices` IPC has resolved. Starts
   * `false` and flips to `true` once App.tsx has hydrated the roster
   * — even if the result was an empty array. The dashboard uses this
   * to render a skeleton instead of either a) a confusingly empty
   * frame, or b) the "no services yet" onboarding card (which would
   * flash for 200-400ms during a normal cold start where services
   * *do* exist but haven't arrived from Rust yet).
   *
   * We deliberately don't model this as a "loading: true|false"
   * — the frontend is `false`-on-load forever after the initial
   * hydration; subsequent service add/remove operations are
   * optimistic and don't need to flicker the skeleton back on.
   */
  servicesLoaded: boolean;
  statuses: Record<ServiceId, ServiceStatus>;
  logs: Record<string, LogBuffer>;
  ports: ListeningPort[];
  editors: DetectedEditor[];
  /**
   * Per-service git snapshot. `null` means "checked, not a repo"; `undefined`
   * means "not yet loaded" so the UI can show a loading shimmer before the
   * first poll returns.
   */
  git: Record<ServiceId, GitStatus | null>;
  /** Most recent CPU + memory sample per running service (2s cadence from Rust). */
  resources: Record<ServiceId, ResourceSample>;
  /** Rolling CPU% history per service for sparklines — bounded to [`RESOURCE_HISTORY_MAX`]. */
  resourceHistory: Record<ServiceId, number[]>;
  selectedServiceId: ServiceId | null;
  selectedCmdName: string | null;
  selectedStackId: string | null;
  appVersion: string | null;
  stateDir: string | null;

  /**
   * Open tabs in the main content area.
   *
   * Order matters — left-to-right in the tab strip. The dashboard is
   * always present at index 0 and cannot be closed; service/stack
   * tabs append on the right and can be closed individually. When a
   * tab is closed and was the active one, the active tab snaps to its
   * left neighbour (or to the dashboard if nothing else is open).
   *
   * State (terminal sessions, log filter inputs, scroll positions,
   * etc.) is preserved per tab by keeping every tab mounted in the
   * DOM and toggling visibility via `display: none`. This means
   * switching back to a tab restores it exactly as the user left
   * it — no remount, no re-fetch, no re-spawn of TerminalPane PTYs.
   */
  mainTabs: MainTab[];
  activeMainTabKey: string;
  /**
   * Per-service "open this body tab when the LogPanel mounts/runs"
   * request slot. Set by callers that want to deep-link into a
   * specific tab inside the service view (e.g. ServiceCard's notes
   * button → "open this service AND focus the Notes tab").
   *
   * The LogPanel reads it in an effect, applies the requested tab,
   * and clears the entry. Keyed by service id rather than a single
   * global slot because the user could legitimately request two
   * different services in quick succession (Cmd+click on two notes
   * buttons) and we don't want the second request to be eaten by
   * the first LogPanel's pending-consume.
   *
   * Stored as a free string ('logs' | 'docs' | 'notes' at the
   * moment) rather than a strict enum so the LogPanel-local
   * `MainTab` type can evolve (add new tabs) without forcing a
   * cross-file type change here.
   */
  pendingServiceBodyTab: Record<ServiceId, string>;
  /**
   * Pinned tab keys, addressed via {@link mainTabKey}. Pinned tabs sit
   * immediately after the dashboard (which itself is never pinned —
   * it's already sticky) and before any unpinned tab; the bar enforces
   * `[Dashboard, ...pinned (in pin order), ...unpinned (in user order)]`
   * as a hard invariant via {@link toggleMainTabPin} / drag handlers.
   *
   * Persisted to localStorage so the pin state survives reloads even
   * though the underlying tabs are session-scoped — when the user
   * re-opens a previously pinned service from the sidebar, the new
   * tab snaps back into the pinned zone automatically.
   *
   * Bulk-close affordances ("Close Others", "Close to the Right /
   * Left", "Close All") never touch pinned tabs — that's the whole
   * point of pinning.
   */
  pinnedMainTabKeys: string[];
  /**
   * Open a tab. If the tab already exists (matched by composite key),
   * it's just activated; otherwise it's appended to the right and
   * activated. For service / stack tabs this also keeps
   * `selectedServiceId` / `selectedStackId` in sync so the sidebar
   * highlight follows the active tab.
   */
  openMainTab: (tab: MainTab) => void;
  closeMainTab: (key: string) => void;
  setActiveMainTab: (key: string) => void;
  /**
   * Toggle the pinned state for a tab. Pinning a tab moves it to the
   * end of the pinned zone (immediately after the last pinned tab,
   * or immediately after the dashboard if no tab is pinned yet).
   * Unpinning moves it to the start of the unpinned zone (right
   * after the last pinned tab). The dashboard tab can never be
   * pinned — pin requests for it silently no-op.
   */
  toggleMainTabPin: (key: string) => void;
  /**
   * Drag-reorder handler. Re-slots `activeKey` to the position of
   * `overKey` (insert-before semantics; pass `null` for end).
   * Reorder is only allowed within the same zone (pinned ↔ pinned
   * or unpinned ↔ unpinned); cross-zone drops are rejected to keep
   * the pin/unpin boundary explicit. Use {@link toggleMainTabPin}
   * to flip a tab's zone.
   */
  reorderMainTabs: (activeKey: string, overKey: string | null) => void;
  /**
   * Move a tab one slot left within its zone. No-op when the tab is
   * already the leftmost in its zone (first pinned tab, or first
   * unpinned tab right after the pin boundary). Symmetric to
   * {@link moveMainTabRight}.
   */
  moveMainTabLeft: (key: string) => void;
  moveMainTabRight: (key: string) => void;
  /**
   * Close every tab except `keepKey` (and the always-sticky
   * dashboard). The kept tab becomes active so the user is never
   * left looking at a now-closed tab. No-op if `keepKey` isn't in
   * `mainTabs`.
   */
  closeOtherMainTabs: (keepKey: string) => void;
  /**
   * Close every tab strictly to the right of `key`. The anchor tab
   * itself plus everything to its left stays open. If the active
   * tab was in the closed range, active snaps back to the anchor.
   */
  closeMainTabsToRight: (key: string) => void;
  /**
   * Close every tab strictly to the left of `key`, except the
   * dashboard which is always kept (it can't be closed). The
   * anchor tab plus everything to its right stays. If the active
   * tab was in the closed range, active snaps to the anchor.
   */
  closeMainTabsToLeft: (key: string) => void;
  /**
   * Close every tab except the dashboard, returning the user to
   * the home view. Useful as a "reset workspace" gesture from the
   * tab context menu.
   */
  closeAllMainTabs: () => void;

  // UI state.
  categoryFilter: string[];
  runtimeFilter: string[];
  /**
   * Sidebar-only status filter. Lets the user hide stopped services without
   * committing to a category/runtime pill — the most common "just show me
   * what's running" slice.
   */
  sidebarStatusFilter: SidebarStatusFilter;
  /**
   * How the sidebar service list is grouped. Defaults to a flat alphabetical
   * list because category grouping added visual noise for typical repos
   * (< 20 services); users can still switch to category/runtime/status
   * grouping from the filter menu when lists grow.
   */
  sidebarGroupBy: SidebarGroupBy;
  dashboardGroupBy: DashboardGroupBy;
  dashboardSortBy: DashboardSortBy;
  /**
   * Whether the dashboard reveals services flagged
   * `hide_dashboard: true`. Off by default — those services exist
   * to be tracked in the sidebar / palette / search only, and
   * surfacing them on the dashboard would re-pollute the very
   * surface the flag was created to protect. The dashboard renders
   * a single "N hidden" toggle chip when at least one such service
   * exists, letting power users peek at the full roster without
   * editing each service back to visible.
   */
  dashboardShowHidden: boolean;
  search: string;
  editorService: ServiceDef | null | undefined;
  stacks: StackDef[];
  editorStack: StackDef | null | undefined;

  /**
   * Sidebar-only organisational groups. Sections are a pure UI concept —
   * they carry no runtime semantics and are never sent to the backend. A
   * service or stack may belong to at most one section; unassigned items
   * fall through to the "Unassigned" pseudo-section at the bottom.
   */
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
  /**
   * Per-bucket ordered list of sidebar items (services + stacks
   * interleaved) keyed by `service:<id>` or `stack:<id>`. The bucket
   * key is either a {@link SectionId} or the magic `__unassigned__`
   * sentinel.
   *
   * Items absent from the hint fall through to alphabetical order at
   * the end of the bucket — keeps freshly-added services from
   * disappearing when their key hasn't been recorded yet.
   *
   * Persisted in localStorage alongside the rest of the section
   * snapshot so a custom order survives reloads.
   */
  sectionItemOrder: Record<SectionId, string[]>;

  setServices: (services: ServiceDef[]) => void;
  upsertService: (svc: ServiceDef) => void;
  removeService: (id: ServiceId) => void;
  setStatus: (status: ServiceStatus) => void;
  appendLog: (key: string, line: LogLine) => void;
  replaceLogs: (key: string, lines: LogLine[]) => void;
  clearLogs: (key: string) => void;
  setPorts: (ports: ListeningPort[]) => void;
  setEditors: (editors: DetectedEditor[]) => void;
  setGit: (id: ServiceId, status: GitStatus | null) => void;
  setResources: (id: ServiceId, sample: ResourceSample) => void;
  setSelected: (id: ServiceId | null) => void;
  /**
   * Open a service tab AND queue a body-tab focus inside its
   * LogPanel. Used by surfaces like the dashboard's per-card notes
   * button so a click does both "show me the service" and "land
   * me on the notes tab" in one action — without this the notes
   * button would either open the service on the LOGS tab (wrong
   * affordance) or rely on a brittle "remember to switch" flow.
   *
   * Implemented as `setSelected(id)` plus a write into
   * `pendingServiceBodyTab[id]` so the LogPanel that mounts (or
   * is already mounted) for that service consumes the request
   * and clears it.
   */
  openServiceWithBodyTab: (id: ServiceId, bodyTab: string) => void;
  /**
   * LogPanel-side hook — clears a consumed `pendingServiceBodyTab`
   * entry. Pulled out as an explicit action (rather than letting
   * LogPanel mutate `set(...)` directly) so the call site stays
   * ergonomic and tests don't have to reach into the store shape.
   */
  consumePendingServiceBodyTab: (id: ServiceId) => void;
  setSelectedCmd: (cmdName: string | null) => void;
  setSelectedStack: (id: string | null) => void;
  setAppMeta: (version: string, stateDir: string) => void;

  setCategoryFilter: (keys: string[]) => void;
  setRuntimeFilter: (keys: string[]) => void;
  setSidebarStatusFilter: (v: SidebarStatusFilter) => void;
  setSidebarGroupBy: (v: SidebarGroupBy) => void;
  setDashboardGroupBy: (v: DashboardGroupBy) => void;
  setDashboardSortBy: (v: DashboardSortBy) => void;
  setDashboardShowHidden: (v: boolean) => void;
  resetSidebarFilters: () => void;
  setSearch: (q: string) => void;
  openEditor: (service: ServiceDef | null) => void;
  closeEditor: () => void;
  setStacks: (stacks: StackDef[]) => void;
  upsertStack: (stack: StackDef) => void;
  removeStack: (id: string) => void;
  openStackEditor: (stack: StackDef | null) => void;
  closeStackEditor: () => void;

  addSection: (name: string, color?: SectionColor) => SectionId;
  renameSection: (id: SectionId, name: string) => void;
  recolorSection: (id: SectionId, color: SectionColor) => void;
  deleteSection: (id: SectionId) => void;
  reorderSections: (ids: SectionId[]) => void;
  toggleSectionCollapsed: (id: SectionId) => void;
  /** Assign a service to a section, or pass `null` to move it to Unassigned. */
  assignServiceToSection: (serviceId: ServiceId, sectionId: SectionId | null) => void;
  assignStackToSection: (stackId: string, sectionId: SectionId | null) => void;
  /**
   * Atomically move a sidebar item (service or stack) into the given
   * bucket and slot it directly before `beforeKey` (or to the end if
   * `beforeKey` is null). Pass `targetSectionId: null` to drop into
   * Unassigned. Used by the in-section drag-to-reorder gesture so
   * "move + reorder" can't race against each other.
   */
  moveSidebarItem: (
    kind: 'service' | 'stack',
    id: string,
    targetSectionId: SectionId | null,
    beforeKey: string | null,
  ) => void;

  timelineOpen: boolean;
  openTimeline: () => void;
  closeTimeline: () => void;

  /**
   * VSCode-style right activity bar.
   *
   * Two icons live in a fixed 36px rail on the far right:
   *   - "activity" → ActivityTimeline panel
   *   - "ai"       → AI assistant chat panel
   *
   * `rightPanel === null` means the rail is shown but no panel is
   * expanded (full-width main content). Clicking a rail icon either
   * opens that panel or, if it's already active, collapses back to
   * `null`. Width is shared across panels to keep the resize gesture
   * predictable — switching from one panel to the other doesn't
   * suddenly reflow the content area.
   */
  rightPanel: 'activity' | 'ai' | null;
  rightPanelWidth: number;
  setRightPanel: (panel: 'activity' | 'ai' | null) => void;
  toggleRightPanel: (panel: 'activity' | 'ai') => void;
  setRightPanelWidth: (width: number) => void;

  /**
   * Whether the left sidebar is pinned open. When `false` the rail
   * collapses to a thin strip and re-expands on hover (the legacy
   * SidebarRail behaviour). The actual rendering still happens
   * inside `SidebarRail` — this flag is just the shared baseline so
   * the `toggle_left_sidebar` shortcut and any future surface (a
   * menu item, a quick-action command) can flip it without
   * prop-drilling.
   */
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarPinned: () => void;

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

  overview: OverviewSummary | null;
  overviewLoading: boolean;
  overviewScanning: boolean;
  /** Global "most-recent scan in this workspace" timestamp. Drives the
   *  dashboard header's "Last scanned X ago" label. Set by both
   *  `patchOverviewScan` (after an explicit scan) and
   *  `hydratePersistedScans` (on cold start) so we don't flash a
   *  "never scanned" state on every launch. */
  lastScanAt: number | null;
  /**
   * Per-project scan freshness, keyed by `service_id`. Sourced from
   * the persistent `dependency_scans` SQLite table on mount and updated
   * after every explicit scan. Lets a service card render its OWN
   * "Last scanned 3h ago" chip without needing to inflate
   * `OverviewSummary` with another field — the dashboard's project
   * overview mirrors what the Rust core knows; this is a UI-only
   * companion store.
   */
  scanFreshnessByService: Map<ServiceId, number>;
  /** Mirror of how long each project's last scan ran (ms). Optional —
   *  `null` for cache-hit entries from the in-memory L1. The drawer
   *  uses it to show "took 14s last time" before a manual rescan. */
  scanDurationByService: Map<ServiceId, number | null>;
  /**
   * Scan delta cache: per-service `{ outdated, vulns }` deltas
   * relative to the row this scan replaced. Drives the "+3 since
   * last scan" badge on the dashboard's audit/outdated chips.
   * Cleared when a service's scan reaches "fresh enough that the
   * delta is no longer interesting" (>30 minutes — see
   * `scanDeltaTtlMs`) so it doesn't linger as stale UI noise.
   */
  scanDeltasByService: Map<ServiceId, { outdated: number | null; vulnerabilities: number | null }>;
  /** Per-service "rescanning" flag so a card-level spinner can sit
   *  next to the freshness chip without bouncing the global
   *  `overviewScanning` state when only one project is being
   *  rescanned. */
  scanningServiceIds: Set<ServiceId>;
  setOverview: (v: OverviewSummary | null) => void;
  setOverviewLoading: (v: boolean) => void;
  setOverviewScanning: (v: boolean) => void;
  patchOverviewScan: (result: DependencyScanResult) => void;
  /**
   * Splice a single per-project rescan result into the overview and
   * freshness maps. Same shape as `patchOverviewScan` but for one
   * service — used by the per-card "Rescan this" affordance and any
   * future auto-rescan flows.
   */
  patchScanEntry: (entry: DependencyScanEntry) => void;
  /**
   * Track that a per-project rescan is in flight for `serviceId`,
   * so the card can render a spinner without consulting the global
   * scanning flag. Mirror of `setOverviewScanning` but scoped.
   */
  setScanningService: (serviceId: ServiceId, scanning: boolean) => void;
  /**
   * Replay the persisted scan rows fetched from SQLite into the live
   * dashboard state. Called once on app mount before the first
   * background overview refresh — without it the dashboard would
   * flash empty audit chips for ~30s on every cold start, even
   * though we have last night's scan saved on disk. Re-running it
   * after an explicit scan is also safe; the merge is by
   * `service_id` and the most recent scan always wins.
   */
  hydratePersistedScans: (rows: PersistedScan[]) => void;

  diffViewerOpen: boolean;
  diffViewerServiceId: ServiceId | null;
  /** Tab the Source Control window should land on when next opened.
   *  Cleared on close so subsequent opens don't inherit a stale choice
   *  from a previous session. Callers pass it via {@link openDiffViewer};
   *  most leave it undefined (defaults to "commit"), but the dashboard
   *  card's git popover passes "history" when the repo is clean so
   *  clicking the button on a clean repo lands on something useful
   *  instead of an empty Commit tab. */
  diffViewerInitialTab?: 'commit' | 'branches' | 'history' | 'graph';
  openDiffViewer: (
    serviceId: ServiceId,
    initialTab?: 'commit' | 'branches' | 'history' | 'graph',
  ) => void;
  closeDiffViewer: () => void;

  /** Cross-project uncommitted changes viewer — shows every service that
   *  has dirty files in one place so the user never forgets to commit a
   *  half-finished change in project X before context-switching. */
  crossProjectDiffOpen: boolean;
  openCrossProjectDiff: () => void;
  closeCrossProjectDiff: () => void;

  /**
   * Release-highlights modal. Auto-shown after a major/minor upgrade and
   * available on demand from Settings / sidebar version chip. We track
   * the version explicitly (rather than just `open: true`) so the modal
   * can render *any* shipped release entry, not only the latest one —
   * future "see what changed in 0.6.0" links from a release-history view
   * drop in without changing the trigger.
   */
  whatsNewOpen: boolean;
  whatsNewVersion: string | null;
  openWhatsNew: (version: string) => void;
  closeWhatsNew: () => void;

  /**
   * Release Notes — the permanent archive of every shipped release,
   * rendered into the main content area (alongside Dashboard /
   * LogPanel / StackDetail). The post-update {@link whatsNewOpen}
   * modal is the "celebrate" surface (one release, optionally auto-
   * shown over whatever the user is doing); this is the "browse"
   * surface (every release, takes over the main canvas like a real
   * page so screenshots and copy can breathe).
   *
   * `releaseNotesSelectedVersion` is purely a *hint* — the page
   * resolves it against the registry and falls back to the running
   * version, then to the latest entry, if the hint isn't a known
   * release. We separate it from `whatsNewVersion` so opening one
   * surface doesn't reset the other.
   *
   * Selecting a service / stack from the sidebar always closes Release
   * Notes (handled in {@link setSelected} / {@link setSelectedStack})
   * because the user has navigated *away* from the archive — leaving
   * it open behind the new selection would feel like a stuck modal.
   */
  releaseNotesOpen: boolean;
  releaseNotesSelectedVersion: string | null;
  openReleaseNotes: (version?: string) => void;
  closeReleaseNotes: () => void;

  /**
   * Settings hub state.
   *
   * `null` means the hub is closed and the main canvas shows the
   * tab content (Dashboard / LogPanel / StackDetail) as usual; any
   * other value opens the hub on the given category. Modeling this
   * as a single nullable id (instead of a boolean + an
   * "initialCategory" pair) means deep-linking to a specific page
   * from anywhere — status bar gear, status-bar AI cog, the
   * `quick-action://shortcuts` event, future `Cmd+,` shortcut — is
   * a single store call with no risk of the hub opening on a stale
   * page from the previous launch.
   *
   * Lives next to `releaseNotesOpen` because both follow the same
   * "fullscreen page that takes over the main canvas" pattern, and
   * sidebar navigation needs to clear *both* in lockstep so a tab
   * switch always wins back the canvas.
   */
  settingsCategory: SettingsCategoryId | null;
  openSettings: (category?: SettingsCategoryId) => void;
  closeSettings: () => void;

  /**
   * Diff viewer preference: when true, every DiffPane fetches the diff
   * with a huge `-U` context so Monaco can render the ENTIRE file with
   * unchanged code in place (not just the changed hunks + 3 lines).
   * Default on; reviewers can flip to hunk-only for giant files.
   * Persisted to localStorage so the choice sticks across sessions.
   */
  diffShowUnchanged: boolean;
  setDiffShowUnchanged: (v: boolean) => void;
}

const MAX_UI_LOG_LINES = 5_000;

/** Sparkline window size. 60 samples at 2s = 2 minutes of history — long
 *  enough to catch a start-up CPU burst fading into steady state without
 *  bloating the store for idle services. */
const RESOURCE_HISTORY_MAX = 60;

export function logKey(serviceId: string, cmdName: string): string {
  return `${serviceId}::${cmdName}`;
}

const SIDEBAR_PREFS_KEY = 'runhq.sidebar.prefs.v1';
const DASHBOARD_PREFS_KEY = 'runhq.dashboard.prefs.v1';

interface SidebarPrefs {
  statusFilter: SidebarStatusFilter;
  groupBy: SidebarGroupBy;
  categoryFilter: string[];
  runtimeFilter: string[];
}

function loadSidebarPrefs(): SidebarPrefs {
  if (typeof window === 'undefined') {
    return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
  }
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw)
      return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    return {
      statusFilter:
        parsed.statusFilter === 'running' || parsed.statusFilter === 'stopped'
          ? parsed.statusFilter
          : 'all',
      groupBy:
        parsed.groupBy === 'category' || parsed.groupBy === 'runtime' || parsed.groupBy === 'status'
          ? parsed.groupBy
          : 'none',
      categoryFilter: Array.isArray(parsed.categoryFilter) ? parsed.categoryFilter : [],
      runtimeFilter: Array.isArray(parsed.runtimeFilter) ? parsed.runtimeFilter : [],
    };
  } catch {
    return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
  }
}

function saveSidebarPrefs(prefs: SidebarPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota/private-mode failures are non-fatal; user state simply resets on
    // next launch.
  }
}

const initialSidebarPrefs = loadSidebarPrefs();

interface DashboardPrefs {
  groupBy: DashboardGroupBy;
  sortBy: DashboardSortBy;
  /** Default `false`: hidden services stay off the dashboard until the
   *  user explicitly toggles the "N hidden" chip. Persisted so the
   *  power-user "show me everything" mode survives reloads. */
  showHidden: boolean;
}

const VALID_GROUP_BYS: DashboardGroupBy[] = ['none', 'category', 'runtime', 'status'];
const VALID_SORT_BYS: DashboardSortBy[] = ['name', 'activity', 'risk', 'memory', 'cpu'];

function loadDashboardPrefs(): DashboardPrefs {
  const defaults: DashboardPrefs = { groupBy: 'category', sortBy: 'name', showHidden: false };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      groupBy: VALID_GROUP_BYS.includes(parsed.groupBy as DashboardGroupBy)
        ? (parsed.groupBy as DashboardGroupBy)
        : defaults.groupBy,
      sortBy: VALID_SORT_BYS.includes(parsed.sortBy as DashboardSortBy)
        ? (parsed.sortBy as DashboardSortBy)
        : defaults.sortBy,
      showHidden: typeof parsed.showHidden === 'boolean' ? parsed.showHidden : defaults.showHidden,
    };
  } catch {
    return defaults;
  }
}

function saveDashboardPrefs(prefs: DashboardPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota or private-mode failure — non-fatal
  }
}

const initialDashboardPrefs = loadDashboardPrefs();

const SECTIONS_KEY = 'runhq.sections.v1';

/**
 * Bucket key used by {@link sectionItemOrder} to address the
 * "Unassigned" pseudo-section. Mirrors the constant in
 * `components/sidebar/dnd.ts` — duplicated to keep the store free of
 * sidebar imports.
 */
const UNASSIGNED_BUCKET: SectionId = '__unassigned__';

function bucketOf(sectionId: SectionId | null | undefined): SectionId {
  return sectionId ?? UNASSIGNED_BUCKET;
}

function itemOrderKey(kind: 'service' | 'stack', id: string): string {
  return `${kind}:${id}`;
}

/**
 * Strip an item key from every bucket. Returns a new map only if a
 * bucket actually changed so unchanged callers don't flush identity
 * unnecessarily.
 */
function dropItemKey(order: Record<SectionId, string[]>, key: string): Record<SectionId, string[]> {
  let changed = false;
  const next: Record<SectionId, string[]> = {};
  for (const [bucket, list] of Object.entries(order)) {
    const filtered = list.filter((k) => k !== key);
    if (filtered.length !== list.length) changed = true;
    next[bucket] = filtered;
  }
  return changed ? next : order;
}

/**
 * Insert `key` into `bucket` directly before `beforeKey` (or at the
 * end when `beforeKey` is null/missing). Always strips the key from
 * every bucket first so a single call covers both "reorder within
 * bucket" and "move across buckets".
 */
function placeItemKey(
  order: Record<SectionId, string[]>,
  bucket: SectionId,
  key: string,
  beforeKey: string | null,
): Record<SectionId, string[]> {
  const cleaned = dropItemKey(order, key);
  const list = cleaned[bucket] ? [...cleaned[bucket]] : [];
  if (beforeKey == null) {
    list.push(key);
  } else {
    const idx = list.indexOf(beforeKey);
    if (idx < 0) list.push(key);
    else list.splice(idx, 0, key);
  }
  return { ...cleaned, [bucket]: list };
}

interface SectionsSnapshot {
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
  sectionItemOrder: Record<SectionId, string[]>;
}

function emptySections(): SectionsSnapshot {
  return {
    sections: [],
    serviceSection: {},
    stackSection: {},
    collapsedSections: {},
    sectionItemOrder: {},
  };
}

function loadSections(): SectionsSnapshot {
  if (typeof window === 'undefined') return emptySections();
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    if (!raw) return emptySections();
    const parsed = JSON.parse(raw) as Partial<SectionsSnapshot>;
    // Defensive: strip malformed entries rather than crashing the sidebar on
    // a corrupted prefs file.
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s): s is Section =>
            !!s &&
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            typeof s.color === 'string',
        )
      : [];
    return {
      sections,
      serviceSection:
        parsed.serviceSection && typeof parsed.serviceSection === 'object'
          ? (parsed.serviceSection as Record<ServiceId, SectionId>)
          : {},
      stackSection:
        parsed.stackSection && typeof parsed.stackSection === 'object'
          ? (parsed.stackSection as Record<string, SectionId>)
          : {},
      collapsedSections:
        parsed.collapsedSections && typeof parsed.collapsedSections === 'object'
          ? (parsed.collapsedSections as Record<SectionId, boolean>)
          : {},
      sectionItemOrder: (() => {
        const raw = parsed.sectionItemOrder;
        if (!raw || typeof raw !== 'object') return {};
        const out: Record<SectionId, string[]> = {};
        for (const [bucket, list] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(list)) {
            out[bucket] = list.filter((k): k is string => typeof k === 'string');
          }
        }
        return out;
      })(),
    };
  } catch {
    return emptySections();
  }
}

function saveSections(snapshot: SectionsSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(snapshot));
  } catch {
    // Same non-fatal policy as sidebar prefs.
  }
}

const initialSections = loadSections();

const DIFF_SHOW_UNCHANGED_KEY = 'runhq.diff.showUnchanged.v1';

function loadDiffShowUnchanged(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(DIFF_SHOW_UNCHANGED_KEY);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function saveDiffShowUnchanged(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DIFF_SHOW_UNCHANGED_KEY, v ? '1' : '0');
  } catch {
    // non-fatal (same policy as other prefs)
  }
}

const initialDiffShowUnchanged = loadDiffShowUnchanged();

// ─── Pinned main-tab persistence ────────────────────────────────────
// Only the *set* of pinned keys is persisted, not the tabs
// themselves. Tabs are session-scoped (open on demand), so reload
// behaviour is: the pinned-key list survives, and when a previously
// pinned service tab gets re-opened (sidebar click, dashboard tile),
// it snaps back into the pinned zone automatically. Pinning is
// therefore "remembered" across sessions without us needing to
// resurrect tabs nobody asked for.
const PINNED_TABS_KEY = 'runhq.mainTabs.pinned.v1';

function loadPinnedTabs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PINNED_TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      // Defensively reject the dashboard key (it could only end up
      // here via a corrupted prefs blob from a future build) so the
      // invariant "dashboard is never pinned" holds even on
      // malformed input.
      (k): k is string => typeof k === 'string' && k !== DASHBOARD_TAB_KEY,
    );
  } catch {
    return [];
  }
}

function savePinnedTabs(keys: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(keys));
  } catch {
    // non-fatal (same policy as the other prefs blobs above)
  }
}

const initialPinnedTabs = loadPinnedTabs();

/**
 * Index of the first non-dashboard, non-pinned tab in `tabs`. Equal
 * to `tabs.length` when every tab is either the dashboard or
 * pinned (i.e. no unpinned zone exists yet). Used as the insertion
 * point for newly-opened unpinned tabs and as the "boundary" the
 * drag/move operations clamp against.
 */
function pinBoundaryIndex(tabs: MainTab[], pinned: ReadonlySet<string>): number {
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab) continue;
    const key = mainTabKey(tab);
    if (key === DASHBOARD_TAB_KEY) continue;
    if (!pinned.has(key)) return i;
  }
  return tabs.length;
}

/**
 * Append a freshly-opened tab into `tabs` while preserving the
 * `[Dashboard, ...pinned, ...unpinned]` invariant. If `tab`'s key is
 * already in the pinned set (because the user pinned it in a previous
 * session), we slot it at the end of the pinned zone; otherwise it
 * goes to the rightmost unpinned slot. Existing tabs are never
 * disturbed — only the freshly inserted one is positioned.
 */
function insertTabRespectingPin(
  tabs: MainTab[],
  tab: MainTab,
  pinned: ReadonlySet<string>,
): MainTab[] {
  const key = mainTabKey(tab);
  if (pinned.has(key)) {
    const boundary = pinBoundaryIndex(tabs, pinned);
    return [...tabs.slice(0, boundary), tab, ...tabs.slice(boundary)];
  }
  return [...tabs, tab];
}

/**
 * `true` if `key` belongs to the pinned zone (dashboard counts as
 * its own zone — it never participates in pin / move / drag).
 */
function isPinnedKey(key: string, pinned: ReadonlySet<string>): boolean {
  return key !== DASHBOARD_TAB_KEY && pinned.has(key);
}

/**
 * Reconcile the `settingsCategory` / `releaseNotesOpen` flags with
 * actual tab presence after a bulk tab mutation.
 *
 * The flags are derived state — they exist so that consumers
 * (sidebar highlights, the prefs reload effect in App.tsx, the
 * SettingsView component itself) don't have to re-derive "is the
 * settings tab open?" from `mainTabs.some(...)` on every render.
 * The single source of truth is still `mainTabs`; this helper
 * keeps the cached flags honest after any operation that might
 * remove a settings or release-notes tab without going through
 * {@link closeMainTab} (e.g. close-others / close-to-right /
 * close-all bulk gestures).
 *
 * Returns a partial state slice with only the flags that actually
 * changed, so callers can spread it into their `set` payload
 * without dirtying unrelated state.
 */
function reconcileOverlayTabFlags(
  s: { settingsCategory: SettingsCategoryId | null; releaseNotesOpen: boolean },
  nextTabs: MainTab[],
): {
  settingsCategory?: null;
  releaseNotesOpen?: false;
  releaseNotesSelectedVersion?: null;
} {
  const out: {
    settingsCategory?: null;
    releaseNotesOpen?: false;
    releaseNotesSelectedVersion?: null;
  } = {};
  if (s.settingsCategory !== null && !nextTabs.some((t) => mainTabKey(t) === SETTINGS_TAB_KEY)) {
    out.settingsCategory = null;
  }
  if (s.releaseNotesOpen && !nextTabs.some((t) => mainTabKey(t) === RELEASE_NOTES_TAB_KEY)) {
    out.releaseNotesOpen = false;
    out.releaseNotesSelectedVersion = null;
  }
  return out;
}

function genSectionId(): SectionId {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return `sec_${g.crypto.randomUUID()}`;
  }
  return `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Right-panel persistence ────────────────────────────────────────
// Stored separately from the rest of the store because the rail's
// active view is reload-stable UX: a user who closed RunHQ with the
// AI panel open expects to land back in the AI panel, not in a fresh
// "no panel" state. Width is a separate key so changing the active
// panel doesn't blow away the resize gesture, and vice versa.
const RIGHT_PANEL_KEY = 'runhq.rightPanel.active';
const RIGHT_PANEL_WIDTH_KEY = 'runhq.rightPanel.width';
const RIGHT_PANEL_MIN_W = 280;
const RIGHT_PANEL_MAX_W = 900;
const RIGHT_PANEL_DEFAULT_W = 440;

/**
 * Hard ceiling on simultaneously open chat tabs. Five mirrors the
 * Cursor / VSCode "tabs you can juggle without losing track" sweet
 * spot — tested informally with a few users; six already starts to
 * truncate titles unreadably in a 440px-wide panel. Beyond this
 * cap we FIFO-evict the oldest *non-active* tab; the user can
 * always re-open from the History drawer if they need an evicted
 * conversation back.
 */
export const MAX_OPEN_TABS = 5;

function loadRightPanel(): 'activity' | 'ai' | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_KEY);
    if (raw === 'activity' || raw === 'ai') return raw;
    return null;
  } catch {
    return null;
  }
}

function saveRightPanel(panel: 'activity' | 'ai' | null) {
  if (typeof window === 'undefined') return;
  try {
    if (panel == null) window.localStorage.removeItem(RIGHT_PANEL_KEY);
    else window.localStorage.setItem(RIGHT_PANEL_KEY, panel);
  } catch {
    /* localStorage can throw in private mode; ignore */
  }
}

function loadRightPanelWidth(): number {
  if (typeof window === 'undefined') return RIGHT_PANEL_DEFAULT_W;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
    if (!raw) return RIGHT_PANEL_DEFAULT_W;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return RIGHT_PANEL_DEFAULT_W;
    return Math.max(RIGHT_PANEL_MIN_W, Math.min(RIGHT_PANEL_MAX_W, n));
  } catch {
    return RIGHT_PANEL_DEFAULT_W;
  }
}

function saveRightPanelWidth(width: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

// ---------- Left sidebar pin state -----------------------------------------
//
// SidebarRail used to track `pinned` purely as a component-local
// `useState` boolean, which meant the keyboard shortcut for "toggle
// sidebar" couldn't reach it without prop-drilling or an event bus.
// Promoting it to the store solves both: the rail still owns its own
// hover-expand behaviour, but the *pinned* baseline is shared so
// `Cmd+B` can flip it from anywhere in the app and the choice now
// survives reloads (which the local state did not).
const SIDEBAR_PINNED_KEY = 'runhq.sidebar.pinned';

function loadSidebarPinned(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PINNED_KEY);
    if (raw == null) return true; // first launch keeps the previous default
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

function saveSidebarPinned(pinned: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export const useAppStore = create<AppStore>((set, get) => ({
  services: [],
  servicesLoaded: false,
  statuses: {},
  logs: {},
  ports: [],
  editors: [],
  git: {},
  resources: {},
  resourceHistory: {},
  selectedServiceId: null,
  selectedCmdName: null,
  selectedStackId: null,
  appVersion: null,
  stateDir: null,

  mainTabs: [DASHBOARD_TAB],
  activeMainTabKey: DASHBOARD_TAB_KEY,
  pinnedMainTabKeys: initialPinnedTabs,
  pendingServiceBodyTab: {},

  categoryFilter: initialSidebarPrefs.categoryFilter,
  runtimeFilter: initialSidebarPrefs.runtimeFilter,
  sidebarStatusFilter: initialSidebarPrefs.statusFilter,
  sidebarGroupBy: initialSidebarPrefs.groupBy,
  dashboardGroupBy: initialDashboardPrefs.groupBy,
  dashboardSortBy: initialDashboardPrefs.sortBy,
  dashboardShowHidden: initialDashboardPrefs.showHidden,
  search: '',
  editorService: undefined,
  stacks: [],
  editorStack: undefined,

  sections: initialSections.sections,
  serviceSection: initialSections.serviceSection,
  stackSection: initialSections.stackSection,
  collapsedSections: initialSections.collapsedSections,
  sectionItemOrder: initialSections.sectionItemOrder,

  // Flips `servicesLoaded` on first call. Mirrors the natural
  // "I just received the roster from Rust" semantic regardless of
  // whether the list is empty — once we've heard back, the skeleton
  // is dismissed and the dashboard switches to its real
  // empty-state / populated rendering.
  setServices: (services) => set({ services, servicesLoaded: true }),

  upsertService: (svc) =>
    set((s) => {
      const idx = s.services.findIndex((x) => x.id === svc.id);
      const next = [...s.services];
      if (idx >= 0) next[idx] = svc;
      else next.push(svc);
      return { services: next };
    }),

  removeService: (id) =>
    set((s) => {
      const { [id]: _omit, ...restServiceSection } = s.serviceSection;
      void _omit;
      const nextOrder = dropItemKey(s.sectionItemOrder, itemOrderKey('service', id));
      saveSections({
        sections: s.sections,
        serviceSection: restServiceSection,
        stackSection: s.stackSection,
        collapsedSections: s.collapsedSections,
        sectionItemOrder: nextOrder,
      });

      // If a tab for this service is open, drop it. If it was the
      // active tab, snap focus back to the dashboard so the user
      // doesn't end up on a phantom tab.
      const closedKey = mainTabKey({ kind: 'service', refId: id });
      const nextTabs = s.mainTabs.filter((t) => mainTabKey(t) !== closedKey);
      const tabsChanged = nextTabs.length !== s.mainTabs.length;
      const nextActive =
        tabsChanged && s.activeMainTabKey === closedKey ? DASHBOARD_TAB_KEY : s.activeMainTabKey;
      const becameDashboard = nextActive === DASHBOARD_TAB_KEY && tabsChanged;

      // Drop any lingering pin for the deleted service so it
      // doesn't haunt the persisted prefs forever (and so a future
      // service that happens to reuse this id — admittedly rare —
      // doesn't auto-pin itself unexpectedly).
      const pinnedHadKey = s.pinnedMainTabKeys.includes(closedKey);
      const nextPinned = pinnedHadKey
        ? s.pinnedMainTabKeys.filter((k) => k !== closedKey)
        : s.pinnedMainTabKeys;
      if (pinnedHadKey) savePinnedTabs(nextPinned);

      return {
        services: s.services.filter((x) => x.id !== id),
        selectedServiceId:
          s.selectedServiceId === id || becameDashboard ? null : s.selectedServiceId,
        selectedStackId: becameDashboard ? null : s.selectedStackId,
        serviceSection: restServiceSection,
        sectionItemOrder: nextOrder,
        mainTabs: tabsChanged ? nextTabs : s.mainTabs,
        activeMainTabKey: nextActive,
        pinnedMainTabKeys: nextPinned,
      };
    }),

  setStatus: (status) =>
    set((s) => ({
      statuses: { ...s.statuses, [status.id]: status },
    })),

  appendLog: (key, line) =>
    set((s) => {
      const current = s.logs[key] ?? { lines: [], lastSeq: 0 };
      if (line.seq <= current.lastSeq) return s;
      const nextLines =
        current.lines.length >= MAX_UI_LOG_LINES
          ? [...current.lines.slice(current.lines.length - MAX_UI_LOG_LINES + 1), line]
          : [...current.lines, line];
      return { logs: { ...s.logs, [key]: { lines: nextLines, lastSeq: line.seq } } };
    }),

  replaceLogs: (key, lines) =>
    set((s) => {
      const lastSeq = lines.length ? (lines[lines.length - 1]?.seq ?? 0) : 0;
      return { logs: { ...s.logs, [key]: { lines, lastSeq } } };
    }),

  clearLogs: (key) => set((s) => ({ logs: { ...s.logs, [key]: { lines: [], lastSeq: 0 } } })),

  setPorts: (ports) => set({ ports }),
  setEditors: (editors) => set({ editors }),
  setGit: (id, status) => set((s) => ({ git: { ...s.git, [id]: status } })),

  setResources: (id, sample) =>
    set((s) => {
      const prevHistory = s.resourceHistory[id] ?? [];
      const nextHistory =
        prevHistory.length >= RESOURCE_HISTORY_MAX
          ? [
              ...prevHistory.slice(prevHistory.length - RESOURCE_HISTORY_MAX + 1),
              sample.cpu_percent,
            ]
          : [...prevHistory, sample.cpu_percent];
      return {
        resources: { ...s.resources, [id]: sample },
        resourceHistory: { ...s.resourceHistory, [id]: nextHistory },
      };
    }),
  // setSelected(id) doubles as a tab-router: passing a service id
  // either activates the existing tab for that service, or opens a
  // new one. Passing `null` snaps back to the dashboard tab.
  //
  // Settings / Release Notes are first-class tabs now (see
  // `SETTINGS_TAB` / `RELEASE_NOTES_TAB` definitions), so nothing
  // here clears `releaseNotesOpen` / `settingsCategory` — those
  // tabs are allowed to stay in the strip while the user navigates
  // around. Closing them is an explicit gesture (X / Cmd+W).
  setSelected: (id) =>
    set((s) => {
      if (id == null) {
        return {
          selectedServiceId: null,
          selectedCmdName: null,
          selectedStackId: null,
          activeMainTabKey: DASHBOARD_TAB_KEY,
        };
      }
      const tab: MainTab = { kind: 'service', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      return {
        selectedServiceId: id,
        selectedCmdName: null,
        selectedStackId: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
      };
    }),
  openServiceWithBodyTab: (id, bodyTab) =>
    set((s) => {
      const tab: MainTab = { kind: 'service', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      // Same tab-routing logic as `setSelected(id)` but with the
      // body-tab request stamped onto `pendingServiceBodyTab` in
      // the same atomic update. Inlined rather than calling
      // `setSelected` first because we want a single store
      // transition — separating it would mean LogPanel could
      // mount on the freshly-opened tab BEFORE the body request
      // landed, race-losing back to the LOGS default and
      // clobbering the deep-link.
      return {
        selectedServiceId: id,
        selectedCmdName: null,
        selectedStackId: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
        pendingServiceBodyTab: { ...s.pendingServiceBodyTab, [id]: bodyTab },
      };
    }),
  consumePendingServiceBodyTab: (id) =>
    set((s) => {
      if (!(id in s.pendingServiceBodyTab)) return s;
      const next = { ...s.pendingServiceBodyTab };
      delete next[id];
      return { pendingServiceBodyTab: next };
    }),
  setSelectedCmd: (cmdName) => set({ selectedCmdName: cmdName }),
  setSelectedStack: (id) =>
    set((s) => {
      if (id == null) {
        return {
          selectedStackId: null,
          selectedServiceId: null,
          selectedCmdName: null,
          activeMainTabKey: DASHBOARD_TAB_KEY,
        };
      }
      const tab: MainTab = { kind: 'stack', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      return {
        selectedStackId: id,
        selectedServiceId: null,
        selectedCmdName: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
      };
    }),

  openMainTab: (tab) => {
    const key = mainTabKey(tab);
    if (tab.kind === 'service') {
      get().setSelected(tab.refId);
      return;
    }
    if (tab.kind === 'stack') {
      get().setSelectedStack(tab.refId);
      return;
    }
    set({
      activeMainTabKey: key,
      selectedServiceId: null,
      selectedStackId: null,
      selectedCmdName: null,
    });
  },
  closeMainTab: (key) =>
    set((s) => {
      // Dashboard is sticky — closing it would leave the user with no
      // home base. We silently no-op rather than throw so callers
      // (e.g. middle-click on the dashboard tab) don't have to guard.
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      const next = s.mainTabs.filter((_, i) => i !== idx);
      let activeKey = s.activeMainTabKey;
      if (s.activeMainTabKey === key) {
        // Snap to the tab that just shifted into the closed slot
        // (next[idx]); fall back to the left neighbour and finally
        // to the dashboard if nothing else is open. Mirrors the
        // chat-tab close behaviour above and the user's mental
        // model: closing tab N puts you on the new tab N (the one
        // that filled the gap), or on the previous tab if N was the
        // rightmost.
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        activeKey = fallback ? mainTabKey(fallback) : DASHBOARD_TAB_KEY;
      }
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      const selectedServiceId = activeTab?.kind === 'service' ? activeTab.refId : null;
      const selectedStackId = activeTab?.kind === 'stack' ? activeTab.refId : null;
      // Settings / Release Notes flags shadow tab presence — when
      // their tab is the one being closed, blank the matching flag
      // so the rest of the app (sidebar highlights, prefs reload
      // effect in App.tsx) sees a consistent "not open" state.
      const closedSettings = key === SETTINGS_TAB_KEY;
      const closedReleaseNotes = key === RELEASE_NOTES_TAB_KEY;
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId,
        selectedStackId,
        selectedCmdName: null,
        ...(closedSettings && { settingsCategory: null }),
        ...(closedReleaseNotes && {
          releaseNotesOpen: false,
          releaseNotesSelectedVersion: null,
        }),
      };
    }),
  setActiveMainTab: (key) =>
    set((s) => {
      const tab = s.mainTabs.find((t) => mainTabKey(t) === key);
      if (!tab) return s;
      return {
        activeMainTabKey: key,
        selectedServiceId: tab.kind === 'service' ? tab.refId : null,
        selectedStackId: tab.kind === 'stack' ? tab.refId : null,
        selectedCmdName: null,
      };
    }),
  closeOtherMainTabs: (keepKey) =>
    set((s) => {
      // The dashboard tab is sticky regardless of which tab the user
      // anchored on — closing it would leave them with no home base.
      // We also preserve pinned tabs (Chrome / Firefox parity:
      // bulk-close gestures never touch what the user explicitly
      // pinned).
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const next = s.mainTabs.filter((t) => {
        const k = mainTabKey(t);
        return k === keepKey || k === DASHBOARD_TAB_KEY || pinnedSet.has(k);
      });
      if (next.length === s.mainTabs.length) return s;
      // Anchor becomes active so the user lands somewhere meaningful.
      // If they right-clicked the dashboard itself, active stays on
      // dashboard naturally because it's the only candidate.
      const activeKey = next.some((t) => mainTabKey(t) === keepKey) ? keepKey : DASHBOARD_TAB_KEY;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeMainTabsToRight: (key) =>
    set((s) => {
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      // Already the rightmost tab — nothing to close.
      if (idx === s.mainTabs.length - 1) return s;
      // Keep everything up to (and including) the anchor, plus any
      // pinned tab that lived to the right of it. With the
      // [Dashboard, ...pinned, ...unpinned] invariant the right-of-
      // anchor pinned tabs only exist when the anchor itself is
      // pinned (or dashboard); preserving them here matches the
      // user's "pinning protects from bulk-close" expectation.
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const head = s.mainTabs.slice(0, idx + 1);
      const tail = s.mainTabs.slice(idx + 1).filter((t) => pinnedSet.has(mainTabKey(t)));
      const next = [...head, ...tail];
      // If the active tab survived the cut, leave it where it is —
      // closing tabs the user wasn't even looking at shouldn't
      // disturb their place. Otherwise snap to the anchor so we
      // don't leave them on a closed tab's empty slot.
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : key;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeMainTabsToLeft: (key) =>
    set((s) => {
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      // Anchor is already the leftmost tab — nothing to close.
      // (In practice this means the dashboard, which is always at
      // idx 0; the menu disables the option in that case but the
      // store still guards.)
      if (idx === 0) return s;
      // Keep the dashboard pinned at index 0 plus everything from
      // the anchor onward, AND every user-pinned tab to the left
      // of the anchor (preserving its original relative order).
      // The dashboard re-emerges left of the anchor automatically
      // because it's the only survivor below `idx` once pinned
      // tabs are folded back in. If somehow the dashboard wasn't
      // there, we still append it at the front to satisfy the
      // "always present" invariant.
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const headPinned = s.mainTabs.slice(0, idx).filter((t) => pinnedSet.has(mainTabKey(t)));
      const tail = s.mainTabs.slice(idx);
      const next = tail.some((t) => mainTabKey(t) === DASHBOARD_TAB_KEY)
        ? [...headPinned, ...tail]
        : [DASHBOARD_TAB, ...headPinned, ...tail];
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : key;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeAllMainTabs: () =>
    set((s) => {
      // Pinned tabs survive a "Close All" — that's the whole point
      // of pinning. Build the kept list as `[Dashboard, ...pinned]`
      // (in their existing relative order so the user's manual
      // arrangement isn't shuffled).
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const kept = s.mainTabs.filter(
        (t) => mainTabKey(t) === DASHBOARD_TAB_KEY || pinnedSet.has(mainTabKey(t)),
      );
      const next = kept.some((t) => mainTabKey(t) === DASHBOARD_TAB_KEY)
        ? kept
        : [DASHBOARD_TAB, ...kept];
      // Already at the kept set — no need to dirty state.
      if (next.length === s.mainTabs.length) return s;
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : DASHBOARD_TAB_KEY;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  toggleMainTabPin: (key) =>
    set((s) => {
      // Dashboard is its own zone — already sticky in a stronger
      // sense than pinning. Silently no-op so callers (context-menu
      // entries, keyboard shortcuts) don't have to guard.
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      const tab = s.mainTabs[idx];
      if (!tab) return s;
      const isPinned = s.pinnedMainTabKeys.includes(key);
      // Build the post-pin tab list so the visual `[Dashboard,
      // ...pinned, ...unpinned]` invariant holds without us having
      // to do a second pass: yank the tab out, then re-insert at
      // the new zone's tail. Tail (rather than head) keeps the
      // most-recently-pinned tab next to the unpinned zone, which
      // matches Chrome's "newest pin lands rightmost in the pinned
      // strip" behaviour.
      const withoutTab = [...s.mainTabs.slice(0, idx), ...s.mainTabs.slice(idx + 1)];
      const nextPinned = isPinned
        ? s.pinnedMainTabKeys.filter((k) => k !== key)
        : [...s.pinnedMainTabKeys, key];
      const pinnedSetAfter = new Set(nextPinned);
      // For the tab-less array, `pinBoundaryIndex` returns the slot
      // right after the existing pinned tabs in either direction:
      //   • Pinning  → existing pinned tabs stay where they are; the
      //                newly pinned tab lands at boundary (= right
      //                edge of pinned zone, just before unpinned).
      //   • Unpinning→ remaining pinned tabs are the same ones
      //                minus this key; boundary points to the start
      //                of unpinned zone, which is exactly where the
      //                freshly unpinned tab should appear.
      const insertAt = pinBoundaryIndex(withoutTab, pinnedSetAfter);
      const nextTabs = [...withoutTab.slice(0, insertAt), tab, ...withoutTab.slice(insertAt)];
      savePinnedTabs(nextPinned);
      return {
        mainTabs: nextTabs,
        pinnedMainTabKeys: nextPinned,
      };
    }),
  reorderMainTabs: (activeKey, overKey) =>
    set((s) => {
      // Dashboard is anchored at index 0 — it's never a drag source
      // or drop target. The bar enforces this by rendering it
      // outside the SortableContext, but we double-guard here so
      // the store stays defensive against a stray programmatic
      // call.
      if (activeKey === DASHBOARD_TAB_KEY) return s;
      if (activeKey === overKey) return s;
      const fromIdx = s.mainTabs.findIndex((t) => mainTabKey(t) === activeKey);
      if (fromIdx < 0) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const activeIsPinned = isPinnedKey(activeKey, pinnedSet);
      // Refuse cross-zone drops. Pinning is an explicit gesture
      // (right-click → Pin, or click the pin badge) — silently
      // moving a tab across the boundary on drag would surprise
      // users who'd expect "drag to reorder" not "drag to repin".
      // Falling through to no-op leaves the dragged tab back where
      // it started, which dnd-kit handles gracefully.
      if (overKey != null) {
        if (overKey === DASHBOARD_TAB_KEY) return s;
        const overIsPinned = isPinnedKey(overKey, pinnedSet);
        if (activeIsPinned !== overIsPinned) return s;
      }
      const tab = s.mainTabs[fromIdx];
      if (!tab) return s;
      const withoutTab = [...s.mainTabs.slice(0, fromIdx), ...s.mainTabs.slice(fromIdx + 1)];
      let insertAt: number;
      if (overKey == null) {
        // No drop target → land at the end of the active tab's
        // zone. Pinned tabs end at `pinBoundaryIndex`; unpinned
        // tabs end at the array end.
        insertAt = activeIsPinned ? pinBoundaryIndex(withoutTab, pinnedSet) : withoutTab.length;
      } else {
        const overIdx = withoutTab.findIndex((t) => mainTabKey(t) === overKey);
        if (overIdx < 0) return s;
        insertAt = overIdx;
      }
      const nextTabs = [...withoutTab.slice(0, insertAt), tab, ...withoutTab.slice(insertAt)];
      // Identity short-circuit: if the resulting array equals the
      // source, skip the set() so subscribers / SortableContext
      // animations don't restart for a no-op drop.
      let identical = nextTabs.length === s.mainTabs.length;
      if (identical) {
        for (let i = 0; i < nextTabs.length; i++) {
          if (mainTabKey(nextTabs[i]!) !== mainTabKey(s.mainTabs[i]!)) {
            identical = false;
            break;
          }
        }
      }
      if (identical) return s;
      return { mainTabs: nextTabs };
    }),
  moveMainTabLeft: (key) =>
    set((s) => {
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx <= 0) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const isPinned = isPinnedKey(key, pinnedSet);
      const prev = s.mainTabs[idx - 1];
      if (!prev) return s;
      const prevKey = mainTabKey(prev);
      // Dashboard at idx 0 falls under this guard automatically:
      // it's not in the pinned set, and any non-dashboard tab that
      // would swap with it is necessarily either pinned or
      // unpinned, so the zone check fails and we no-op.
      if (prevKey === DASHBOARD_TAB_KEY) return s;
      const prevIsPinned = isPinnedKey(prevKey, pinnedSet);
      // Don't let "move left" pop a tab across a zone boundary —
      // that would silently flip pin state, which the user can do
      // explicitly via the Pin/Unpin entry.
      if (prevIsPinned !== isPinned) return s;
      const nextTabs = [...s.mainTabs];
      nextTabs[idx - 1] = nextTabs[idx]!;
      nextTabs[idx] = prev;
      return { mainTabs: nextTabs };
    }),
  moveMainTabRight: (key) =>
    set((s) => {
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0 || idx >= s.mainTabs.length - 1) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const isPinned = isPinnedKey(key, pinnedSet);
      const next = s.mainTabs[idx + 1];
      if (!next) return s;
      const nextKey = mainTabKey(next);
      const nextIsPinned = isPinnedKey(nextKey, pinnedSet);
      // Same zone-boundary guard as `moveMainTabLeft`.
      if (nextIsPinned !== isPinned) return s;
      const nextTabs = [...s.mainTabs];
      nextTabs[idx + 1] = nextTabs[idx]!;
      nextTabs[idx] = next;
      return { mainTabs: nextTabs };
    }),
  setAppMeta: (version, stateDir) => set({ appVersion: version, stateDir }),

  setCategoryFilter: (keys) => {
    set({ categoryFilter: keys });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: s.sidebarGroupBy,
      categoryFilter: keys,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setRuntimeFilter: (keys) => {
    set({ runtimeFilter: keys });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: s.sidebarGroupBy,
      categoryFilter: s.categoryFilter,
      runtimeFilter: keys,
    });
  },
  setSidebarStatusFilter: (v) => {
    set({ sidebarStatusFilter: v });
    const s = get();
    saveSidebarPrefs({
      statusFilter: v,
      groupBy: s.sidebarGroupBy,
      categoryFilter: s.categoryFilter,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setSidebarGroupBy: (v) => {
    set({ sidebarGroupBy: v });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: v,
      categoryFilter: s.categoryFilter,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setDashboardGroupBy: (v) => {
    set({ dashboardGroupBy: v });
    saveDashboardPrefs({
      groupBy: v,
      sortBy: get().dashboardSortBy,
      showHidden: get().dashboardShowHidden,
    });
  },
  setDashboardSortBy: (v) => {
    set({ dashboardSortBy: v });
    saveDashboardPrefs({
      groupBy: get().dashboardGroupBy,
      sortBy: v,
      showHidden: get().dashboardShowHidden,
    });
  },
  setDashboardShowHidden: (v) => {
    set({ dashboardShowHidden: v });
    saveDashboardPrefs({
      groupBy: get().dashboardGroupBy,
      sortBy: get().dashboardSortBy,
      showHidden: v,
    });
  },
  resetSidebarFilters: () => {
    set({
      sidebarStatusFilter: 'all',
      sidebarGroupBy: 'none',
      categoryFilter: [],
      runtimeFilter: [],
    });
    saveSidebarPrefs({
      statusFilter: 'all',
      groupBy: 'none',
      categoryFilter: [],
      runtimeFilter: [],
    });
  },
  setSearch: (q) => set({ search: q }),
  openEditor: (service) => set({ editorService: service }),
  closeEditor: () => set({ editorService: undefined }),
  setStacks: (stacks) => set({ stacks }),
  upsertStack: (stack) =>
    set((s) => {
      const idx = s.stacks.findIndex((x) => x.id === stack.id);
      const next = [...s.stacks];
      if (idx >= 0) next[idx] = stack;
      else next.push(stack);
      return { stacks: next };
    }),
  removeStack: (id) =>
    set((s) => {
      const { [id]: _omit, ...restStackSection } = s.stackSection;
      void _omit;
      const nextOrder = dropItemKey(s.sectionItemOrder, itemOrderKey('stack', id));
      saveSections({
        sections: s.sections,
        serviceSection: s.serviceSection,
        stackSection: restStackSection,
        collapsedSections: s.collapsedSections,
        sectionItemOrder: nextOrder,
      });

      const closedKey = mainTabKey({ kind: 'stack', refId: id });
      const nextTabs = s.mainTabs.filter((t) => mainTabKey(t) !== closedKey);
      const tabsChanged = nextTabs.length !== s.mainTabs.length;
      const nextActive =
        tabsChanged && s.activeMainTabKey === closedKey ? DASHBOARD_TAB_KEY : s.activeMainTabKey;
      const becameDashboard = nextActive === DASHBOARD_TAB_KEY && tabsChanged;

      const pinnedHadKey = s.pinnedMainTabKeys.includes(closedKey);
      const nextPinned = pinnedHadKey
        ? s.pinnedMainTabKeys.filter((k) => k !== closedKey)
        : s.pinnedMainTabKeys;
      if (pinnedHadKey) savePinnedTabs(nextPinned);

      return {
        stacks: s.stacks.filter((x) => x.id !== id),
        stackSection: restStackSection,
        sectionItemOrder: nextOrder,
        mainTabs: tabsChanged ? nextTabs : s.mainTabs,
        activeMainTabKey: nextActive,
        selectedServiceId: becameDashboard ? null : s.selectedServiceId,
        selectedStackId: s.selectedStackId === id || becameDashboard ? null : s.selectedStackId,
        pinnedMainTabKeys: nextPinned,
      };
    }),
  openStackEditor: (stack) => set({ editorStack: stack }),
  closeStackEditor: () => set({ editorStack: undefined }),

  addSection: (name, color) => {
    const id = genSectionId();
    const trimmed = name.trim() || 'New section';
    const s = get();
    const chosen = color ?? nextSectionColor(s.sections.map((x) => x.color));
    const nextSections: Section[] = [...s.sections, { id, name: trimmed, color: chosen }];
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
    return id;
  },
  renameSection: (id, name) => {
    const s = get();
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, name: trimmed } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  recolorSection: (id, color) => {
    const s = get();
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, color } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  deleteSection: (id) => {
    const s = get();
    const nextSections = s.sections.filter((sec) => sec.id !== id);
    // Any item still pointing at this section gets moved to Unassigned.
    const nextServiceSection: Record<ServiceId, SectionId> = {};
    for (const [k, v] of Object.entries(s.serviceSection)) {
      if (v !== id) nextServiceSection[k] = v;
    }
    const nextStackSection: Record<string, SectionId> = {};
    for (const [k, v] of Object.entries(s.stackSection)) {
      if (v !== id) nextStackSection[k] = v;
    }
    const { [id]: _c, ...nextCollapsed } = s.collapsedSections;
    void _c;
    // Migrate the deleted section's ordered items into Unassigned so
    // the user's manual ordering survives a section deletion. Items
    // that already have an explicit slot in Unassigned win — we just
    // append the orphans to the end.
    const orphan = s.sectionItemOrder[id] ?? [];
    const { [id]: _orderOmit, ...restOrder } = s.sectionItemOrder;
    void _orderOmit;
    let nextItemOrder: Record<SectionId, string[]> = restOrder;
    if (orphan.length > 0) {
      const existing = nextItemOrder[UNASSIGNED_BUCKET] ?? [];
      const seen = new Set(existing);
      const merged = [...existing];
      for (const k of orphan) {
        if (!seen.has(k)) {
          merged.push(k);
          seen.add(k);
        }
      }
      nextItemOrder = { ...nextItemOrder, [UNASSIGNED_BUCKET]: merged };
    }
    set({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: nextItemOrder,
    });
    saveSections({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: nextItemOrder,
    });
  },
  reorderSections: (ids) => {
    const s = get();
    const byId = new Map(s.sections.map((sec) => [sec.id, sec]));
    const ordered: Section[] = [];
    for (const id of ids) {
      const sec = byId.get(id);
      if (sec) {
        ordered.push(sec);
        byId.delete(id);
      }
    }
    // Any sections missing from `ids` are appended to preserve them.
    for (const sec of byId.values()) ordered.push(sec);
    set({ sections: ordered });
    saveSections({
      sections: ordered,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  toggleSectionCollapsed: (id) => {
    const s = get();
    const nextCollapsed = {
      ...s.collapsedSections,
      [id]: !s.collapsedSections[id],
    };
    set({ collapsedSections: nextCollapsed });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  assignServiceToSection: (serviceId, sectionId) => {
    const s = get();
    const next = { ...s.serviceSection };
    if (sectionId == null) {
      delete next[serviceId];
    } else {
      next[serviceId] = sectionId;
    }
    // Re-slot the item key in the order map: drop from the previous
    // bucket and append to the new one (if not already pinned there).
    // The "drag-to-reorder" path uses `moveSidebarItem` directly with
    // a precise insertion point; this entry point is the legacy
    // "move into section" gesture (overflow menu, section-header
    // drop) that simply parks the item at the end of the bucket.
    const bucket = bucketOf(sectionId);
    const key = itemOrderKey('service', serviceId);
    const cleaned = dropItemKey(s.sectionItemOrder, key);
    const list = cleaned[bucket] ?? [];
    const nextOrder: Record<SectionId, string[]> = {
      ...cleaned,
      [bucket]: list.includes(key) ? list : [...list, key],
    };
    set({ serviceSection: next, sectionItemOrder: nextOrder });
    saveSections({
      sections: s.sections,
      serviceSection: next,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },
  assignStackToSection: (stackId, sectionId) => {
    const s = get();
    const next = { ...s.stackSection };
    if (sectionId == null) {
      delete next[stackId];
    } else {
      next[stackId] = sectionId;
    }
    const bucket = bucketOf(sectionId);
    const key = itemOrderKey('stack', stackId);
    const cleaned = dropItemKey(s.sectionItemOrder, key);
    const list = cleaned[bucket] ?? [];
    const nextOrder: Record<SectionId, string[]> = {
      ...cleaned,
      [bucket]: list.includes(key) ? list : [...list, key],
    };
    set({ stackSection: next, sectionItemOrder: nextOrder });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: next,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },
  moveSidebarItem: (kind, id, targetSectionId, beforeKey) => {
    const s = get();
    const bucket = bucketOf(targetSectionId);
    const key = itemOrderKey(kind, id);
    // Re-place the key at the desired slot. `placeItemKey` handles
    // both the same-bucket reorder ("drop a service two rows up
    // inside its section") and the cross-bucket move ("drag from
    // Unassigned into the Backend section, slot above row N").
    const nextOrder = placeItemKey(s.sectionItemOrder, bucket, key, beforeKey);

    // Sync the section-assignment maps so the row also re-buckets.
    let nextServiceSection = s.serviceSection;
    let nextStackSection = s.stackSection;
    if (kind === 'service') {
      nextServiceSection = { ...s.serviceSection };
      if (targetSectionId == null) delete nextServiceSection[id];
      else nextServiceSection[id] = targetSectionId;
    } else {
      nextStackSection = { ...s.stackSection };
      if (targetSectionId == null) delete nextStackSection[id];
      else nextStackSection[id] = targetSectionId;
    }
    set({
      sectionItemOrder: nextOrder,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
    });
    saveSections({
      sections: s.sections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },

  timelineOpen: false,
  // `openTimeline` now drives the right-side shell — release notes /
  // What's New entries that used to spawn an overlay timeline now
  // simply activate the embedded "activity" panel. We keep
  // `timelineOpen` around as a legacy hook (some callers might still
  // listen to it), but the visible UI is wholly owned by `rightPanel`.
  openTimeline: () => set({ timelineOpen: true, rightPanel: 'activity' }),
  closeTimeline: () => set({ timelineOpen: false, rightPanel: null }),

  // VSCode-style right activity bar — see interface comment above.
  // Initial values are hydrated from localStorage at module load
  // (see helpers below). We persist on every mutation so the panel
  // state survives reloads.
  rightPanel: loadRightPanel(),
  rightPanelWidth: loadRightPanelWidth(),
  setRightPanel: (panel) => {
    saveRightPanel(panel);
    set({ rightPanel: panel });
  },
  toggleRightPanel: (panel) => {
    const current = get().rightPanel;
    const next = current === panel ? null : panel;
    saveRightPanel(next);
    set({ rightPanel: next });
  },
  setRightPanelWidth: (width) => {
    const clamped = Math.max(RIGHT_PANEL_MIN_W, Math.min(RIGHT_PANEL_MAX_W, width));
    saveRightPanelWidth(clamped);
    set({ rightPanelWidth: clamped });
  },

  sidebarPinned: loadSidebarPinned(),
  setSidebarPinned: (pinned) => {
    saveSidebarPinned(pinned);
    set({ sidebarPinned: pinned });
  },
  toggleSidebarPinned: () => {
    const next = !get().sidebarPinned;
    saveSidebarPinned(next);
    set({ sidebarPinned: next });
  },

  // -------- AI Chat Hub ---------------------------------------------------
  // We deliberately don't persist `activeConversationId` to localStorage:
  // a stale id pointing at a deleted/archived conversation would render
  // a blank panel on next launch with no obvious recovery path. Instead
  // the panel boots into the empty state and the user picks a chat from
  // the History drawer — same model as VSCode's "Recent" list.
  activeConversationId: null,
  aiDraft: null,
  openTabs: [],
  setActiveConversation: (id) =>
    set((s) => {
      // Null target → just blank the active id; tabs are user
      // territory (a "new chat" gesture shouldn't yank tabs they
      // explicitly opened from history).
      if (id == null) return { activeConversationId: null };
      if (s.openTabs.includes(id)) {
        return { activeConversationId: id };
      }
      // Insert as a new tab on the right. If we'd overflow the cap,
      // evict the first tab that *isn't* about to become active —
      // FIFO with an "active is sticky" carve-out so we never
      // close the chat the user is currently looking at.
      let next = [...s.openTabs, id];
      if (next.length > MAX_OPEN_TABS) {
        const evictAt = next.findIndex((tabId) => tabId !== id && tabId !== s.activeConversationId);
        if (evictAt >= 0) {
          next.splice(evictAt, 1);
        } else {
          // Fallback: nothing safe to evict (everything is the
          // active or incoming id, which means cap === 1 edge
          // case). Drop the head; the active id is `id` itself,
          // so `s.activeConversationId` losing its slot is fine.
          next = next.slice(1);
        }
      }
      return { activeConversationId: id, openTabs: next };
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.openTabs.indexOf(id);
      if (idx < 0) return s;
      const next = s.openTabs.filter((t) => t !== id);
      if (s.activeConversationId !== id) {
        return { openTabs: next };
      }
      // Closing the active tab → snap to the neighbour. We prefer
      // the tab that took the closing tab's slot (idx in `next`),
      // falling back to the previous one. This matches VSCode's
      // editor-tab close behaviour and keeps the user's mental
      // model intact: closing tab N puts you on the new tab N
      // (the one that just shifted left), or on N-1 if N was the
      // last tab.
      const fallback = next[idx] ?? next[idx - 1] ?? null;
      return { openTabs: next, activeConversationId: fallback };
    }),
  closeOtherTabs: (keepId) =>
    set((s) => {
      if (!s.openTabs.includes(keepId)) return s;
      // No work needed if the kept tab is already the only one —
      // returning a fresh array would force a re-render for nothing.
      if (s.openTabs.length === 1) return s;
      return { openTabs: [keepId], activeConversationId: keepId };
    }),
  closeTabsToRight: (id) =>
    set((s) => {
      const idx = s.openTabs.indexOf(id);
      if (idx < 0) return s;
      // Already the rightmost tab — nothing to close.
      if (idx === s.openTabs.length - 1) return s;
      const next = s.openTabs.slice(0, idx + 1);
      if (s.activeConversationId == null || next.includes(s.activeConversationId)) {
        return { openTabs: next };
      }
      // The active tab lived in the closed range; snap to the
      // anchor tab so the user lands on a sensible neighbour
      // instead of an empty rail.
      return { openTabs: next, activeConversationId: id };
    }),
  closeAllTabs: () => set({ openTabs: [], activeConversationId: null }),
  clearAiDraft: () => set({ aiDraft: null }),
  openAiChat: async (input) => {
    // Step 1: persist the conversation row first. We need the id
    // so the panel can rehydrate the right rows on activation —
    // even if the user closes the rail before sending.
    let conversationId: string;
    try {
      conversationId = await ipc.createConversation({
        title: input.title.slice(0, 200),
        origin: input.origin,
        context_json: input.context ? JSON.stringify(input.context) : null,
      });
    } catch (e) {
      // Store-side errors should never be silent — surface in
      // console for now; a toast layer can pick this up later.
      console.error('openAiChat: failed to create conversation', e);
      return null;
    }

    const draft: AiDraft = {
      conversationId,
      draftPrompt: input.draftPrompt,
      contextSystemMessage: input.contextSystemMessage,
      actionHook: input.actionHook ?? { kind: 'none' },
      autoSend: input.autoSend ?? false,
      forcedProviderId: input.forcedProviderId,
    };

    // Stash draft + active id + open the panel atomically. Doing
    // them in one set() prevents the panel from waking up between
    // states (e.g. `activeConversationId` set but `aiDraft` still
    // null would show the empty conversation for a frame).
    //
    // Tab insertion mirrors `setActiveConversation`: append to the
    // right; FIFO-evict the oldest non-active, non-incoming tab if
    // we'd overflow the cap. We can't just call the action here
    // because we also need to write `aiDraft` and `rightPanel` in
    // the same set() — splitting them would race with the panel's
    // mount effect.
    saveRightPanel('ai');
    set((s) => {
      let openTabs = s.openTabs;
      if (!openTabs.includes(conversationId)) {
        const next = [...openTabs, conversationId];
        if (next.length > MAX_OPEN_TABS) {
          const evictAt = next.findIndex(
            (tabId) => tabId !== conversationId && tabId !== s.activeConversationId,
          );
          if (evictAt >= 0) {
            next.splice(evictAt, 1);
          } else {
            next.shift();
          }
        }
        openTabs = next;
      }
      return {
        aiDraft: draft,
        activeConversationId: conversationId,
        rightPanel: 'ai',
        openTabs,
      };
    });
    return conversationId;
  },

  overview: null,
  overviewLoading: false,
  overviewScanning: false,
  lastScanAt: null,
  scanFreshnessByService: new Map<ServiceId, number>(),
  scanDurationByService: new Map<ServiceId, number | null>(),
  scanDeltasByService: new Map(),
  scanningServiceIds: new Set<ServiceId>(),
  setOverview: (v) => set({ overview: v }),
  setOverviewLoading: (v) => set({ overviewLoading: v }),
  setOverviewScanning: (v) => set({ overviewScanning: v }),
  patchOverviewScan: (result) =>
    set((s) => {
      if (!s.overview) return s;
      const byId = new Map(result.entries.map((e) => [e.service_id, e]));
      const projects = s.overview.projects.map((p) => {
        const hit = byId.get(p.service_id);
        // Merge `license` alongside `outdated` / `audit` so the
        // dashboard's `LicenseChip` lights up the moment the
        // workspace scan returns. Cards whose entry didn't carry a
        // license summary (runtime not supported, scan timed out)
        // keep their previous value rather than wiping the chip —
        // a transient timeout shouldn't erase yesterday's known
        // contamination.
        return hit
          ? {
              ...p,
              outdated: hit.outdated,
              audit: hit.audit,
              license: hit.license ?? p.license,
            }
          : p;
      });

      // Compute workspace-wide license totals from the merged
      // project list. The Rust side already returns these in
      // `result.total_license_warnings` etc., but recomputing from
      // `projects` keeps the source of truth consistent with how
      // the chips actually render — the filter chip count and the
      // hero priority bucket both walk `overview.projects`, so we
      // must agree with that same view.
      let totalLicenseWarnings = 0;
      let projectsWithLicenseRisk = 0;
      for (const p of projects) {
        const warnings =
          (p.license?.strong_copyleft_count ?? 0) +
          (p.license?.network_copyleft_count ?? 0) +
          (p.license?.proprietary_count ?? 0);
        totalLicenseWarnings += warnings;
        if (warnings > 0) projectsWithLicenseRisk += 1;
      }

      // Stamp per-project freshness from each entry's own
      // `scanned_at_ms`, not a single `Date.now()`. A 30-project
      // scan returns its results over several seconds; using the
      // batch's own per-entry timestamps keeps the UI honest about
      // which project finished first. Cache-hit entries reuse the
      // original scan's timestamp from the in-memory L1, so they
      // don't falsely advertise "scanned 0s ago".
      const freshness = new Map(s.scanFreshnessByService);
      const durations = new Map(s.scanDurationByService);
      const deltas = new Map(s.scanDeltasByService);
      let maxScannedAt = s.lastScanAt ?? 0;
      for (const e of result.entries) {
        freshness.set(e.service_id, e.scanned_at_ms);
        durations.set(e.service_id, e.duration_ms);
        if (e.scanned_at_ms > maxScannedAt) maxScannedAt = e.scanned_at_ms;

        // Compute delta only for fresh runs that have a prior row
        // to compare against. Cache hits expose neither
        // `previous_*` nor a meaningful "what changed", so we drop
        // any leftover delta for that service to avoid showing a
        // stale "+3" forever.
        if (!e.from_cache) {
          const liveOutdated = e.outdated?.total ?? 0;
          const liveVulns = e.audit
            ? e.audit.critical + e.audit.high + e.audit.medium + e.audit.low
            : 0;
          const dOutdated =
            e.previous_total_outdated != null ? liveOutdated - e.previous_total_outdated : null;
          const dVulns =
            e.previous_total_vulnerabilities != null
              ? liveVulns - e.previous_total_vulnerabilities
              : null;
          if ((dOutdated != null && dOutdated !== 0) || (dVulns != null && dVulns !== 0)) {
            deltas.set(e.service_id, { outdated: dOutdated, vulnerabilities: dVulns });
          } else {
            deltas.delete(e.service_id);
          }
        } else {
          deltas.delete(e.service_id);
        }
      }
      return {
        overview: {
          ...s.overview,
          projects,
          total_outdated: result.total_outdated,
          total_vulnerabilities: result.total_vulnerabilities,
          total_license_warnings: totalLicenseWarnings,
          projects_with_license_risk: projectsWithLicenseRisk,
          has_dependency_scan: true,
        },
        lastScanAt: maxScannedAt > 0 ? maxScannedAt : Date.now(),
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        scanDeltasByService: deltas,
      };
    }),
  patchScanEntry: (entry) =>
    set((s) => {
      // Single-project mirror of `patchOverviewScan`. Skip the heavy
      // recompute of total_outdated / total_vulnerabilities — those
      // numbers stay correct because we update *one* project's
      // contribution in place and adjust the global totals by the
      // delta.
      // Capture old project (pre-merge) so we can both render the new
      // license slot AND compute the delta against the workspace
      // totals without two `find()` walks per total.
      const oldProject = s.overview?.projects.find((p) => p.service_id === entry.service_id);
      const newLicense = entry.license ?? oldProject?.license ?? null;

      const oldLicenseWarnings = oldProject?.license
        ? (oldProject.license.strong_copyleft_count ?? 0) +
          (oldProject.license.network_copyleft_count ?? 0) +
          (oldProject.license.proprietary_count ?? 0)
        : 0;
      const newLicenseWarnings = newLicense
        ? (newLicense.strong_copyleft_count ?? 0) +
          (newLicense.network_copyleft_count ?? 0) +
          (newLicense.proprietary_count ?? 0)
        : 0;

      const overview = s.overview
        ? {
            ...s.overview,
            projects: s.overview.projects.map((p) =>
              p.service_id === entry.service_id
                ? {
                    ...p,
                    outdated: entry.outdated,
                    audit: entry.audit,
                    license: newLicense,
                  }
                : p,
            ),
            // Adjust workspace totals by the per-project delta so the
            // header chip ("12 advisories") doesn't drift after a
            // single rescan. Falls back to a cheap local recompute
            // when the previous-totals fields aren't available.
            total_outdated: (() => {
              const oldT = oldProject?.outdated?.total ?? 0;
              const newT = entry.outdated?.total ?? 0;
              return Math.max(0, s.overview!.total_outdated + (newT - oldT));
            })(),
            total_vulnerabilities: (() => {
              const oldA = oldProject?.audit;
              const oldT = oldA ? oldA.critical + oldA.high + oldA.medium + oldA.low : 0;
              const newA = entry.audit;
              const newT = newA ? newA.critical + newA.high + newA.medium + newA.low : 0;
              return Math.max(0, s.overview!.total_vulnerabilities + (newT - oldT));
            })(),
            total_license_warnings: Math.max(
              0,
              s.overview.total_license_warnings + (newLicenseWarnings - oldLicenseWarnings),
            ),
            projects_with_license_risk: Math.max(
              0,
              s.overview.projects_with_license_risk +
                (newLicenseWarnings > 0 ? 1 : 0) -
                (oldLicenseWarnings > 0 ? 1 : 0),
            ),
            has_dependency_scan: true,
          }
        : s.overview;

      const freshness = new Map(s.scanFreshnessByService);
      freshness.set(entry.service_id, entry.scanned_at_ms);
      const durations = new Map(s.scanDurationByService);
      durations.set(entry.service_id, entry.duration_ms);

      const deltas = new Map(s.scanDeltasByService);
      if (!entry.from_cache) {
        const liveOutdated = entry.outdated?.total ?? 0;
        const liveVulns = entry.audit
          ? entry.audit.critical + entry.audit.high + entry.audit.medium + entry.audit.low
          : 0;
        const dOutdated =
          entry.previous_total_outdated != null
            ? liveOutdated - entry.previous_total_outdated
            : null;
        const dVulns =
          entry.previous_total_vulnerabilities != null
            ? liveVulns - entry.previous_total_vulnerabilities
            : null;
        if ((dOutdated != null && dOutdated !== 0) || (dVulns != null && dVulns !== 0)) {
          deltas.set(entry.service_id, { outdated: dOutdated, vulnerabilities: dVulns });
        } else {
          deltas.delete(entry.service_id);
        }
      } else {
        deltas.delete(entry.service_id);
      }

      const lastScanAt = Math.max(s.lastScanAt ?? 0, entry.scanned_at_ms);

      return {
        overview,
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        scanDeltasByService: deltas,
        lastScanAt: lastScanAt > 0 ? lastScanAt : s.lastScanAt,
      };
    }),
  setScanningService: (serviceId, scanning) =>
    set((s) => {
      // We re-create the Set only when membership actually changes —
      // selectors that subscribe to scanningServiceIds via Set
      // identity won't re-render unless their service flipped.
      const has = s.scanningServiceIds.has(serviceId);
      if (scanning && has) return s;
      if (!scanning && !has) return s;
      const next = new Set(s.scanningServiceIds);
      if (scanning) next.add(serviceId);
      else next.delete(serviceId);
      return { scanningServiceIds: next };
    }),
  hydratePersistedScans: (rows) =>
    set((s) => {
      if (rows.length === 0) {
        return s;
      }

      // Two-step merge: (1) seed the freshness/duration maps so the
      // chips light up immediately, (2) splice the persisted
      // outdated/audit blobs into `overview.projects` so the
      // numerical chips (12 outdated, 3 advisories) render too. The
      // overview merge is a no-op when overview hasn't loaded yet —
      // the next `setOverview` will pick this up via the freshness
      // map alone.
      const freshness = new Map(s.scanFreshnessByService);
      const durations = new Map(s.scanDurationByService);
      const persistedById = new Map<string, PersistedScan>();
      let maxScannedAt = s.lastScanAt ?? 0;
      for (const row of rows) {
        // Don't clobber a fresher in-memory entry — the user might
        // have just kicked off a scan whose first results arrived
        // a tick before this hydration call resolved. Persisted
        // rows are at best as fresh as the scan that wrote them.
        const existing = freshness.get(row.service_id);
        if (existing == null || existing < row.scanned_at_ms) {
          freshness.set(row.service_id, row.scanned_at_ms);
          durations.set(row.service_id, row.duration_ms);
        }
        persistedById.set(row.service_id, row);
        if (row.scanned_at_ms > maxScannedAt) maxScannedAt = row.scanned_at_ms;
      }

      // The Rust side ALSO merges persisted scans into the overview
      // it returns from `get_project_overview`, so usually `overview`
      // already carries the audit/outdated data by the time this
      // runs. We splice anyway for the corner case where the
      // overview was fetched before persistence existed (older app
      // version's overview cached in memory) or where a service's
      // overview row is somehow missing the chips — defensive,
      // cheap, idempotent.
      const hydratedProjects = s.overview?.projects.map((p) => {
        const hit = persistedById.get(p.service_id);
        if (!hit) return p;
        return {
          ...p,
          outdated: p.outdated ?? hit.outdated,
          audit: p.audit ?? hit.audit,
          // Same "fill the gap, don't clobber" policy as the deps
          // hydration above: a fresh in-memory scan beats whatever
          // SQLite knows about; SQLite only fills holes.
          license: p.license ?? hit.license,
        };
      });

      // Recompute workspace license totals from the hydrated
      // projects. Persisted rows carry their own
      // `total_license_warnings`, but only after applying our
      // "don't clobber fresher in-memory data" merge policy can we
      // know which projects actually contribute.
      let totalLicenseWarnings = 0;
      let projectsWithLicenseRisk = 0;
      if (hydratedProjects) {
        for (const p of hydratedProjects) {
          const warnings =
            (p.license?.strong_copyleft_count ?? 0) +
            (p.license?.network_copyleft_count ?? 0) +
            (p.license?.proprietary_count ?? 0);
          totalLicenseWarnings += warnings;
          if (warnings > 0) projectsWithLicenseRisk += 1;
        }
      }

      const overview =
        s.overview && hydratedProjects
          ? {
              ...s.overview,
              projects: hydratedProjects,
              total_license_warnings: totalLicenseWarnings,
              projects_with_license_risk: projectsWithLicenseRisk,
              has_dependency_scan: s.overview.has_dependency_scan || rows.length > 0,
            }
          : s.overview;

      return {
        overview,
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        // Only advance the global "last scanned" if it's older than
        // the freshest persisted row — otherwise a hydration call
        // post-scan would rewind the badge.
        lastScanAt: maxScannedAt > (s.lastScanAt ?? 0) ? maxScannedAt : s.lastScanAt,
      };
    }),

  diffViewerOpen: false,
  diffViewerServiceId: null,
  diffViewerInitialTab: undefined,
  openDiffViewer: (serviceId, initialTab) =>
    set({
      diffViewerOpen: true,
      diffViewerServiceId: serviceId,
      diffViewerInitialTab: initialTab,
    }),
  closeDiffViewer: () =>
    set({
      diffViewerOpen: false,
      diffViewerServiceId: null,
      // Reset so the next open doesn't inherit the previous tab choice.
      diffViewerInitialTab: undefined,
    }),

  crossProjectDiffOpen: false,
  openCrossProjectDiff: () => set({ crossProjectDiffOpen: true }),
  closeCrossProjectDiff: () => set({ crossProjectDiffOpen: false }),

  whatsNewOpen: false,
  whatsNewVersion: null,
  openWhatsNew: (version) => set({ whatsNewOpen: true, whatsNewVersion: version }),
  closeWhatsNew: () => set({ whatsNewOpen: false }),

  releaseNotesOpen: false,
  releaseNotesSelectedVersion: null,
  // Release Notes is a singleton main tab now (see RELEASE_NOTES_TAB
  // definition above). Opening it adds the tab to the strip if it
  // isn't there, then activates it — the rest of the workspace
  // (services, dashboard, settings tab if any) stays mounted
  // alongside, so closing Release Notes returns the user to where
  // they were without a remount cycle. The `releaseNotesOpen` flag
  // shadows tab presence and is kept in sync by `closeMainTab`
  // (and the bulk-close reconcile helper).
  openReleaseNotes: (version) =>
    set((s) => {
      const exists = s.mainTabs.some((t) => mainTabKey(t) === RELEASE_NOTES_TAB_KEY);
      return {
        releaseNotesOpen: true,
        releaseNotesSelectedVersion: version ?? null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, RELEASE_NOTES_TAB, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: RELEASE_NOTES_TAB_KEY,
        // Mirror `setActiveMainTab` for the breadcrumb/sidebar:
        // jumping to Release Notes via status-bar / quick-action
        // shouldn't leave the sidebar still highlighting whatever
        // service/stack the user was on. Clicking the Release Notes
        // tab strip later goes through `setActiveMainTab` directly,
        // which performs the same clears — keeping the two entry
        // points symmetric.
        selectedServiceId: null,
        selectedStackId: null,
        selectedCmdName: null,
      };
    }),
  closeReleaseNotes: () => {
    // Delegated to closeMainTab so the snap-to-fallback logic and
    // the flag reconciliation live in exactly one place.
    get().closeMainTab(RELEASE_NOTES_TAB_KEY);
  },

  // ---- Settings hub ----------------------------------------------------------
  // Settings is a singleton main tab now (see SETTINGS_TAB definition
  // above). Opening it adds the tab + activates + records the
  // requested category; closing the tab through the X / Cmd+W /
  // closeSettings action all funnel through `closeMainTab`, which
  // also blanks `settingsCategory` so downstream consumers (the
  // prefs reload effect in App.tsx, the SettingsView body) see a
  // consistent "not open" state.
  settingsCategory: null,
  openSettings: (category) =>
    set((s) => {
      const exists = s.mainTabs.some((t) => mainTabKey(t) === SETTINGS_TAB_KEY);
      return {
        settingsCategory: category ?? 'shortcuts',
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, SETTINGS_TAB, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: SETTINGS_TAB_KEY,
        // Same breadcrumb-symmetry rationale as `openReleaseNotes`:
        // a status-bar Settings click jumps the active tab here,
        // so the sidebar shouldn't keep pointing at the previous
        // service/stack. Tab-strip activations route through
        // `setActiveMainTab` and already do the same clearing.
        selectedServiceId: null,
        selectedStackId: null,
        selectedCmdName: null,
      };
    }),
  closeSettings: () => {
    get().closeMainTab(SETTINGS_TAB_KEY);
  },

  diffShowUnchanged: initialDiffShowUnchanged,
  setDiffShowUnchanged: (v) => {
    set({ diffShowUnchanged: v });
    saveDiffShowUnchanged(v);
  },
}));
