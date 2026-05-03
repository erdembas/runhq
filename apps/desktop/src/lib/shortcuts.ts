import type { Shortcuts } from '@/types';

/**
 * Single source of truth for shortcut defaults, metadata, and the
 * keyboard-event normaliser. Lives in `lib/` (not `components/`)
 * because both the settings dialog *and* the runtime view-shortcut
 * dispatcher need the same definitions — co-locating them is what
 * lets us keep "label + default + scope" attached to a single
 * authoritative record.
 *
 * Stored values use Tauri's platform-agnostic aliases (`CmdOrCtrl`,
 * `Control`, etc.) so the global-shortcut plugin and the React-side
 * matcher both parse the same string. The UI renders them through
 * `normalizeShortcutForDisplay` so the user sees `Cmd` on macOS and
 * `Ctrl` on Windows / Linux.
 */

export type ShortcutId = keyof Shortcuts;

/**
 * Where the shortcut fires.
 *
 *   • `global` — registered with Tauri's global-shortcut plugin;
 *     fires from anywhere on the OS, even when RunHQ is hidden /
 *     unfocused. Changes require a restart for the OS to pick up
 *     the new binding.
 *
 *   • `view` — handled by `useViewShortcuts` in the React layer;
 *     only fires while the RunHQ window has focus. Changes take
 *     effect immediately on save.
 */
export type ShortcutScope = 'global' | 'view';

/**
 * Higher-level grouping for the settings UI. Lets us render
 * "Window panels", "Main tabs", etc. as their own sections without
 * the user having to read the scope to figure out where a shortcut
 * lives in their head.
 */
export type ShortcutGroup = 'global' | 'panels' | 'service' | 'tabs';

export interface ShortcutMeta {
  id: ShortcutId;
  scope: ShortcutScope;
  group: ShortcutGroup;
  /** Default chord in Tauri's cross-platform alias form. */
  defaultBinding: string;
  /** Short label shown in the settings row. */
  label: string;
  /** One-sentence explanation rendered under the label. */
  description: string;
}

export const DEFAULT_SHORTCUTS: Shortcuts = {
  quick_action: 'CmdOrCtrl+Shift+K',
  focus_main: 'CmdOrCtrl+Shift+L',
  toggle_left_sidebar: 'CmdOrCtrl+B',
  toggle_ai_panel: 'CmdOrCtrl+Shift+A',
  toggle_activity_panel: 'CmdOrCtrl+Shift+T',
  new_terminal: 'CmdOrCtrl+`',
  next_main_tab: 'Control+Tab',
  prev_main_tab: 'Control+Shift+Tab',
  close_main_tab: 'CmdOrCtrl+W',
};

/**
 * Catalogue of every rebindable shortcut. Kept in declaration order
 * because the settings dialog renders the rows by iterating this
 * list group-by-group — no separate ordering table to keep in sync.
 */
export const SHORTCUT_CATALOG: ReadonlyArray<ShortcutMeta> = [
  // ---- Global (Tauri global-shortcut plugin) ----
  {
    id: 'quick_action',
    scope: 'global',
    group: 'global',
    defaultBinding: DEFAULT_SHORTCUTS.quick_action,
    label: 'Quick Action Bar',
    description:
      'Open the Spotlight-like search bar from anywhere. The app window will be brought to front if hidden.',
  },
  {
    id: 'focus_main',
    scope: 'global',
    group: 'global',
    defaultBinding: DEFAULT_SHORTCUTS.focus_main,
    label: 'Show RunHQ window',
    description:
      'Bring the main RunHQ window to the foreground from anywhere — works even when RunHQ is hidden in the menu bar / tray, minimised, or sitting behind a fullscreen editor.',
  },

  // ---- Window panels ----
  {
    id: 'toggle_left_sidebar',
    scope: 'view',
    group: 'panels',
    defaultBinding: DEFAULT_SHORTCUTS.toggle_left_sidebar,
    label: 'Toggle left sidebar',
    description:
      'Pin or unpin the left sidebar. When unpinned the sidebar collapses to its rail and re-expands on hover.',
  },
  {
    id: 'toggle_ai_panel',
    scope: 'view',
    group: 'panels',
    defaultBinding: DEFAULT_SHORTCUTS.toggle_ai_panel,
    label: 'Toggle AI Chat panel',
    description: 'Open or collapse the AI Chat panel on the right side of the workspace.',
  },
  {
    id: 'toggle_activity_panel',
    scope: 'view',
    group: 'panels',
    defaultBinding: DEFAULT_SHORTCUTS.toggle_activity_panel,
    label: 'Toggle Activity panel',
    description: 'Open or collapse the Activity timeline panel on the right side.',
  },

  // ---- Service-internal ----
  {
    id: 'new_terminal',
    scope: 'view',
    group: 'service',
    defaultBinding: DEFAULT_SHORTCUTS.new_terminal,
    label: 'New terminal',
    description:
      'Spawn a new terminal in the active service tab. The terminal opens in the most recently focused terminal pane, or in a new pane if none exists.',
  },

  // ---- Main tabs ----
  {
    id: 'next_main_tab',
    scope: 'view',
    group: 'tabs',
    defaultBinding: DEFAULT_SHORTCUTS.next_main_tab,
    label: 'Next main tab',
    description:
      'Cycle to the next tab in the top tab strip. Wraps around at the end so the dashboard is always one keystroke away.',
  },
  {
    id: 'prev_main_tab',
    scope: 'view',
    group: 'tabs',
    defaultBinding: DEFAULT_SHORTCUTS.prev_main_tab,
    label: 'Previous main tab',
    description: 'Cycle to the previous tab in the top tab strip. Wraps around at the start.',
  },
  {
    id: 'close_main_tab',
    scope: 'view',
    group: 'tabs',
    defaultBinding: DEFAULT_SHORTCUTS.close_main_tab,
    label: 'Close active main tab',
    description:
      'Close the currently active tab. The dashboard tab is sticky and ignores this — closing it would leave the workspace with no anchor.',
  },
];

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, string> = {
  global: 'Global (system-wide)',
  panels: 'Window panels',
  service: 'Service workspace',
  tabs: 'Main tabs',
};

export const SHORTCUT_GROUP_DESCRIPTIONS: Record<ShortcutGroup, string> = {
  global:
    'Registered with the OS and fire even when RunHQ is hidden, minimised, or behind another app. Changes take effect after restarting RunHQ.',
  panels:
    'Show, hide, or focus the workspace panels around the editor area. Active only while the RunHQ window has focus.',
  service:
    'Act on the currently focused service tab. The shortcut is delegated to that tab’s layout — switch tabs to act on a different service.',
  tabs: 'Move between or close the tabs in the top tab strip.',
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * The primary "command" modifier as the user expects to see it on
 * their OS — Cmd on Mac, Ctrl everywhere else. Windows / Linux
 * users don't want to see "Cmd" anywhere in the UI; this is the
 * pragmatic cross-platform convention VS Code, Slack, Linear, etc.
 * all follow.
 */
export const PRIMARY_MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';

/**
 * Collapse every alias Tauri will accept for the platform's primary
 * modifier into the single label the user expects to see. `Control`
 * stays as `Ctrl` (not collapsed into `Cmd` on macOS) because a
 * power user may bind literal Control on purpose — `Control+Tab`
 * for tab cycling is exactly that case.
 */
export function normalizeShortcutForDisplay(raw: string): string {
  return raw
    .replace(/CommandOrControl/g, PRIMARY_MOD_LABEL)
    .replace(/CmdOrCtrl/g, PRIMARY_MOD_LABEL)
    .replace(/Command/g, PRIMARY_MOD_LABEL)
    .replace(/\bCmd\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bSuper\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bMeta\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bControl\b/g, 'Ctrl');
}

/**
 * Canonical chord for *matching* (lowercase, no spaces, modifier
 * names normalised to a single token). Used by the view-shortcut
 * dispatcher and the conflict detector — both need a stable form
 * that ignores how the user typed `Cmd` vs `CmdOrCtrl`.
 *
 * `cmdOrCtrl` collapses to `mod` so that "the platform's primary
 * modifier" is a single token regardless of what the user / default
 * said. This is what makes a `Cmd+B` on macOS match a `Ctrl+B` on
 * Windows when both are stored as `CmdOrCtrl+B`.
 */
export function canonicalizeChord(raw: string): string {
  if (!raw) return '';
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (
      lower === 'cmdorctrl' ||
      lower === 'commandorcontrol' ||
      lower === 'cmd' ||
      lower === 'command' ||
      lower === 'meta' ||
      lower === 'super'
    ) {
      out.push('mod');
    } else if (lower === 'control' || lower === 'ctrl') {
      out.push('ctrl');
    } else if (lower === 'option' || lower === 'opt' || lower === 'alt') {
      out.push('alt');
    } else if (lower === 'shift') {
      out.push('shift');
    } else {
      // Single-character keys are upper-cased so `B` and `b` collide,
      // which matches how every OS shortcut parser treats letters.
      out.push(part.length === 1 ? part.toUpperCase() : part);
    }
  }
  // Modifier order doesn't matter for matching, so sort the
  // modifiers and keep the trailing key in place. `mod`, `ctrl`,
  // `alt`, `shift` are the only modifier tokens after canonicalising.
  const modifierSet = new Set(['mod', 'ctrl', 'alt', 'shift']);
  const mods = out.filter((p) => modifierSet.has(p));
  const keys = out.filter((p) => !modifierSet.has(p));
  mods.sort();
  return [...mods, ...keys].join('+').toLowerCase();
}

/**
 * Build the canonical chord that a `KeyboardEvent` represents,
 * using the same token vocabulary as `canonicalizeChord` so the
 * dispatcher can compare apples to apples. `metaKey` and `ctrlKey`
 * both map to `mod` on macOS / non-mac respectively (matching
 * Tauri's `CmdOrCtrl` semantics); `Control` on macOS becomes the
 * literal `ctrl` token so power-user bindings like `Control+Tab`
 * work without collision with `Cmd`.
 */
export function chordFromKeyboardEvent(e: KeyboardEvent): string {
  const tokens: string[] = [];
  if (IS_MAC) {
    if (e.metaKey) tokens.push('mod');
    if (e.ctrlKey) tokens.push('ctrl');
  } else {
    // On Windows/Linux the platform's primary modifier IS Control,
    // so `ctrlKey` becomes `mod`. There's no separate "literal
    // Control" channel — anyone binding Ctrl+Tab on Windows is by
    // definition binding the primary modifier, which `mod` covers.
    if (e.ctrlKey) tokens.push('mod');
    if (e.metaKey) tokens.push('mod');
  }
  if (e.altKey) tokens.push('alt');
  if (e.shiftKey) tokens.push('shift');
  let key = e.key;
  // `event.key` for the Tab character is `Tab` on every platform
  // even when modifiers change — just normalise the case.
  if (key === ' ') key = 'Space';
  if (key === '`') key = '`'; // backtick stays as-is
  // Skip pure modifier-up events; the dispatcher only cares about
  // chord completion, not modifier release.
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    return tokens.sort().join('+').toLowerCase();
  }
  const keyToken = key.length === 1 ? key.toUpperCase() : key;
  // Re-use the canonicaliser so we share one definition of "stable
  // chord string" across stored bindings and live events.
  return canonicalizeChord([...tokens, keyToken].join('+'));
}

/**
 * Used by the settings dialog to record a chord the user just
 * pressed. Returns the binding in the *display* form (Cmd/Ctrl
 * resolved to whatever the user's OS shows) — easier on the eye
 * than `CmdOrCtrl+Shift+K` and round-trips through the matcher
 * just fine because everything goes through `canonicalizeChord`.
 */
export function chordToStoredBinding(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  // A modifier is required so accidental letter presses don't
  // overwrite a binding while the row is in record mode.
  const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
  if (e.metaKey || e.ctrlKey) parts.push(PRIMARY_MOD_LABEL);
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;
  if (!hasModifier) return null;
  let token: string;
  if (key === ' ') token = 'Space';
  else token = key.length === 1 ? key.toUpperCase() : key;
  parts.push(token);
  return parts.join('+');
}
