import type { ITheme } from '@xterm/xterm';
import type { ISearchDecorationOptions } from '@xterm/addon-search';

/** Shared xterm.js theme used by both the integrated terminal pane
 *  and the log view. The palette intentionally mirrors the VS Code
 *  terminal in the reference screenshots, so CLI output colors stay
 *  familiar when users compare RunHQ against their editor. */
export const XTERM_DARK_THEME: ITheme = {
  background: '#0c0c0c',
  foreground: '#abb2bf',
  cursor: '#abb2bf',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#3e4451',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
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
