import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { sanitizeAnsi } from '@/lib/ansi';
import {
  XTERM_DARK_BG,
  XTERM_LIGHT_BG,
  XTERM_SEARCH_DECORATIONS,
  xtermTheme,
} from '@/lib/xtermTheme';
import type { LogLine } from '@/types';

/** Monospace stack matching the legacy `.log-line` rule in `styles.css`.
 *  Kept identical so users who have JetBrains Mono / Fira Code installed
 *  see the exact same glyphs as before. xterm.js DOM/canvas measurement
 *  cares about the *first* font that resolves, so order matters. */
const FONT_STACK =
  '"JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace';

/** SGR fallback colors per stream — applied **only** when a line carries
 *  no inline ANSI of its own. Mirrors the legacy `streamColorClass`
 *  behaviour: stderr stays red, `system` lines stay cyan + italic, stdout
 *  inherits the theme's foreground. If the source process already styled
 *  the line we leave it alone; fighting a colored progress bar with a
 *  blanket red prefix would obliterate the original palette. */
const STREAM_PREFIX: Record<LogLine['stream'], { open: string; close: string }> = {
  stdout: { open: '', close: '' },
  // SGR 31 = red foreground; 39 = default foreground.
  stderr: { open: '\x1b[31m', close: '\x1b[39m' },
  // SGR 36;3 = cyan + italic; 23;39 = un-italic + default foreground.
  system: { open: '\x1b[36;3m', close: '\x1b[23;39m' },
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Full local timestamp: `YYYY-MM-DD HH:MM:SS`. Identical formatting to
 *  the legacy `formatTs` in `LogPanel.tsx` so toggle-on / toggle-off
 *  matches what users have come to expect. */
function formatTs(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Width of the timestamp prefix in characters (`YYYY-MM-DD HH:MM:SS`). */
const TS_WIDTH = 19;

/** Render one log line as the byte string we hand to `Terminal.write`.
 *
 *  Pipeline (deliberately mirrors the legacy LogPanel):
 *    1. `sanitizeAnsi` collapses CR-overwritten frames down to the last
 *       one and strips non-SGR ANSI (cursor moves, OSC, scroll, alt-buffer
 *       toggles, …). Without this a misbehaving CLI could move xterm's
 *       cursor up and overwrite earlier log lines, or worse, swap to the
 *       alt-buffer and wipe scrollback. SGR survives so colors keep
 *       working.
 *    2. Stream coloring is applied only when the line ships no inline
 *       SGR — same fallback the old `streamColorClass` provided.
 *    3. Optional timestamp prefix, dimmed via SGR 2 so it doesn't
 *       compete visually with the actual log content.
 *    4. Trailing `\r\n` so xterm advances to a fresh row. We don't
 *       enable `convertEol` because we want explicit control here — a
 *       line that *itself* contained a `\r` (progress bar) has already
 *       been collapsed by sanitizeAnsi. */
function formatLineBytes(line: LogLine, opts: { showTimestamp: boolean }): string {
  const sanitized = sanitizeAnsi(line.text);
  const hasInlineAnsi = sanitized.includes('\x1b[');
  let body = sanitized;
  if (!hasInlineAnsi) {
    const { open, close } = STREAM_PREFIX[line.stream];
    if (open) body = `${open}${body}${close}`;
  }
  if (opts.showTimestamp) {
    // Empty rows skip the timestamp and reserve column width with
    // spaces so subsequent lines stay aligned. Matches the legacy
    // LogPanel behaviour where blank rows (Vite's spacer between
    // port-in-use retry banners, etc.) intentionally don't repeat
    // the wall clock.
    const ts = line.text.trim() === '' ? ' '.repeat(TS_WIDTH) : formatTs(line.ts_ms);
    body = `\x1b[2m${ts}\x1b[22m  ${body}`;
  }
  return `${body}\r\n`;
}

interface MatchInfo {
  index: number;
  count: number;
}

interface Props {
  /** Lines to render. Parent applies any filter / sort before passing
   *  them in — the view treats this array as the source of truth and
   *  reconciles the xterm buffer to match. */
  lines: LogLine[];
  /** Total unfiltered line count, used to disambiguate the empty state
   *  ("no logs yet" vs "filter has zero matches"). */
  totalLogs: number;
  /** Prefix every line with `YYYY-MM-DD HH:MM:SS`. Toggling forces a
   *  full rewrite — the timestamps are baked into the buffer, not
   *  rendered as a separate column. */
  showTimestamp: boolean;
  /** Auto-scroll to the bottom as new lines arrive AND when the prop
   *  itself flips on. Off ⇒ user can scroll back to read older output
   *  without xterm yanking them back. */
  follow: boolean;
  /** Theme switch — flips between the VS Code Dark+ / Light+ palettes
   *  in place without a full rewrite (the cells keep their SGR codes,
   *  only the palette mapping changes). */
  isDark: boolean;
  /** Right-click on a meaningful line. Whitespace-only rows are
   *  filtered out *inside* the view (they're not useful triage
   *  context), so the host can assume `lines[index]` is non-empty. */
  onLineContextMenu: (index: number) => void;
}

/**
 * Headless xterm.js view that replaces the legacy `react-virtual` +
 * `ansi-to-html` log list. The component is intentionally "dumb" about
 * filtering / following / cmd-switching policy — those decisions still
 * live in `LogPanel`, which feeds the already-curated `lines` array
 * here. The view only:
 *
 *   - mounts a single xterm instance for its lifetime
 *   - reconciles the buffer against `lines` via longest-common-prefix
 *     (cheap append on new tail, full rewrite on any divergence)
 *   - tracks one `IMarker` per logical line so right-click ↔ line index
 *     is unambiguous even when long lines wrap across multiple visual
 *     rows
 *   - surfaces an empty-state overlay so "no logs / no matches" still
 *     reads like prose instead of a blank dark void
 *
 * Per-LogPanel state (cmd switch, theme, filter, follow toggle, …)
 * stays in the parent so behaviour and tests written against the
 * original LogPanel shape continue to apply.
 */
export function LogXtermView({
  lines,
  totalLogs,
  showTimestamp,
  follow,
  isDark,
  onLineContextMenu,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  /** Markers anchored to the *first* row of each rendered line. Walking
   *  this array backwards on right-click maps a click Y back to a
   *  LogLine index in O(N) (fast in practice — the click is almost
   *  always near the latest line). */
  const markersRef = useRef<IMarker[]>([]);
  /** seq numbers we've already written, in order. Used for
   *  longest-common-prefix reconciliation — see the main effect. */
  const writtenSeqsRef = useRef<number[]>([]);
  /** Last formatting state we rendered with. Toggling `showTimestamp`
   *  forces a wipe because timestamps are baked into the cells, not
   *  overlaid as a column. */
  const formatStateRef = useRef({ showTimestamp });

  // Refs that capture the latest props without forcing the contextmenu
  // listener to re-attach on every render. The DOM listener is set
  // up once and reads through these.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const onLineContextMenuRef = useRef(onLineContextMenu);
  onLineContextMenuRef.current = onLineContextMenu;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);

  /** Run a search in `direction`. Same plumbing as `TerminalPane`'s
   *  search bar — the addon's results event drives the floating
   *  match counter. */
  const runSearch = useCallback((query: string, direction: 'next' | 'prev') => {
    const search = searchRef.current;
    if (!search || !query) return;
    const opts = { decorations: XTERM_SEARCH_DECORATIONS };
    if (direction === 'next') search.findNext(query, opts);
    else search.findPrevious(query, opts);
  }, []);

  const openSearch = useCallback(() => {
    const term = termRef.current;
    const selection = term?.getSelection() ?? '';
    if (selection) setSearchQuery(selection);
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setMatchInfo(null);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  // ── Mount: build xterm + addons exactly once. ────────────────────
  useEffect(() => {
    if (!termContainerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'underline',
      // We never read user input — logs are a one-way feed. Disabling
      // stdin keeps accidental keystrokes (Cmd+A, paste, etc.) from
      // being interpreted as terminal input.
      disableStdin: true,
      fontSize: 12.5,
      fontFamily: FONT_STACK,
      letterSpacing: 0,
      lineHeight: 1.35,
      // Matches the backend ring buffer cap so a freshly mounted view
      // can replay every line the store currently holds without xterm
      // discarding the head as we write.
      scrollback: 10_000,
      allowProposedApi: true,
      allowTransparency: false,
      theme: xtermTheme(isDark),
    });
    termRef.current = term;

    const unicodeAddon = new Unicode11Addon();
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    // Web links — turn http(s) URLs into clickable regions. The default
    // handler navigates the *current* webview, which would replace
    // RunHQ with the target page (catastrophic). Route through
    // `ipc.openUrl` so links open in the OS browser instead.
    const webLinks = new WebLinksAddon((event, url) => {
      event.preventDefault();
      void ipc.openUrl(url).catch((err: unknown) => {
        console.warn('openUrl failed', err);
      });
    });
    term.loadAddon(webLinks);

    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    const resultsDisposable = search.onDidChangeResults((event) => {
      if (!event || event.resultCount === 0 || event.resultIndex < 0) {
        setMatchInfo(null);
      } else {
        setMatchInfo({ index: event.resultIndex + 1, count: event.resultCount });
      }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    fitRef.current = fit;

    term.open(termContainerRef.current);

    // Cmd/Ctrl+F opens the search bar without falling through to the
    // shell (we have no shell here, but xterm would still consume the
    // keystroke for its own internal handling). Returning `false`
    // tells xterm "I've handled this".
    term.attachCustomKeyEventHandler((event) => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === 'f';
      if (isFindShortcut) {
        if (event.type === 'keydown') openSearch();
        return false;
      }
      return true;
    });

    // Right-click handler — translates the click position back to a
    // LogLine index by walking the marker array. We attach to the
    // outer container (not `term.element`) so the event survives even
    // if the user right-clicks on the scrollbar gutter, the search
    // bar's ghost edge, or anywhere inside the panel — feels less
    // fragile than sniping `.xterm-screen`.
    const containerEl = termContainerRef.current;
    const onContextMenu = (e: MouseEvent) => {
      const screen =
        (containerEl.querySelector('.xterm-screen') as HTMLElement | null) ?? containerEl;
      const rect = screen.getBoundingClientRect();
      // Clicks outside the rendered terminal grid (the search bar, the
      // surrounding chrome) are not meaningful — fall through to the
      // browser default rather than swallow the gesture.
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return;
      }
      const t = termRef.current;
      if (!t || rect.height <= 0) return;
      const localY = e.clientY - rect.top;
      const cellHeight = rect.height / Math.max(1, t.rows);
      const localRow = Math.floor(localY / cellHeight);
      if (localRow < 0 || localRow >= t.rows) return;
      const absY = t.buffer.active.viewportY + localRow;
      const idx = findLineIndexAtY(markersRef.current, absY);
      if (idx === -1) return;
      const candidate = linesRef.current[idx];
      // Skip blank rows — they're cosmetic spacers (Vite's port-retry
      // gap, pnpm's pre-banner padding, …) and triaging them adds
      // confusion without adding signal.
      if (!candidate || candidate.text.trim() === '') return;
      e.preventDefault();
      e.stopPropagation();
      onLineContextMenuRef.current(idx);
    };
    containerEl.addEventListener('contextmenu', onContextMenu);

    let alive = true;
    let resizeRaf = 0;

    const flushResize = () => {
      resizeRaf = 0;
      if (!alive) return;
      try {
        fit.fit();
      } catch {
        // `fit.fit()` throws if the container is zero-height (panel
        // collapsed mid-teardown). Swallow — the next live resize
        // will recompute correctly once dimensions return.
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (!alive) return;
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(flushResize);
    });
    resizeObserver.observe(termContainerRef.current);

    // First fit needs to be deferred until after layout so the
    // measured size isn't a pre-mount zero. RAF is enough; xterm's
    // own measurement runs on the same paint cycle.
    requestAnimationFrame(() => {
      if (!alive) return;
      try {
        fit.fit();
      } catch {
        // Same swallow as above.
      }
    });

    return () => {
      alive = false;
      termRef.current = null;
      searchRef.current = null;
      fitRef.current = null;
      resultsDisposable.dispose();
      if (resizeRaf !== 0) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      resizeObserver.disconnect();
      containerEl.removeEventListener('contextmenu', onContextMenu);
      // Clear marker handles before disposing the terminal — markers
      // hold references into the buffer, and disposing them after the
      // terminal would log a benign (but noisy) warning.
      for (const m of markersRef.current) {
        if (!m.isDisposed) m.dispose();
      }
      markersRef.current = [];
      writtenSeqsRef.current = [];
      term.dispose();
    };
    // `isDark` and `openSearch` are intentionally excluded:
    //   - `isDark`: read once at mount to seed the theme; the dedicated
    //     theme effect below mutates `term.options.theme` in place,
    //     keeping markers + scrollback intact across toggles.
    //   - `openSearch`: stable (useCallback with no deps), but the lint
    //     rule can't always prove it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Theme switch (in-place, no rewrite). ────────────────────────
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(isDark);
    }
  }, [isDark]);

  // ── Reconcile content. Append on extension, wipe on divergence. ──
  //
  // The reconciler explicitly handles four shapes the input can take:
  //
  //   1. Pure append — `lines` is the previous frame plus N new entries
  //      at the tail. We write only the delta. Most common case.
  //   2. Ring-buffer overflow — backend evicts the oldest entries; the
  //      array slides "left" while still gaining new tail entries. We
  //      treat the head as already off-screen in xterm's scrollback
  //      (the cap matches the backend's) and just append the tail.
  //   3. Filter / cmd toggle — the array shape changes arbitrarily.
  //      Wipe + rewrite. Fortunately rare (user gesture, not data).
  //   4. Format toggle — `showTimestamp` baked into cells, so flipping
  //      it forces a full rewrite. Also rare.
  //
  // The `lastWrittenSeq` + `firstWrittenSeq` two-point check is enough
  // to disambiguate (1)/(2) from (3) without scanning every seq —
  // monotonic seq numbers + a single boundary check uniquely identify
  // a contiguous slice. That keeps the per-update cost O(K) where K
  // is the size of the new tail, not O(N) where N is the buffer.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const formatChanged = formatStateRef.current.showTimestamp !== showTimestamp;
    const written = writtenSeqsRef.current;

    const wipeAndRewrite = () => {
      for (const m of markersRef.current) {
        if (!m.isDisposed) m.dispose();
      }
      markersRef.current = [];
      term.reset();
      // `reset()` can briefly drop the cursor accent on some xterm
      // versions; re-applying the theme is a cheap belt-and-braces
      // measure that keeps the palette stable.
      term.options.theme = xtermTheme(isDark);
      for (const line of lines) {
        appendLineWithMarker(term, line, markersRef.current, { showTimestamp });
      }
      writtenSeqsRef.current = lines.map((l) => l.seq);
      formatStateRef.current = { showTimestamp };
    };

    const appendTail = (fromIndex: number) => {
      for (let i = fromIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        appendLineWithMarker(term, line, markersRef.current, { showTimestamp });
      }
      writtenSeqsRef.current = lines.map((l) => l.seq);
      formatStateRef.current = { showTimestamp };
    };

    if (formatChanged) {
      wipeAndRewrite();
    } else if (lines.length === 0) {
      if (written.length > 0) {
        for (const m of markersRef.current) {
          if (!m.isDisposed) m.dispose();
        }
        markersRef.current = [];
        term.reset();
        term.options.theme = xtermTheme(isDark);
        writtenSeqsRef.current = [];
        formatStateRef.current = { showTimestamp };
      }
    } else if (written.length === 0) {
      // Initial mount or post-wipe — just write everything.
      appendTail(0);
    } else {
      // Walk from the end — for the common "append" case the last
      // seq we wrote is at or near `lines.length - 1`, so this exits
      // in O(1). For ring-overflow it exits in O(eviction_delta).
      // Worst case is a wipe candidate, where it walks the full
      // array (O(N)) — still fast for N ≤ 10K.
      const lastWrittenSeq = written[written.length - 1]!;
      let lastIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.seq === lastWrittenSeq) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx === -1) {
        // Our last write is no longer in the array — filter narrowed
        // past it, or the buffer slid completely past. Wipe.
        wipeAndRewrite();
      } else {
        const offset = lastIdx - (written.length - 1);
        // Two structural rejections that don't need an interior scan:
        //   - `offset > 0`: `lines` extends *before* our written head
        //     (a filter widened, exposing seqs we never wrote). xterm
        //     would be missing those entries.
        //   - `offset < 0` AND `lines.length < written.length`: a
        //     filter narrowed, dropping some tail entries we DID
        //     write. xterm still has them — wipe so the view aligns.
        const structurallyAppendable =
          !(offset > 0) && !(offset < 0 && lines.length < written.length);
        // Even when the structural shape allows an append, the
        // interior of `written` and `lines` could still differ — e.g.
        // an exotic filter swap that preserves the head + tail seqs
        // but changes a middle entry. Verify every overlapping
        // position. The cost is O(written.length) in the worst case
        // (matches the legacy LCP reconciler) and O(K) per append
        // when the buffer is steady at the cap (only the visible
        // portion needs checking).
        let aligned = structurallyAppendable;
        if (aligned) {
          const start = Math.max(0, -offset);
          for (let i = start; i < written.length; i++) {
            if (written[i] !== lines[i + offset]?.seq) {
              aligned = false;
              break;
            }
          }
        }
        if (aligned) {
          appendTail(lastIdx + 1);
        } else {
          wipeAndRewrite();
        }
      }
    }

    if (follow) {
      // After any append/wipe, re-pin to the bottom if follow is on.
      // `scrollToBottom` is cheap and a no-op when already at the end.
      term.scrollToBottom();
    }
    // `follow` is read here so the *current* value is honored after
    // every reconcile. The dedicated effect below also drives scroll
    // when `follow` itself flips standalone.
  }, [lines, showTimestamp, follow, isDark]);

  // ── Toggling follow ON should snap to bottom even with no new lines.
  useEffect(() => {
    if (follow) termRef.current?.scrollToBottom();
  }, [follow]);

  // ── Live search-as-you-type. Mirrors TerminalPane's bar. ─────────
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

  const showEmptyState = lines.length === 0;
  const emptyMessage =
    totalLogs === 0 ? 'No logs yet. Start the service to see output.' : 'No matches.';

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div ref={termContainerRef} className="h-full w-full" />
      {showEmptyState && (
        // Overlay covers the (intentionally still-mounted) xterm so the
        // user sees a sentence, not a black void. Mounted xterm means
        // the next non-empty `lines` array re-uses the existing
        // markers / scrollback — no remount cost on filter clear.
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center',
            'text-fg-dim text-[11px]',
          )}
          // Inline style (rather than a Tailwind arbitrary class) because
          // the bg hex is sourced from `xtermTheme.ts` — Tailwind's JIT
          // can't see values that arrive via template literal, and we
          // don't want the overlay color to drift from the xterm body
          // when the shared palette gets retuned.
          style={{ backgroundColor: isDark ? XTERM_DARK_BG : XTERM_LIGHT_BG }}
        >
          {emptyMessage}
        </div>
      )}
      {searchOpen && (
        <div
          className={cn(
            'border-border bg-surface-raised shadow-lg',
            'absolute top-2 right-3 z-10 flex items-center gap-1',
            'rounded-app-sm border px-1.5 py-1',
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={onSearchInputKeyDown}
            placeholder="Find in logs…"
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

/** Write one log line to xterm and capture an `IMarker` anchored to the
 *  *first* row of that line. The marker survives wrapping (long lines
 *  spanning multiple physical rows) and scrollback growth, so a
 *  right-click anywhere on the line maps unambiguously back to the
 *  LogLine index it came from.
 *
 *  We register the marker BEFORE the write so it captures the cursor's
 *  starting row. Writing first and using `registerMarker(-1)` would
 *  anchor to the *last* wrapped row, which would silently drop clicks
 *  that landed on earlier wrapped rows. */
function appendLineWithMarker(
  term: Terminal,
  line: LogLine,
  markers: IMarker[],
  opts: { showTimestamp: boolean },
): void {
  const marker = term.registerMarker(0);
  if (marker) markers.push(marker);
  term.write(formatLineBytes(line, opts));
}

/** Locate the LogLine index whose first row is closest-but-not-greater
 *  than `absY`. Walks backwards because right-click hot-spots tend to
 *  cluster near the latest output — typical case is O(1).
 *
 *  Disposed markers (lines that fell out of scrollback) are skipped
 *  rather than removed eagerly; pruning them on every right-click
 *  isn't worth the bookkeeping for a 10K-cap buffer. */
function findLineIndexAtY(markers: IMarker[], absY: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    if (!m || m.isDisposed) continue;
    if (m.line <= absY) return i;
  }
  return -1;
}
