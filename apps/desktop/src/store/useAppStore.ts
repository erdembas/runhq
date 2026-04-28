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
  setSelectedCmd: (cmdName: string | null) => void;
  setSelectedStack: (id: string | null) => void;
  setAppMeta: (version: string, stateDir: string) => void;

  setCategoryFilter: (keys: string[]) => void;
  setRuntimeFilter: (keys: string[]) => void;
  setSidebarStatusFilter: (v: SidebarStatusFilter) => void;
  setSidebarGroupBy: (v: SidebarGroupBy) => void;
  setDashboardGroupBy: (v: DashboardGroupBy) => void;
  setDashboardSortBy: (v: DashboardSortBy) => void;
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
}

const VALID_GROUP_BYS: DashboardGroupBy[] = ['none', 'category', 'runtime', 'status'];
const VALID_SORT_BYS: DashboardSortBy[] = ['name', 'activity', 'risk', 'memory', 'cpu'];

function loadDashboardPrefs(): DashboardPrefs {
  const defaults: DashboardPrefs = { groupBy: 'category', sortBy: 'name' };
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

interface SectionsSnapshot {
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
}

function emptySections(): SectionsSnapshot {
  return { sections: [], serviceSection: {}, stackSection: {}, collapsedSections: {} };
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

  categoryFilter: initialSidebarPrefs.categoryFilter,
  runtimeFilter: initialSidebarPrefs.runtimeFilter,
  sidebarStatusFilter: initialSidebarPrefs.statusFilter,
  sidebarGroupBy: initialSidebarPrefs.groupBy,
  dashboardGroupBy: initialDashboardPrefs.groupBy,
  dashboardSortBy: initialDashboardPrefs.sortBy,
  search: '',
  editorService: undefined,
  stacks: [],
  editorStack: undefined,

  sections: initialSections.sections,
  serviceSection: initialSections.serviceSection,
  stackSection: initialSections.stackSection,
  collapsedSections: initialSections.collapsedSections,

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
      saveSections({
        sections: s.sections,
        serviceSection: restServiceSection,
        stackSection: s.stackSection,
        collapsedSections: s.collapsedSections,
      });
      return {
        services: s.services.filter((x) => x.id !== id),
        selectedServiceId: s.selectedServiceId === id ? null : s.selectedServiceId,
        serviceSection: restServiceSection,
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
  // `releaseNotesOpen: false` here matters: Release Notes lives in the
  // main-area conditional chain *above* selectedServiceId / selectedStackId,
  // so without explicitly clearing it the user would click a service in
  // the sidebar and stay stuck on the archive page. Sidebar nav must
  // always win — that's the user's whole way out of Release Notes.
  setSelected: (id) =>
    set({
      selectedServiceId: id,
      selectedCmdName: null,
      selectedStackId: null,
      releaseNotesOpen: false,
    }),
  setSelectedCmd: (cmdName) => set({ selectedCmdName: cmdName }),
  setSelectedStack: (id) =>
    set({
      selectedStackId: id,
      selectedServiceId: null,
      selectedCmdName: null,
      releaseNotesOpen: false,
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
    saveDashboardPrefs({ groupBy: v, sortBy: get().dashboardSortBy });
  },
  setDashboardSortBy: (v) => {
    set({ dashboardSortBy: v });
    saveDashboardPrefs({ groupBy: get().dashboardGroupBy, sortBy: v });
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
      saveSections({
        sections: s.sections,
        serviceSection: s.serviceSection,
        stackSection: restStackSection,
        collapsedSections: s.collapsedSections,
      });
      return {
        stacks: s.stacks.filter((x) => x.id !== id),
        stackSection: restStackSection,
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
    set({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
    });
    saveSections({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
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
    set({ serviceSection: next });
    saveSections({
      sections: s.sections,
      serviceSection: next,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
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
    set({ stackSection: next });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: next,
      collapsedSections: s.collapsedSections,
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
        return hit ? { ...p, outdated: hit.outdated, audit: hit.audit } : p;
      });

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
      const overview = s.overview
        ? {
            ...s.overview,
            projects: s.overview.projects.map((p) =>
              p.service_id === entry.service_id
                ? { ...p, outdated: entry.outdated, audit: entry.audit }
                : p,
            ),
            // Adjust workspace totals by the per-project delta so the
            // header chip ("12 advisories") doesn't drift after a
            // single rescan. Falls back to a cheap local recompute
            // when the previous-totals fields aren't available.
            total_outdated: (() => {
              const old = s.overview!.projects.find((p) => p.service_id === entry.service_id);
              const oldT = old?.outdated?.total ?? 0;
              const newT = entry.outdated?.total ?? 0;
              return Math.max(0, s.overview!.total_outdated + (newT - oldT));
            })(),
            total_vulnerabilities: (() => {
              const old = s.overview!.projects.find((p) => p.service_id === entry.service_id);
              const oldA = old?.audit;
              const oldT = oldA ? oldA.critical + oldA.high + oldA.medium + oldA.low : 0;
              const newA = entry.audit;
              const newT = newA ? newA.critical + newA.high + newA.medium + newA.low : 0;
              return Math.max(0, s.overview!.total_vulnerabilities + (newT - oldT));
            })(),
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
      const overview = s.overview
        ? {
            ...s.overview,
            projects: s.overview.projects.map((p) => {
              const hit = persistedById.get(p.service_id);
              if (!hit) return p;
              return {
                ...p,
                outdated: p.outdated ?? hit.outdated,
                audit: p.audit ?? hit.audit,
              };
            }),
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
  openReleaseNotes: (version) =>
    set({
      releaseNotesOpen: true,
      releaseNotesSelectedVersion: version ?? null,
      // Clear other main-area selections so the page truly takes over
      // the canvas. Without this, a user who had a service open would
      // see Release Notes "win" via render-precedence but the sidebar
      // would still highlight the old service — confusing breadcrumbs.
      selectedServiceId: null,
      selectedCmdName: null,
      selectedStackId: null,
    }),
  closeReleaseNotes: () => set({ releaseNotesOpen: false }),

  diffShowUnchanged: initialDiffShowUnchanged,
  setDiffShowUnchanged: (v) => {
    set({ diffShowUnchanged: v });
    saveDiffShowUnchanged(v);
  },
}));
