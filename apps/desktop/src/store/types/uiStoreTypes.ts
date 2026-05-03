import type { ServiceId } from '@/types';
import type { SettingsCategoryId } from '@/store/types/settingsTypes';

export interface UiStoreSlice {
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
