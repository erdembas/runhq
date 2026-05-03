import type { ServiceId } from '@/types';

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

export interface MainTabStoreSlice {
  selectedServiceId: ServiceId | null;
  selectedCmdName: string | null;
  selectedStackId: string | null;

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
}
