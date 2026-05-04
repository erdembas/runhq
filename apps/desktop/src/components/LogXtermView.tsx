import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ipc } from '@/lib/ipc';
import { XTERM_SEARCH_DECORATIONS, xtermTheme } from '@/lib/xtermTheme';
import { LogXtermDetailTooltip } from '@/components/log-xterm/LogXtermDetailTooltip';
import { LogXtermEmptyState } from '@/components/log-xterm/LogXtermEmptyState';
import { LogXtermSearchBar, type MatchInfo } from '@/components/log-xterm/LogXtermSearchBar';
import { FONT_STACK, collectFailedDockerStepIds } from '@/components/log-xterm/format';
import { appendLineWithMarker } from '@/components/log-xterm/markers';
import { isInsideRect, lineIndexFromPointer } from '@/components/log-xterm/pointer';
import type { LogLine } from '@/types';

interface Props {
  commandName?: string | null;
  lines: LogLine[];
  totalLogs: number;
  showTimestamp: boolean;
  follow: boolean;
  isDark: boolean;
  onLineContextMenu: (index: number) => void;
  serviceId?: string | null;
}

export function LogXtermView({
  commandName,
  lines,
  totalLogs,
  showTimestamp,
  follow,
  isDark,
  onLineContextMenu,
  serviceId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const markersRef = useRef<IMarker[]>([]);
  const writtenSeqsRef = useRef<number[]>([]);
  const formatStateRef = useRef({ failedDockerStepKey: '', showTimestamp });
  const lastPtySizeRef = useRef('');

  const linesRef = useRef(lines);
  linesRef.current = lines;
  const onLineContextMenuRef = useRef(onLineContextMenu);
  onLineContextMenuRef.current = onLineContextMenu;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [detailTooltip, setDetailTooltip] = useState<{
    detail: string;
    left: number;
    title: string;
    top: number;
  } | null>(null);

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

  useEffect(() => {
    if (!termContainerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'underline',
      disableStdin: true,
      fontSize: 14,
      fontFamily: FONT_STACK,
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

    const syncServicePtySize = () => {
      if (!serviceId || !commandName || term.cols <= 0 || term.rows <= 0) return;
      const next = `${term.cols}x${term.rows}`;
      if (lastPtySizeRef.current === next) return;
      lastPtySizeRef.current = next;
      void ipc
        .resizeServiceLogPty(serviceId, commandName, term.cols, term.rows)
        .catch((err: unknown) => {
          console.warn('resizeServiceLogPty failed', err);
        });
    };

    term.attachCustomKeyEventHandler((event) => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === 'f';
      if (isFindShortcut) {
        if (event.type === 'keydown') openSearch();
        return false;
      }
      return true;
    });

    const containerEl = termContainerRef.current;
    const screenForPointer = () =>
      (containerEl.querySelector('.xterm-screen') as HTMLElement | null) ?? containerEl;

    const lineIndexForEvent = (event: MouseEvent): number => {
      const screen = screenForPointer();
      const rect = screen.getBoundingClientRect();
      if (!isInsideRect(rect, event.clientX, event.clientY)) return -1;
      const t = termRef.current;
      if (!t) return -1;
      return lineIndexFromPointer(t, markersRef.current, rect, event.clientY);
    };

    const onContextMenu = (e: MouseEvent) => {
      const idx = lineIndexForEvent(e);
      if (idx === -1) return;
      const candidate = linesRef.current[idx];
      if (!candidate || candidate.text.trim() === '') return;
      e.preventDefault();
      e.stopPropagation();
      onLineContextMenuRef.current(idx);
    };

    const onMouseMove = (event: MouseEvent) => {
      const idx = lineIndexForEvent(event);
      const candidate = idx === -1 ? null : linesRef.current[idx];
      const detail = candidate?.detail?.trim();
      if (!candidate || !detail) {
        setDetailTooltip(null);
        return;
      }

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      const tooltipWidth = Math.min(560, Math.max(280, containerRect.width - 24));
      const left = Math.min(
        Math.max(12, event.clientX - containerRect.left + 14),
        Math.max(12, containerRect.width - tooltipWidth - 12),
      );
      const top = Math.min(
        Math.max(12, event.clientY - containerRect.top + 16),
        Math.max(12, containerRect.height - 280),
      );
      setDetailTooltip({
        detail,
        left,
        title: candidate.text.replace(/^\s*ℹ\s*/, ''),
        top,
      });
    };

    const onMouseLeave = () => setDetailTooltip(null);

    containerEl.addEventListener('contextmenu', onContextMenu);
    containerEl.addEventListener('mousemove', onMouseMove);
    containerEl.addEventListener('mouseleave', onMouseLeave);

    let alive = true;
    let resizeRaf = 0;

    const flushResize = () => {
      resizeRaf = 0;
      if (!alive) return;
      try {
        fit.fit();
        syncServicePtySize();
      } catch {
        // xterm can reject a fit while the pane is hidden or has zero dimensions.
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (!alive) return;
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(flushResize);
    });
    resizeObserver.observe(termContainerRef.current);

    requestAnimationFrame(() => {
      if (!alive) return;
      try {
        fit.fit();
        syncServicePtySize();
      } catch {
        // xterm can reject a fit while the pane is hidden or has zero dimensions.
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
      containerEl.removeEventListener('mousemove', onMouseMove);
      containerEl.removeEventListener('mouseleave', onMouseLeave);
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

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(isDark);
    }
  }, [isDark]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const failedDockerStepIds = collectFailedDockerStepIds(lines);
    const failedDockerStepKey = Array.from(failedDockerStepIds).sort().join('\x1f');
    const formatOptions = { failedDockerStepIds, showTimestamp };
    const formatChanged =
      formatStateRef.current.showTimestamp !== showTimestamp ||
      formatStateRef.current.failedDockerStepKey !== failedDockerStepKey;
    const written = writtenSeqsRef.current;

    const wipeAndRewrite = () => {
      for (const m of markersRef.current) {
        if (!m.isDisposed) m.dispose();
      }
      markersRef.current = [];
      term.reset();
      term.options.theme = xtermTheme(isDark);
      for (const line of lines) {
        appendLineWithMarker(term, line, markersRef.current, formatOptions);
      }
      writtenSeqsRef.current = lines.map((l) => l.seq);
      formatStateRef.current = { failedDockerStepKey, showTimestamp };
    };

    const appendTail = (fromIndex: number) => {
      for (let i = fromIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        appendLineWithMarker(term, line, markersRef.current, formatOptions);
      }
      writtenSeqsRef.current = lines.map((l) => l.seq);
      formatStateRef.current = { failedDockerStepKey, showTimestamp };
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
        formatStateRef.current = { failedDockerStepKey, showTimestamp };
      }
    } else if (written.length === 0) {
      appendTail(0);
    } else {
      const lastWrittenSeq = written[written.length - 1]!;
      let lastIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.seq === lastWrittenSeq) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx === -1) {
        wipeAndRewrite();
      } else {
        const offset = lastIdx - (written.length - 1);
        const structurallyAppendable =
          !(offset > 0) && !(offset < 0 && lines.length < written.length);
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
      term.scrollToBottom();
    }
  }, [lines, showTimestamp, follow, isDark]);

  useEffect(() => {
    if (follow) termRef.current?.scrollToBottom();
  }, [follow]);

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
      {showEmptyState && <LogXtermEmptyState isDark={isDark} message={emptyMessage} />}
      {detailTooltip && <LogXtermDetailTooltip {...detailTooltip} />}
      {searchOpen && (
        <LogXtermSearchBar
          inputRef={searchInputRef}
          matchInfo={matchInfo}
          query={searchQuery}
          onChange={setSearchQuery}
          onClose={closeSearch}
          onKeyDown={onSearchInputKeyDown}
          onNext={() => runSearch(searchQuery, 'next')}
          onPrev={() => runSearch(searchQuery, 'prev')}
        />
      )}
    </div>
  );
}
