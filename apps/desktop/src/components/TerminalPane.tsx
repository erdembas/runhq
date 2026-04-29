import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchDecorationOptions } from '@xterm/addon-search';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';

interface Props {
  id: string;
  cwd: string;
}

const NERD_FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Menlo", "Monaco", "Consolas", "Courier New", monospace';

const DARK_THEME: ITheme = {
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

const LIGHT_THEME: ITheme = {
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
const SEARCH_DECORATIONS: ISearchDecorationOptions = {
  matchBackground: '#fbbf2466',
  matchBorder: '#fbbf24',
  matchOverviewRuler: '#fbbf24',
  activeMatchBackground: '#f59e0bcc',
  activeMatchBorder: '#f59e0b',
  activeMatchColorOverviewRuler: '#f59e0b',
};

function xtermTheme(isDark: boolean): ITheme {
  return isDark ? DARK_THEME : LIGHT_THEME;
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/**
 * Decode the base64 payload that the Rust PTY pipeline ships through
 * `Channel<TerminalOutput>`. `atob` returns a binary string (one
 * char per byte, low-byte preserved), and we copy it into a
 * `Uint8Array` via `charCodeAt`. The byte-length is identical to the
 * original PTY chunk, which is exactly what `Terminal.write` expects.
 *
 * We deliberately keep this synchronous — `atob` on a 32 KB payload
 * costs well under 1 ms on every browser shipped this decade, so the
 * detour through `Blob` + `arrayBuffer()` (which would let us decode
 * off the main thread but introduces async + GC pressure) isn't
 * worth it for our payload sizes.
 */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Write a red error banner into the xterm itself.
 *
 *  Why in-band instead of a global toast: the user is staring at the
 *  terminal pane when this fires (they just opened it). A toast off in
 *  the corner is easy to miss and disconnected from the cause. A red
 *  in-pane line is impossible to ignore and shows up in scrollback if
 *  they later wonder why nothing's responding. The trailing reset
 *  (`\x1b[0m`) prevents the SGR red from bleeding into whatever the
 *  shell's first prompt prints. */
function writeError(term: Terminal, message: string): void {
  term.write(`\r\n\x1b[31m✖ ${message}\x1b[0m\r\n`);
}

interface MatchInfo {
  /** 1-indexed position of the active match for human display. */
  index: number;
  /** Total matches currently visible in the buffer. */
  count: number;
}

export function TerminalPane({ id, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(isDark);
    }
  }, [isDark]);

  /** Run a search in `direction`. Memoised so the keyboard handlers
   *  attached to the input element get a stable reference and don't
   *  thrash dependency arrays. The actual `findNext`/`findPrevious`
   *  call is cheap; the only state we touch is the active match
   *  index inside the addon, and the addon emits a results event
   *  that drives our match counter. */
  const runSearch = useCallback((query: string, direction: 'next' | 'prev') => {
    const search = searchRef.current;
    if (!search) return;
    if (!query) {
      // Empty query = clear decorations rather than searching for "".
      // The addon treats "" as "no results" so this is mostly cosmetic,
      // but explicitly bailing keeps the match counter from flashing
      // a stale value during fast Backspace-to-empty.
      return;
    }
    const opts = { decorations: SEARCH_DECORATIONS };
    if (direction === 'next') {
      search.findNext(query, opts);
    } else {
      search.findPrevious(query, opts);
    }
  }, []);

  /** Open the search bar. Pre-fills with whatever the user has
   *  selected in the terminal (familiar Cmd+F behaviour from
   *  browsers / VS Code). Empty selection ⇒ keep whatever was last
   *  typed so a quick Cmd+F to "rescue" a closed bar feels natural. */
  const openSearch = useCallback(() => {
    const term = termRef.current;
    const selection = term?.getSelection() ?? '';
    if (selection) setSearchQuery(selection);
    setSearchOpen(true);
    // Defer focus until after the input has actually rendered.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  /** Close the search bar, clear decorations, and return focus to
   *  the terminal so the next keystroke goes to the shell. Without
   *  the explicit refocus the user lands in DOM-tab-order limbo and
   *  the shell silently swallows their next character. */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setMatchInfo(null);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: NERD_FONT_STACK,
      letterSpacing: 0,
      lineHeight: 1.25,
      scrollback: 10_000,
      allowProposedApi: true,
      allowTransparency: false,
      theme: xtermTheme(isDark),
    });
    termRef.current = term;

    const unicodeAddon = new Unicode11Addon();
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    // Web links addon — turn anything that looks like an http(s) URL
    // into a clickable region. The default click handler navigates
    // the *current* webview, which would replace RunHQ with the
    // target page (catastrophic). We override with a custom handler
    // that routes through `ipc.openUrl`, which uses the OS opener
    // (`open` on macOS, `start` on Windows, `xdg-open` on Linux) so
    // links open in the user's default browser instead.
    const webLinks = new WebLinksAddon((event, url) => {
      event.preventDefault();
      void ipc.openUrl(url).catch((err: unknown) => {
        console.warn('openUrl failed', err);
      });
    });
    term.loadAddon(webLinks);

    // Search addon. We wire up `onDidChangeResults` so the floating
    // search bar can render an "N of M" counter; this is the only
    // way to know the addon's internal match state without polling.
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    const resultsDisposable = search.onDidChangeResults((event) => {
      // The addon emits `{ resultIndex: -1, resultCount: 0 }` when
      // there are no matches (or when the query is cleared). Both
      // collapse to "no match info" from the UI's perspective.
      if (!event || event.resultCount === 0 || event.resultIndex < 0) {
        setMatchInfo(null);
      } else {
        setMatchInfo({ index: event.resultIndex + 1, count: event.resultCount });
      }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Intercept Cmd/Ctrl+F BEFORE xterm's own keyboard handling.
    // Returning `false` from the custom handler tells xterm "I've
    // handled this, do not pass it to the shell" — important because
    // bash treats Ctrl+F as forward-char (cursor right) and we'd
    // otherwise both open the search bar AND nudge the cursor. We
    // only act on `keydown` so the matching `keyup` doesn't toggle
    // the bar back closed.
    term.attachCustomKeyEventHandler((event) => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === 'f';
      if (isFindShortcut) {
        if (event.type === 'keydown') {
          openSearch();
        }
        return false;
      }
      return true;
    });

    let alive = true;

    requestAnimationFrame(() => {
      if (!alive) return;
      fit.fit();
      const { cols, rows } = term;
      ipc
        .terminalCreate(id, cwd, cols, rows, (chunk) => {
          if (!alive) return;
          const bytes = decodeBase64(chunk.data);
          term.write(bytes);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          const message = err instanceof Error ? err.message : String(err);
          console.error('terminalCreate failed', err);
          writeError(term, `Failed to start terminal: ${message}`);
        });
      term.focus();
    });

    term.onData((data) => {
      const encoded = new TextEncoder().encode(data);
      void ipc.terminalWrite(id, Array.from(encoded)).catch((err: unknown) => {
        console.warn('terminalWrite failed', err);
      });
    });

    let resizeRaf = 0;
    const flushResize = () => {
      resizeRaf = 0;
      if (!alive) return;
      try {
        fit.fit();
        const { cols: c, rows: r } = term;
        void ipc.terminalResize(id, c, r).catch((err: unknown) => {
          console.warn('terminalResize failed', err);
        });
      } catch {
        // `fit.fit()` throws if the container has zero dimensions
        // (parent collapsed mid-teardown). Swallow — the next live
        // resize will recompute correctly.
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (!alive) return;
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(flushResize);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      alive = false;
      termRef.current = null;
      searchRef.current = null;
      resultsDisposable.dispose();
      if (resizeRaf !== 0) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      resizeObserver.disconnect();
      void ipc.terminalDestroy(id).catch(() => undefined);
      term.dispose();
    };
    // `isDark` is intentionally NOT in the dep array. It's read once
    // at construction to seed the initial theme; subsequent theme
    // changes flow through the dedicated effect above which mutates
    // `term.options.theme` in place. `openSearch` is stable
    // (useCallback with no deps) but lint can't always prove it, so
    // we ALSO suppress its inclusion to keep the effect from churning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd]);

  // Live-search as the user types. Debouncing isn't worth the
  // complexity — `findNext` is sub-millisecond on a 10 K-line buffer,
  // and the addon's debounce-and-decorate pipeline is internal.
  // Using 'next' direction here means typing "fo" highlights the
  // first "fo" match; switching to "foo" advances if the previous
  // active match no longer matches. Matches user expectation.
  useEffect(() => {
    if (!searchOpen) return;
    if (!searchQuery) {
      searchRef.current?.clearDecorations();
      setMatchInfo(null);
      return;
    }
    runSearch(searchQuery, 'next');
  }, [searchOpen, searchQuery, runSearch]);

  const onSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    },
    [searchQuery, runSearch, closeSearch],
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" style={{ minHeight: '200px' }} />
      {searchOpen && (
        <div
          className={cn(
            'border-border bg-surface-raised shadow-lg',
            'absolute top-2 right-3 z-10 flex items-center gap-1',
            'rounded-app-sm border px-1.5 py-1',
          )}
          // Stop the floating bar from leaking pointer events back into
          // xterm — without this, clicking the input registers as a
          // terminal click that yanks focus to the shell on mouseup.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={onSearchInputKeyDown}
            placeholder="Find…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={cn(
              'border-border bg-surface-muted/70 text-fg placeholder:text-fg-dim',
              'focus:border-accent/60 focus:bg-surface',
              'rounded-app-sm h-6 w-44 border px-2 text-[12px] transition focus:outline-none',
            )}
          />
          <span
            className={cn(
              'text-fg-dim min-w-[44px] px-1 text-center font-mono text-[10.5px] tabular-nums',
              matchInfo === null && searchQuery !== '' && 'text-status-error',
            )}
          >
            {matchInfo
              ? `${matchInfo.index}/${matchInfo.count}`
              : searchQuery === ''
                ? '0/0'
                : 'no match'}
          </span>
          <button
            type="button"
            onClick={() => runSearch(searchQuery, 'prev')}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => runSearch(searchQuery, 'next')}
            title="Next match (Enter)"
            aria-label="Next match"
            className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title="Close (Esc)"
            aria-label="Close search"
            className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
