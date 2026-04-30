import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * In-document search for the project DOCS renderer.
 *
 * Same UX contract as the existing terminal / log search bars:
 *
 *   • Cmd/Ctrl+F opens a floating search input (top-right of the
 *     scroller). If the user already had text selected inside the
 *     doc, it pre-fills the query — same gesture as Chrome / VS
 *     Code / iTerm.
 *   • Enter / Shift+Enter step through matches; the active match
 *     scrolls into view (centred) with a brighter highlight. The
 *     non-active matches stay visible at a softer tint so the
 *     user can spot context.
 *   • Esc closes the bar and clears every highlight.
 *   • The N/M counter (`3/12`) lives next to the input. When the
 *     query has zero matches we render a literal "no match"
 *     instead of `0/0`, matching what `LogXtermView` does.
 *
 * Why the CSS Custom Highlight API instead of `<mark>`s
 * -----------------------------------------------------
 * Wrapping every match in `<mark>` spans inside markdown rendered
 * by react-markdown is a footgun: it forces a re-mount of the
 * rendered tree on every keystroke (or, worse, drifts out of sync
 * with the React tree because we mutated DOM React thinks it
 * owns). It also breaks selection / link / image semantics around
 * partial matches — a match spanning two `<a>` tags suddenly
 * becomes three nodes, none of which a user can click.
 *
 * The CSS Custom Highlight API solves this cleanly: we register a
 * named highlight backed by a list of `Range` objects and the
 * browser paints it on top of the existing layout without
 * touching the DOM. React never knows, the markdown stays a
 * single source of truth, and we only pay layout costs (zero) +
 * paint costs (cheap).
 *
 * Supported in every webview Tauri 2 ships with:
 *   • macOS WKWebView — WebKit ≥17.2 (macOS Ventura 13.5+).
 *   • Windows WebView2 — Chromium ≥105 (every shipping Edge).
 *   • Linux WebKitGTK ≥2.40 (Ubuntu 22.10+, Fedora 38+, Debian 12+).
 *
 * For environments that lack the API entirely (vitest jsdom, very
 * old WebKitGTK on a stale LTS), the hook degrades gracefully:
 * search counts work and Enter/Shift+Enter still scroll to the
 * matched DOM element (we approximate via `scrollIntoView`), only
 * the visual highlight is missing. That is strictly better than
 * raising and refusing to render.
 */

/** Scoped to this module; namespaced names avoid clashing with
 *  any future highlight registration we add elsewhere. */
const HL_ALL = 'docs-search';
const HL_ACTIVE = 'docs-search-active';

interface MatchInfo {
  /** 1-indexed position of the active match for human display. */
  index: number;
  /** Total matches currently visible in the scroller. */
  count: number;
}

interface Options {
  /** The scroll container that hosts the rendered markdown. Search
   *  walks text nodes under this root only. */
  scrollerRef: React.RefObject<HTMLElement | null>;
  /**
   * The doc identity. When this changes (user clicks a different
   * sub-nav entry, the README is re-fetched), we clear the open
   * search state so a stale query isn't re-applied to fresh
   * markdown — the highlight ranges would point at detached
   * nodes and the active match scroll would jump to the wrong
   * place. The opaque-string contract lets the caller pick
   * whichever identifier makes sense (relative path, content
   * hash, …) without us caring.
   */
  contentKey: string;
}

interface Result {
  /** Whether the floating search bar is open. */
  isOpen: boolean;
  /** Query string (controlled — passed to the input). */
  query: string;
  /** Set the query (called from the input's onChange). */
  setQuery: (q: string) => void;
  /** N/M info or `null` when there are zero matches. */
  matchInfo: MatchInfo | null;
  /** Open the bar. Pre-fills with current selection when present. */
  open: () => void;
  /** Close the bar and drop every highlight. */
  close: () => void;
  /** Walk to the next / previous match (cycles). */
  step: (direction: 'next' | 'prev') => void;
  /** Wire onto the search input's onKeyDown. */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Ref the caller binds to its `<input>`. */
  inputRef: React.RefObject<HTMLInputElement>;
}

export function useDocsSearch({ scrollerRef, contentKey }: Options): Result {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The current set of ranges, kept in a ref so step() can move
  // between them without triggering a re-render and re-scan.
  // `ranges` is in document order; `activeIdx` indexes into it.
  const rangesRef = useRef<Range[]>([]);
  const activeIdxRef = useRef<number>(-1);

  // Bump on contentKey change so a stale `useEffect`-scheduled
  // search doesn't apply against re-rendered markdown.
  const epochRef = useRef(0);

  const clearHighlights = useCallback(() => {
    if (!supportsHighlights()) return;
    try {
      window.CSS.highlights?.delete(HL_ALL);
      window.CSS.highlights?.delete(HL_ACTIVE);
    } catch {
      // Some webviews throw when deleting an absent name — safe to
      // ignore, we only care that the highlight is gone.
    }
  }, []);

  const applyHighlights = useCallback(() => {
    if (!supportsHighlights()) return;
    const ranges = rangesRef.current;
    const activeIdx = activeIdxRef.current;
    try {
      if (ranges.length === 0) {
        window.CSS.highlights?.delete(HL_ALL);
        window.CSS.highlights?.delete(HL_ACTIVE);
        return;
      }
      const HighlightCtor = (
        window as unknown as { Highlight: new (...args: Range[]) => Highlight }
      ).Highlight;
      const inactive = ranges.filter((_, i) => i !== activeIdx);
      const all = new HighlightCtor(...inactive);
      window.CSS.highlights?.set(HL_ALL, all);
      if (activeIdx >= 0 && activeIdx < ranges.length) {
        const active = new HighlightCtor(ranges[activeIdx]!);
        window.CSS.highlights?.set(HL_ACTIVE, active);
      } else {
        window.CSS.highlights?.delete(HL_ACTIVE);
      }
    } catch (err) {
      console.warn('docs-search: highlight apply failed', err);
    }
  }, []);

  /**
   * Scan the scroller for `query` matches and rebuild
   * `rangesRef`. Case-insensitive by default — README content is
   * authored prose and case-sensitive search trips up users
   * (`fetch` vs `Fetch`). Matches don't span text nodes (a single
   * match must live inside a single text node) — that's an
   * acceptable limitation in practice because react-markdown
   * doesn't fragment whole words, and it lets us avoid the very
   * thorny "build a normalised text + reverse map" approach that
   * a naive Find-in-Page would otherwise need.
   */
  const scan = useCallback(
    (q: string): { ranges: Range[]; epoch: number } => {
      const root = scrollerRef.current;
      const epoch = epochRef.current;
      if (!root || !q) return { ranges: [], epoch };

      const ranges: Range[] = [];
      const lowerQuery = q.toLowerCase();
      // Cap to keep a runaway query (`a` on a 1 MB doc) from
      // freezing the UI for several hundred ms while we allocate
      // tens of thousands of Range objects. 5 000 matches is far
      // beyond what a human can navigate — past that, narrow the
      // query.
      const MAX_MATCHES = 5_000;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          // Skip text inside the floating search bar itself —
          // searching for "find" shouldn't highlight the
          // placeholder or counter.
          let p: Node | null = node.parentNode;
          while (p && p instanceof HTMLElement) {
            if (p.dataset?.docsSearchUi === 'true') return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let total = 0;
      let current: Node | null = walker.nextNode();
      while (current) {
        const text = current.nodeValue ?? '';
        if (text.length > 0) {
          const lower = text.toLowerCase();
          let from = 0;
          while (from < lower.length) {
            const at = lower.indexOf(lowerQuery, from);
            if (at < 0) break;
            const range = document.createRange();
            range.setStart(current, at);
            range.setEnd(current, at + q.length);
            ranges.push(range);
            total += 1;
            if (total >= MAX_MATCHES) {
              return { ranges, epoch };
            }
            from = at + Math.max(1, q.length);
          }
        }
        current = walker.nextNode();
      }
      return { ranges, epoch };
    },
    [scrollerRef],
  );

  const scrollActiveIntoView = useCallback(() => {
    const ranges = rangesRef.current;
    const idx = activeIdxRef.current;
    if (idx < 0 || idx >= ranges.length) return;
    const range = ranges[idx]!;
    const node = range.startContainer.parentElement;
    if (!node) return;
    // Only scroll when the match is actually off-screen — a
    // useful nicety for a freshly-pressed Enter that lands on a
    // match already in view (don't twitch the page).
    const root = scrollerRef.current;
    if (root) {
      const rRect = range.getBoundingClientRect();
      const sRect = root.getBoundingClientRect();
      const visible = rRect.top >= sRect.top + 16 && rRect.bottom <= sRect.bottom - 16;
      if (visible) return;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollerRef]);

  /** Re-scan whenever the query (or content) changes. Empty
   *  query drops the highlight without touching activeIdx so a
   *  user clearing + retyping doesn't lose their place if the new
   *  query has matches around the same position. */
  useEffect(() => {
    if (!isOpen) return;
    if (!query) {
      rangesRef.current = [];
      activeIdxRef.current = -1;
      setMatchInfo(null);
      clearHighlights();
      return;
    }
    const { ranges, epoch } = scan(query);
    if (epoch !== epochRef.current) return; // stale (content swapped under us)
    rangesRef.current = ranges;
    if (ranges.length === 0) {
      activeIdxRef.current = -1;
      setMatchInfo(null);
      clearHighlights();
      return;
    }
    // Pick the first match below the current scroll position so
    // typing keeps the user roughly where they were instead of
    // teleporting to the top.
    const root = scrollerRef.current;
    let chosen = 0;
    if (root) {
      const sTop = root.getBoundingClientRect().top;
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]!.getBoundingClientRect();
        if (r.top >= sTop - 1) {
          chosen = i;
          break;
        }
      }
    }
    activeIdxRef.current = chosen;
    setMatchInfo({ index: chosen + 1, count: ranges.length });
    applyHighlights();
    scrollActiveIntoView();
  }, [isOpen, query, scan, applyHighlights, clearHighlights, scrollActiveIntoView, scrollerRef]);

  /** Reset state when the doc changes. */
  useEffect(() => {
    epochRef.current += 1;
    rangesRef.current = [];
    activeIdxRef.current = -1;
    setMatchInfo(null);
    clearHighlights();
    // We deliberately leave `isOpen` and `query` alone — the user
    // may want to keep searching the new doc with the same
    // query (jumping between README and CHANGELOG looking for
    // "0.10.0", say). The next render's `useEffect` above will
    // re-scan against the new content.
  }, [contentKey, clearHighlights]);

  /** Tear down highlights on unmount so they don't leak across
   *  service-tab swaps. */
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  const open = useCallback(() => {
    setIsOpen(true);
    // Pre-fill from the user's current selection inside the
    // scroller. Ignore selections that span container nodes
    // (those are typically accidental triple-clicks that pull in
    // an entire paragraph of text).
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const txt = sel.toString().trim();
      if (txt && txt.length <= 80) setQuery(txt);
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setMatchInfo(null);
    clearHighlights();
    rangesRef.current = [];
    activeIdxRef.current = -1;
  }, [clearHighlights]);

  const step = useCallback(
    (direction: 'next' | 'prev') => {
      const ranges = rangesRef.current;
      if (ranges.length === 0) return;
      let idx = activeIdxRef.current;
      idx = direction === 'next' ? idx + 1 : idx - 1;
      // Cyclic — same behaviour as iTerm and Chrome.
      if (idx < 0) idx = ranges.length - 1;
      if (idx >= ranges.length) idx = 0;
      activeIdxRef.current = idx;
      setMatchInfo({ index: idx + 1, count: ranges.length });
      applyHighlights();
      scrollActiveIntoView();
    },
    [applyHighlights, scrollActiveIntoView],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        step(e.shiftKey ? 'prev' : 'next');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [step, close],
  );

  return useMemo(
    () => ({
      isOpen,
      query,
      setQuery,
      matchInfo,
      open,
      close,
      step,
      onInputKeyDown,
      inputRef,
    }),
    [isOpen, query, matchInfo, open, close, step, onInputKeyDown],
  );
}

function supportsHighlights(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.CSS !== 'undefined' &&
    typeof window.CSS.highlights !== 'undefined' &&
    typeof (window as unknown as { Highlight?: unknown }).Highlight === 'function'
  );
}
