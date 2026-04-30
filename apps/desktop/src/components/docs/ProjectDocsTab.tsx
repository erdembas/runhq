import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertTriangle,
  BookOpen,
  FileText,
  History,
  Layers,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldCheck,
  StretchHorizontal,
  Users,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { COMPACT_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { DocImage } from '@/components/docs/DocImage';
import { DocsSearchBar } from '@/components/docs/DocsSearchBar';
import { RunnableCodeBlock } from '@/components/docs/RunnableCodeBlock';
import { DOCS_SANITIZE_SCHEMA } from '@/lib/docs/sanitizeSchema';
import { useDocsSearch } from '@/lib/docs/useDocsSearch';
import { extractMarkdownText, findCodeChild } from '@/lib/markdownText';
import type { DocContent, DocKind, ProjectDoc } from '@/types';

interface Props {
  serviceId: string;
  /** Service cwd — surfaced as a path crumb above the doc body. */
  cwd: string;
  /**
   * Called when the user clicks "Run" on a fenced shell block. The
   * host opens the integrated terminal pane, then writes the
   * command + carriage return through `ipc.terminalWrite`. This
   * panel is intentionally kept ignorant of the terminal lifecycle
   * so it can also be used in contexts (e.g. the dashboard's
   * service drawer) where there's no terminal at all.
   */
  onRunCommand: (command: string) => void;
}

const KIND_META: Record<DocKind, { icon: React.ReactNode; label: string; order: number }> = {
  readme: { icon: <BookOpen className="h-3 w-3" />, label: 'README', order: 0 },
  changelog: { icon: <History className="h-3 w-3" />, label: 'Changelog', order: 1 },
  contributing: { icon: <Users className="h-3 w-3" />, label: 'Contributing', order: 2 },
  architecture: { icon: <Layers className="h-3 w-3" />, label: 'Architecture', order: 3 },
  doc: { icon: <FileText className="h-3 w-3" />, label: 'Doc', order: 4 },
  other: { icon: <ScrollText className="h-3 w-3" />, label: 'Doc', order: 5 },
  license: { icon: <Scale className="h-3 w-3" />, label: 'License', order: 6 },
};

/**
 * Renders a project's documentation set inside a tab that sits
 * alongside LOGS in the main panel.
 *
 * Layout:
 *   ┌─────────┬──────────────────────────────────────────────┐
 *   │ sub-nav │ doc body (Markdown)                          │
 *   │ (≤220)  │   ──────────                                 │
 *   │         │   sticky meta strip (path · edited · refresh)│
 *   │         │   ──────────                                 │
 *   │         │   prose                                      │
 *   │         │                                              │
 *   │         │                       ┌─────────┐            │
 *   │         │                       │  ToC    │ (sticky)   │
 *   │         │                       └─────────┘            │
 *   └─────────┴──────────────────────────────────────────────┘
 *
 * The sub-nav and the ToC are only rendered when they have
 * content — a one-doc project (just README, no docs/) collapses
 * naturally to a single column, and a doc with two headings
 * doesn't show the ToC at all (it would be visual noise).
 */
export function ProjectDocsTab({ serviceId, cwd, onRunCommand }: Props) {
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Discovery (per-service) -------------------------------------------
  //
  // Re-fetching on serviceId change keeps each open service tab in
  // sync with its own project. We do NOT trigger a re-discovery on
  // every tab switch — the docs list is stable until the on-disk
  // structure changes, and discovery runs `read_dir` per-candidate,
  // which is cheap but not free.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setContent(null);
    setActivePath(null);
    setDocs([]);
    ipc
      .discoverProjectDocs(serviceId)
      .then((list) => {
        if (!alive) return;
        const sorted = sortDocs(list);
        setDocs(sorted);
        if (sorted.length === 0) {
          setLoading(false);
        } else {
          setActivePath(sorted[0]!.relative_path);
        }
      })
      .catch((err) => {
        if (!alive) return;
        console.error('docs: discover failed', err);
        setError(String(err));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serviceId]);

  // ---- Read selected doc --------------------------------------------------
  //
  // Driven by `activePath`. Resets `content` synchronously on
  // change so a fast click sequence (README → CHANGELOG) can't
  // briefly render the README's body under the CHANGELOG title.
  useEffect(() => {
    if (!activePath) {
      setContent(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setContent(null);
    ipc
      .readProjectDoc(serviceId, activePath)
      .then((doc) => {
        if (!alive) return;
        setContent(doc);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('docs: read failed', err);
        setError(String(err));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, activePath]);

  const refresh = useCallback(() => {
    if (!activePath) return;
    setLoading(true);
    ipc
      .readProjectDoc(serviceId, activePath)
      .then((doc) => {
        setContent(doc);
        setLoading(false);
      })
      .catch((err) => {
        console.error('docs: refresh failed', err);
        setError(String(err));
        setLoading(false);
      });
  }, [serviceId, activePath]);

  // ---- Render -------------------------------------------------------------

  if (!loading && !error && docs.length === 0) {
    return <DocsEmptyState cwd={cwd} />;
  }

  const showSubNav = docs.length > 1;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {showSubNav && (
        <aside className="border-border/60 bg-surface-raised w-[220px] shrink-0 overflow-y-auto border-r">
          <DocsSubNav docs={docs} activePath={activePath} onSelect={setActivePath} />
        </aside>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <DocBody
          serviceId={serviceId}
          content={content}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onRunCommand={onRunCommand}
          onSelectDoc={setActivePath}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — surfaced when discovery returns zero results. We
// keep it minimal: the user knows their project. The point is to
// give them a graceful fallback without nagging them to write a
// README.
// ---------------------------------------------------------------------------

function DocsEmptyState({ cwd }: { cwd: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="border-border/40 bg-surface-muted/40 max-w-md rounded-lg border px-6 py-8 text-center">
        <BookOpen className="text-fg-dim mx-auto mb-3 h-8 w-8" />
        <h3 className="text-fg text-[14px] font-semibold">No documentation found</h3>
        <p className="text-fg-dim mt-2 text-[12.5px] leading-relaxed">
          RunHQ looked for{' '}
          <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">README.md</code>,{' '}
          <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">CHANGELOG.md</code>,
          and a <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">docs/</code>{' '}
          directory inside this project.
        </p>
        <code className="text-fg-dim/80 mt-3 block truncate font-mono text-[11px]">{cwd}</code>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-navigation. Groups docs by kind so a project with twenty
// `docs/**` files still has the README / CHANGELOG / etc. surfaced
// as discrete entries above the long list.
// ---------------------------------------------------------------------------

interface SubNavProps {
  docs: ProjectDoc[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

function DocsSubNav({ docs, activePath, onSelect }: SubNavProps) {
  // Group: top-level docs (README, CHANGELOG, etc.) first, then
  // docs/** entries under a "Docs" header.
  const topLevel = docs.filter((d) => d.kind !== 'doc');
  const tree = docs.filter((d) => d.kind === 'doc');

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {topLevel.map((d) => (
        <SubNavButton
          key={d.relative_path}
          doc={d}
          active={activePath === d.relative_path}
          onSelect={onSelect}
        />
      ))}
      {tree.length > 0 && (
        <>
          <div className="text-fg-dim mt-3 mb-1 px-2 text-[10px] font-semibold tracking-wider uppercase">
            Docs
          </div>
          {tree.map((d) => (
            <SubNavButton
              key={d.relative_path}
              doc={d}
              active={activePath === d.relative_path}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </nav>
  );
}

function SubNavButton({
  doc,
  active,
  onSelect,
}: {
  doc: ProjectDoc;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const meta = KIND_META[doc.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect(doc.relative_path)}
      title={doc.relative_path}
      className={cn(
        'group flex items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-fg-dim')}>{meta.icon}</span>
      <span className="min-w-0 flex-1 truncate">{doc.display_name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Doc body. Renders the markdown plus a sticky meta strip with the
// path crumb, last-modified, and a manual refresh button.
// ---------------------------------------------------------------------------

const WIDE_LAYOUT_STORAGE_KEY = 'runhq.docs.wideLayout';

/**
 * Persist the user's "wide / centred" preference across sessions.
 *
 * Project docs default to a 3xl-wide centred column because that's
 * the readability sweet spot for prose — measure-line theory puts
 * comfortable English text at ~70 characters, which lands close to
 * 768 px at our font size. But ultra-wide monitors and READMEs
 * heavy on tables / wide code blocks suffer in that column: the
 * user is left scrolling horizontally inside a code block while
 * acres of side gutter sit empty. Hence the toggle.
 *
 * Preference is global (one bool in localStorage rather than
 * per-service or per-doc) — once a user decides "I want wide", they
 * almost certainly want it for every project they open. SSR / Tauri
 * pre-render safety: the function form of `useState` and a guarded
 * read keep this from throwing if `localStorage` is somehow
 * unavailable (private mode, sandboxed iframe, etc.).
 */
function useWideLayoutPref(): [boolean, () => void] {
  const [wide, setWide] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WIDE_LAYOUT_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setWide((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(WIDE_LAYOUT_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore — preference just won't persist this session
      }
      return next;
    });
  }, []);
  return [wide, toggle];
}

interface DocBodyProps {
  serviceId: string;
  content: DocContent | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRunCommand: (command: string) => void;
  onSelectDoc: (path: string) => void;
}

function DocBody({
  serviceId,
  content,
  loading,
  error,
  onRefresh,
  onRunCommand,
  onSelectDoc,
}: DocBodyProps) {
  const [wide, toggleWide] = useWideLayoutPref();
  // Slightly delay the spinner so a fast IPC round-trip (typical:
  // ~10ms for a 30 KB README) doesn't flicker a "Loading…" frame
  // between content swaps. Empirically this is the difference
  // between "snappy" and "weirdly twitchy" when clicking through
  // sub-nav entries quickly.
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSpinner(false);
      return;
    }
    const t = window.setTimeout(() => setShowSpinner(true), 200);
    return () => window.clearTimeout(t);
  }, [loading]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="border-status-error/40 bg-status-error/10 text-status-error max-w-md rounded-lg border px-4 py-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Couldn't load this doc</span>
          </div>
          <code className="text-fg-dim block font-mono text-[11px]">{error}</code>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
        {showSpinner ? 'Loading…' : ''}
      </div>
    );
  }

  return (
    <>
      <div className="border-border/60 bg-surface-raised text-fg-dim sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b px-5 py-1.5 text-[10.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3 w-3 shrink-0" />
          <code className="text-fg-muted truncate font-mono text-[11px]">
            {content.relative_path}
          </code>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatBytes(content.size_bytes)}</span>
          {content.last_modified_ms > 0 && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0" title={new Date(content.last_modified_ms).toString()}>
                edited {formatRelative(content.last_modified_ms)}
              </span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleWide}
            title={wide ? 'Switch to centred reading column' : 'Use the full available width'}
            aria-pressed={wide}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors',
              wide ? 'bg-accent/15 text-accent' : 'hover:bg-accent/10 hover:text-accent',
            )}
          >
            <StretchHorizontal className="h-3 w-3" />
            <span>Wide</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            title="Re-read this doc from disk"
            className="hover:bg-accent/10 hover:text-accent inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <DocMarkdown
        key={content.relative_path}
        serviceId={serviceId}
        content={content}
        onRunCommand={onRunCommand}
        onSelectDoc={onSelectDoc}
        wide={wide}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer with the DOCS-specific overrides:
//   - Headings auto-anchor for ToC linking.
//   - Fenced code blocks gain copy / run actions.
//   - Images route through the IPC-backed `<DocImage>`.
//   - Internal `[link](./other.md)` re-targets the sub-nav.
// ---------------------------------------------------------------------------

interface MarkdownProps {
  serviceId: string;
  content: DocContent;
  onRunCommand: (command: string) => void;
  onSelectDoc: (path: string) => void;
  /**
   * When `true`, the article expands to fill the scroller width
   * (capped only by the surrounding container). Otherwise we render
   * the readability-tuned 3xl centred column. The toggle that drives
   * this is hosted in the meta strip above us; we just take the
   * boolean and apply it to the article container.
   */
  wide: boolean;
}

interface Heading {
  id: string;
  level: number;
  text: string;
}

function DocMarkdown({ serviceId, content, onRunCommand, onSelectDoc, wide }: MarkdownProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  // In-document search. Same UX contract as the LOGS / TERMINAL
  // search bars (Cmd/Ctrl+F to open, Enter / Shift+Enter to step,
  // Esc to close, N/M counter, prev/next chevrons). The hook owns
  // every detail of the highlight pipeline; the panel just hosts
  // the input and forwards the keyboard shortcut.
  const search = useDocsSearch({ scrollerRef, contentKey: content.relative_path });

  // Cmd+F (macOS) / Ctrl+F (Windows + Linux) opens the bar. We
  // attach a `keydown` listener on the scroller so the shortcut
  // doesn't fire while the user is typing in an unrelated input
  // elsewhere (notes panel, AI composer); markdown content
  // doesn't host inputs of its own, so a keypress that bubbles
  // up here is genuinely "user wants to find inside the doc".
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        // Only intercept when the docs surface is the active
        // viewport. Looking up the scroller's bounding rect is
        // cheap and reliably tells us whether the user is
        // currently looking at this surface — we don't want a
        // background DOCS panel to steal Cmd+F from the LOGS
        // panel that's actually on screen.
        const root = scrollerRef.current;
        if (!root) return;
        const isVisible = root.offsetParent !== null;
        if (!isVisible) return;
        e.preventDefault();
        search.open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search]);

  // Re-derive the ToC after each render. We can't compute it from
  // the raw markdown alone (we'd need a parser); reading the
  // rendered DOM after `useLayoutEffect` is cheap, exact, and lets
  // us share IDs with anchor links generated by the same DOM walk.
  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const collected: Heading[] = [];
    const used = new Set<string>();
    const elements = root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3');
    elements.forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      let id = slugify(text);
      let suffix = 1;
      while (used.has(id)) {
        id = `${slugify(text)}-${suffix++}`;
      }
      used.add(id);
      el.id = id;
      collected.push({
        id,
        level: parseInt(el.tagName.slice(1), 10),
        text,
      });
    });
    setHeadings(collected);
    setActiveHeading(collected[0]?.id ?? null);
  }, [content.markdown]);

  // Active-heading tracking via `IntersectionObserver`. The earlier
  // implementation used an `onScroll` handler that called
  // `getBoundingClientRect()` on every heading on every scroll event
  // — at 60–120 Hz with 50+ headings that's 3 000–6 000 layout reads
  // per second, and on a real-world README with prose / code blocks
  // / images the layout flushes pile up into visible scroll jank.
  //
  // IntersectionObserver eliminates the per-frame work entirely:
  // the browser only fires the callback when a heading crosses the
  // configured boundary, regardless of how fast the user is
  // scrolling. We use a `rootMargin` of `0px 0px -85% 0px` to
  // collapse the intersection zone to the top 15% of the scroller,
  // which gives the active-heading marker a "sticky" feel — a
  // heading remains active as the user scrolls through its
  // section, only handing off when the next heading enters that
  // top stripe.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const headingEls: HTMLElement[] = [];
    for (const h of headings) {
      const el = root.querySelector(`#${cssEscape(h.id)}`);
      if (el instanceof HTMLElement) headingEls.push(el);
    }
    if (headingEls.length === 0) return;

    // Track which headings are currently in the top stripe. We
    // store IDs in a `Set` and resolve "active" as the FIRST
    // intersecting heading in document order — when fast-scrolling
    // sweeps two headings into the stripe at once, this picks the
    // higher one (stable, predictable). Falling back to "previous
    // active" when none intersect prevents the marker from
    // briefly clearing as the user scrolls between adjacent
    // sections.
    const intersecting = new Set<string>();
    const idOrder = headings.map((h) => h.id);

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        for (const id of idOrder) {
          if (intersecting.has(id)) {
            setActiveHeading((prev) => (prev === id ? prev : id));
            return;
          }
        }
      },
      {
        root,
        rootMargin: '0px 0px -85% 0px',
        threshold: 0,
      },
    );
    for (const el of headingEls) obs.observe(el);
    return () => obs.disconnect();
  }, [headings]);

  const components = useMemo(
    () => ({
      ...COMPACT_MARKDOWN_COMPONENTS,
      h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1
          className="text-fg border-border/40 mt-2 mb-3 border-b pb-2 text-[18px] font-bold tracking-tight first:mt-0"
          {...props}
        />
      ),
      h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className="text-fg mt-5 mb-2 text-[15px] font-semibold first:mt-0" {...props} />
      ),
      h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className="text-fg mt-4 mb-1.5 text-[13.5px] font-semibold first:mt-0" {...props} />
      ),
      // Pass HTML attributes through. The shared compact map
      // strips them (correct for AI-emitted markdown where the
      // model can't author raw HTML); for project docs we MUST
      // preserve `align`, `class`, `id`, `style`, etc. so blocks
      // like `<p align="center"><img …></p>` actually render
      // centred. Sanitisation happens upstream in the rehype
      // pipeline — by the time props reach us the tree is already
      // safe to spread.
      p: ({ children, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className="mb-3 last:mb-0" {...rest}>
          {children}
        </p>
      ),
      div: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
      span: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
      // Collapsible sections — render as native <details>; the
      // browser ships the disclosure behaviour for free.
      details: (props: React.DetailsHTMLAttributes<HTMLDetailsElement>) => (
        <details
          className="border-border/50 bg-surface-muted/40 my-3 rounded-md border p-2"
          {...props}
        />
      ),
      summary: (props: React.HTMLAttributes<HTMLElement>) => (
        <summary
          className="text-fg cursor-pointer text-[12.5px] font-medium select-none"
          {...props}
        />
      ),
      // <picture>/<source> — preserve the responsive logo
      // pattern. The contained <img> still routes through our
      // IPC-backed override below.
      picture: (props: React.HTMLAttributes<HTMLElement>) => <picture {...props} />,
      figure: (props: React.HTMLAttributes<HTMLElement>) => <figure className="my-3" {...props} />,
      figcaption: (props: React.HTMLAttributes<HTMLElement>) => (
        <figcaption className="text-fg-dim mt-1 text-center text-[11px]" {...props} />
      ),
      a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (!href) {
          return <a {...rest}>{children}</a>;
        }
        if (href.startsWith('#')) {
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                const target = scrollerRef.current?.querySelector(href);
                if (target instanceof HTMLElement) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              className="text-accent hover:underline"
            >
              {children}
            </a>
          );
        }
        // Intra-doc links — `[Setup](./docs/setup.md)`. Resolve the
        // target relative to the current doc's base_dir and switch
        // sub-nav state instead of letting the webview try to
        // navigate to a `file://` URL it can't reach.
        if (
          /\.(md|mdx|markdown)$/i.test(href) &&
          !/^[a-z]+:\/\//i.test(href) &&
          !href.startsWith('mailto:')
        ) {
          const resolved = resolveDocLink(content.base_dir, href);
          return (
            <a
              href={`#doc:${resolved}`}
              onClick={(e) => {
                e.preventDefault();
                onSelectDoc(resolved);
              }}
              className="text-accent hover:underline"
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        );
      },
      img: (props: React.ImgHTMLAttributes<HTMLImageElement> & { align?: string }) => {
        const { src, alt, width, height, align } = props;
        return (
          <DocImage
            serviceId={serviceId}
            baseDir={content.base_dir}
            src={typeof src === 'string' ? src : undefined}
            alt={typeof alt === 'string' ? alt : undefined}
            width={typeof width === 'number' || typeof width === 'string' ? width : undefined}
            height={typeof height === 'number' || typeof height === 'string' ? height : undefined}
            align={typeof align === 'string' ? align : undefined}
          />
        );
      },
      // Fenced code blocks get the copy/run pill. Inline code is
      // left to the shared compact map. We discriminate the same
      // way `react-markdown` does: fenced blocks expose a
      // `language-*` className.
      code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
        const langMatch = (className ?? '').match(/language-([^\s]+)/);
        if (!langMatch) {
          return (
            <code className="bg-fg/10 text-fg rounded px-1 py-px font-mono text-[11px]" {...rest}>
              {children}
            </code>
          );
        }
        return (
          <code
            className={cn('text-fg block font-mono text-[12px]', className)}
            data-lang={langMatch[1]}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
        const codeEl = findCodeChild(children);
        if (!codeEl) {
          return (
            <pre className="bg-fg/5 border-border/40 mb-3 overflow-x-auto rounded border p-3 font-mono text-[12px]">
              {children}
            </pre>
          );
        }
        const language = codeEl.className?.toString().match(/language-([^\s]+)/)?.[1] ?? null;
        const raw = extractMarkdownText(codeEl.children).replace(/\n+$/, '');
        return (
          <RunnableCodeBlock language={language} raw={raw} onRun={onRunCommand}>
            {children}
          </RunnableCodeBlock>
        );
      },
    }),
    [serviceId, content.base_dir, onRunCommand, onSelectDoc],
  );

  const showToc = headings.length >= 3;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {search.isOpen && (
        <DocsSearchBar
          query={search.query}
          setQuery={search.setQuery}
          matchInfo={search.matchInfo}
          onStep={search.step}
          onClose={search.close}
          onInputKeyDown={search.onInputKeyDown}
          inputRef={search.inputRef}
        />
      )}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-8 py-6">
        <article
          className={cn(
            'text-fg/95 mx-auto text-[13px] leading-relaxed',
            // Wide mode: drop the readability cap so prose, tables,
            // and code blocks can use the entire scroller width
            // (the surrounding `px-8` already provides a comfortable
            // gutter on either side). Centred mode keeps the
            // ~768 px measure-line for prose-heavy READMEs.
            wide ? 'max-w-none' : 'max-w-3xl',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            // Order matters: `rehype-raw` parses the inline HTML
            // strings produced by remark into hast nodes; only
            // AFTER that does `rehype-sanitize` get a proper tree
            // to walk. Reversing the order would let raw HTML
            // strings slip through unchanged because the
            // sanitiser ignores text nodes. The schema (see
            // `DOCS_SANITIZE_SCHEMA`) is the single source of
            // truth for which tags / attributes / URL protocols
            // survive — adding a new permitted tag means editing
            // the schema, not bypassing the plugin.
            rehypePlugins={[rehypeRaw, [rehypeSanitize, DOCS_SANITIZE_SCHEMA]]}
            components={components}
          >
            {content.markdown}
          </ReactMarkdown>
        </article>
      </div>
      {showToc && (
        <aside className="border-border/40 hidden w-[200px] shrink-0 overflow-y-auto border-l py-4 pr-4 pl-3 lg:block">
          <Toc
            headings={headings}
            activeId={activeHeading}
            onSelect={(id) => {
              const target = scrollerRef.current?.querySelector(`#${cssEscape(id)}`);
              if (target instanceof HTMLElement) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          />
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky table of contents. Only renders when the doc has 3+
// headings (anything less just clutters the layout).
// ---------------------------------------------------------------------------

function Toc({
  headings,
  activeId,
  onSelect,
}: {
  headings: Heading[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="sticky top-2">
      <div className="text-fg-dim mb-2 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-wider uppercase">
        <ShieldCheck className="h-3 w-3" />
        On this page
      </div>
      <ul className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: (h.level - 1) * 8 }}>
            <button
              type="button"
              onClick={() => onSelect(h.id)}
              className={cn(
                'block w-full truncate rounded px-2 py-0.5 text-left text-[11.5px] transition-colors',
                activeId === h.id
                  ? 'text-accent bg-accent/10'
                  : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
              )}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---- Helpers --------------------------------------------------------------

function sortDocs(docs: ProjectDoc[]): ProjectDoc[] {
  return [...docs].sort((a, b) => {
    const oa = KIND_META[a.kind].order;
    const ob = KIND_META[b.kind].order;
    if (oa !== ob) return oa - ob;
    return a.relative_path.localeCompare(b.relative_path);
  });
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/[^\w-]/g, '\\$&');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function resolveDocLink(baseDir: string, href: string): string {
  // Drop hash fragment; we're navigating to a doc, the fragment
  // would only matter if we then auto-scroll to a heading inside
  // it (out of MVP scope).
  const cleaned = href.split('#')[0]!.split('?')[0]!;
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '');
  if (!baseDir) return cleaned.replace(/^\.\//, '');
  return joinForward(baseDir, cleaned);
}

function joinForward(base: string, rel: string): string {
  const parts = base.split('/').filter(Boolean);
  const segs = rel.split('/');
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      parts.pop();
    } else {
      parts.push(s);
    }
  }
  return parts.join('/');
}
