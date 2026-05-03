import type { MainTab, SettingsCategoryId } from '@/store/appStoreTypes';
import {
  DASHBOARD_TAB_KEY,
  RELEASE_NOTES_TAB_KEY,
  SETTINGS_TAB_KEY,
  mainTabKey,
} from '@/store/appStoreTypes';

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

export function saveDiffShowUnchanged(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DIFF_SHOW_UNCHANGED_KEY, v ? '1' : '0');
  } catch {
    // non-fatal (same policy as other prefs)
  }
}

export const initialDiffShowUnchanged = loadDiffShowUnchanged();

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

export function savePinnedTabs(keys: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(keys));
  } catch {
    // non-fatal (same policy as the other prefs blobs above)
  }
}

export const initialPinnedTabs = loadPinnedTabs();

/**
 * Index of the first non-dashboard, non-pinned tab in `tabs`. Equal
 * to `tabs.length` when every tab is either the dashboard or
 * pinned (i.e. no unpinned zone exists yet). Used as the insertion
 * point for newly-opened unpinned tabs and as the "boundary" the
 * drag/move operations clamp against.
 */
export function pinBoundaryIndex(tabs: MainTab[], pinned: ReadonlySet<string>): number {
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
export function insertTabRespectingPin(
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
export function isPinnedKey(key: string, pinned: ReadonlySet<string>): boolean {
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
export function reconcileOverlayTabFlags(
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

// ─── Right-panel persistence ────────────────────────────────────────
// Stored separately from the rest of the store because the rail's
// active view is reload-stable UX: a user who closed RunHQ with the
// AI panel open expects to land back in the AI panel, not in a fresh
// "no panel" state. Width is a separate key so changing the active
// panel doesn't blow away the resize gesture, and vice versa.
const RIGHT_PANEL_KEY = 'runhq.rightPanel.active';
const RIGHT_PANEL_WIDTH_KEY = 'runhq.rightPanel.width';
export const RIGHT_PANEL_MIN_W = 280;
export const RIGHT_PANEL_MAX_W = 900;
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

export function loadRightPanel(): 'activity' | 'ai' | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_KEY);
    if (raw === 'activity' || raw === 'ai') return raw;
    return null;
  } catch {
    return null;
  }
}

export function saveRightPanel(panel: 'activity' | 'ai' | null) {
  if (typeof window === 'undefined') return;
  try {
    if (panel == null) window.localStorage.removeItem(RIGHT_PANEL_KEY);
    else window.localStorage.setItem(RIGHT_PANEL_KEY, panel);
  } catch {
    /* localStorage can throw in private mode; ignore */
  }
}

export function loadRightPanelWidth(): number {
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

export function saveRightPanelWidth(width: number) {
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

export function loadSidebarPinned(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PINNED_KEY);
    if (raw == null) return true; // first launch keeps the previous default
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function saveSidebarPinned(pinned: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? '1' : '0');
  } catch {
    /* ignore */
  }
}
