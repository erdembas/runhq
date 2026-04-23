import AnsiToHtml from 'ansi-to-html';

/** Strip non-SGR ANSI control sequences before handing text to `ansi-to-html`.
 *
 *  `ansi-to-html` only understands SGR (`ESC [ … m`, color + style). For
 *  anything else — cursor moves, erase, scroll, save/restore, DEC private
 *  modes, OSC/APC/DCS/PM strings — it drops the `ESC [` prefix and leaks
 *  the trailing verb into rendered HTML. So we pre-strip those sequences,
 *  keeping only SGR.
 *
 *  Kept in sync with `LogPanel.tsx`'s copy — see that file for the detailed
 *  reasoning. Not deduped into this module yet because LogPanel embeds the
 *  palette tightly into a virtualized renderer; extracting both without
 *  regressing the live log view needs a bigger refactor. */
const ANSI_NON_SGR_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[@A-HJKSTfhlnpsuDEMLR]|[()][A-Z0-9]|[=>DEMHcp78])/g;

/** Collapse `\r`-overwritten lines down to just the last segment —
 *  progress indicators like "Receiving objects: 10% -> 100%" show as the
 *  final frame, not a mashed run. */
function collapseCarriageReturn(input: string): string {
  const idx = input.lastIndexOf('\r');
  return idx === -1 ? input : input.slice(idx + 1);
}

export function sanitizeAnsi(input: string): string {
  return collapseCarriageReturn(input).replace(ANSI_NON_SGR_RE, '');
}

/** VS Code "Dark+" / "Light+" palette, mirroring the embedded PTY so the
 *  Activity Timeline's per-event console block looks identical to the
 *  live log panel at the bottom of the screen. */
export function makeAnsiConverter(isDark: boolean): AnsiToHtml {
  const fg = isDark ? '#d4d4d4' : '#383a42';
  const bg = isDark ? '#1e1e1e' : '#ffffff';
  const palette = isDark
    ? {
        0: '#000000',
        1: '#cd3131',
        2: '#0dbc79',
        3: '#e5e510',
        4: '#2472c8',
        5: '#bc3fbc',
        6: '#11a8cd',
        7: '#e5e5e5',
        8: '#666666',
        9: '#f14c4c',
        10: '#23d18b',
        11: '#f5f543',
        12: '#3b8eea',
        13: '#d670d6',
        14: '#29b8db',
        15: '#e5e5e5',
      }
    : {
        0: '#000000',
        1: '#cd3131',
        2: '#00bc00',
        3: '#949800',
        4: '#0451a5',
        5: '#bc05bc',
        6: '#0598bc',
        7: '#555555',
        8: '#666666',
        9: '#cd3131',
        10: '#14ce14',
        11: '#b5ba00',
        12: '#0451a5',
        13: '#bc05bc',
        14: '#0598bc',
        15: '#a5a5a5',
      };
  return new AnsiToHtml({
    fg,
    bg,
    escapeXML: true,
    newline: false,
    colors: palette,
  });
}

/** Sanitize + render a single log line's text as ANSI-colored HTML.
 *  Safe to use with `dangerouslySetInnerHTML` — input is escaped by
 *  `ansi-to-html` (`escapeXML: true`), then SGR colors applied. */
export function renderAnsiToHtml(converter: AnsiToHtml, text: string): string {
  return converter.toHtml(sanitizeAnsi(text));
}
