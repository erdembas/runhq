import type { ITheme } from '@xterm/xterm';
import type { ISearchDecorationOptions } from '@xterm/addon-search';

/** Shared xterm.js theme used by **both** the integrated terminal pane
 *  and the log view. Kept in one module so the two surfaces never drift
 *  out of sync — when they sit side-by-side in the split layout the
 *  user expects a single visual surface, not two terminals with
 *  different palettes.
 *
 *  The palette itself is RunHQ's brand-aligned dark — `#0c0c0c` body
 *  with a warm `#e8e4e0` foreground — rather than VS Code's "Dark
 *  Modern" defaults. We deliberately depart from VS Code here because
 *  the rest of the app (sidebar, toolbar, popovers) is already tuned
 *  to that warm palette; aligning the terminals to the host chrome
 *  feels more native than aligning them to a foreign editor. */
export const XTERM_DARK_THEME: ITheme = {
  background: '#0c0c0c',
  foreground: '#e8e4e0',
  cursor: '#e8e4e0',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#e8e4e033',
  black: '#0c0c0c',
  red: '#ef4444',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e8e4e0',
  brightBlack: '#6c6560',
  brightRed: '#f87171',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f5f5f4',
};

/** Light-mode counterpart — ivory body (`#faf8f6`), near-black ink
 *  (`#141210`), desaturated palette so colored output reads cleanly
 *  on a bright surface without the saturated dark-mode hues turning
 *  acidic. */
export const XTERM_LIGHT_THEME: ITheme = {
  background: '#faf8f6',
  foreground: '#141210',
  cursor: '#141210',
  cursorAccent: '#faf8f6',
  selectionBackground: '#14121020',
  black: '#141210',
  red: '#dc2626',
  green: '#059669',
  yellow: '#d97706',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#faf8f6',
  brightBlack: '#5c5650',
  brightRed: '#ef4444',
  brightGreen: '#10b981',
  brightYellow: '#f59e0b',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#f5f5f4',
};

/** Pick the theme matching the current dark/light mode. */
export function xtermTheme(isDark: boolean): ITheme {
  return isDark ? XTERM_DARK_THEME : XTERM_LIGHT_THEME;
}

/** Highlight palette for the search addon's decorations layer.
 *
 *  Two states:
 *  - `match*`: every match in the buffer that *isn't* currently active.
 *    Soft amber so the user can see at-a-glance how many hits exist
 *    without their eye being yanked to one specific spot.
 *  - `activeMatch*`: the match the cursor is on right now. Saturated
 *    orange so it pops against the surrounding amber sea — important
 *    when scrubbing through dozens of hits with Enter/Shift+Enter.
 *
 *  The ruler colors land on xterm's overview scrollbar. They mirror
 *  the same hue so a user scrolled away from their match still gets
 *  an unmistakable scrollbar tick pointing at it. */
export const XTERM_SEARCH_DECORATIONS: ISearchDecorationOptions = {
  matchBackground: '#fbbf2466',
  matchBorder: '#fbbf24',
  matchOverviewRuler: '#fbbf24',
  activeMatchBackground: '#f59e0bcc',
  activeMatchBorder: '#f59e0b',
  activeMatchColorOverviewRuler: '#f59e0b',
};

/** Hex codes for the dark/light backgrounds — exposed as plain strings
 *  so empty-state overlays (and any other "fill the gap" UI) can match
 *  the xterm body without round-tripping through the `ITheme` object.
 *  Keeping them adjacent to the themes themselves prevents drift when
 *  the palette gets retuned. */
export const XTERM_DARK_BG = '#0c0c0c';
export const XTERM_LIGHT_BG = '#faf8f6';
