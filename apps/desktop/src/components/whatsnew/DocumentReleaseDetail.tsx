/**
 * Detail view for a `DocumentRelease` — the document-style layout used
 * from 0.10.0 onwards. Replaces the legacy carousel/stacked highlights
 * model with a scrollable long-form page (à la VS Code release notes /
 * Linear changelog):
 *
 *   ┌─────────┬────────────────────────────────┬─────────────┐
 *   │ Releases│ Header (version · date · tag)  │ IN THIS    │
 *   │  rail   │ Intro paragraph                │ RELEASE    │
 *   │         │ "In this release" hook list    │            │
 *   │         │                                │ Section A  │
 *   │         │ ── Section A ───────────────── │  · Sub 1   │
 *   │         │ ##### Subsection 1             │  · Sub 2   │ ← scroll
 *   │         │ Body prose, callouts, media…   │            │   spy
 *   │         │ ##### Subsection 2             │ Section B  │
 *   │         │ …                              │  · Sub 3   │
 *   │         │ ── Section B ───────────────── │            │
 *   │         │ Footer: changelog link         │            │
 *   └─────────┴────────────────────────────────┴─────────────┘
 *
 * The right-side TOC is co-located with the article so the in-page
 * navigation lives next to the content it indexes (rather than in the
 * outer aside, which is dedicated to release-to-release navigation).
 * Scroll-spy uses an `IntersectionObserver` against the page scroller
 * so the active TOC entry tracks whichever subsection is currently
 * under the reader's eye.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { DocumentRelease, HighlightBadge, ReleaseSection } from '@/lib/whatsnew/types';

const BADGE_TONE: Record<HighlightBadge, BadgeTone> = {
  new: 'accent',
  improved: 'info',
  fix: 'success',
};

const BADGE_LABEL: Record<HighlightBadge, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fixed',
};

/**
 * Tracks which subsection is "active" inside the given scroll container.
 *
 * Why a custom hook (rather than `:target` or hash-based highlighting):
 * we want the TOC to follow the *reading position*, not the last
 * clicked anchor. Hash highlighting goes stale the moment the user
 * scrolls past the linked heading. `IntersectionObserver` rebinds when
 * the version changes (so a release switch resets the spy targets) and
 * uses a top-weighted `rootMargin` so a section is "active" once its
 * heading clears the top quarter of the viewport — matching the way
 * VS Code / GitHub docs handle TOC sync.
 */
function useActiveSubsection(
  scrollerRef: RefObject<HTMLElement | null>,
  releaseVersion: string,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    // Defer slightly so the article DOM has had a chance to mount —
    // running the query synchronously here would observe an empty
    // tree on the very first render of a freshly-selected release.
    const raf = requestAnimationFrame(() => {
      const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-subsection-id]'));
      if (targets.length === 0) {
        setActiveId(null);
        return;
      }
      // Default to the first subsection so the TOC has a highlighted
      // entry even before the user scrolls — feels broken if nothing
      // is ever active.
      const firstTarget = targets[0];
      const initialId = firstTarget?.getAttribute('data-subsection-id');
      if (initialId) setActiveId(initialId);

      const obs = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .map((e) => ({
              id: e.target.getAttribute('data-subsection-id'),
              top: e.boundingClientRect.top,
            }))
            .filter((x): x is { id: string; top: number } => !!x.id);
          if (visible.length === 0) return;
          visible.sort((a, b) => a.top - b.top);
          const top = visible[0];
          if (top) setActiveId(top.id);
        },
        {
          root,
          // Treat a section as "active" once its top crosses the upper
          // quarter of the viewport. Bottom margin negative-trimmed so
          // sections aren't simultaneously active just because a sliver
          // remains visible at the page bottom.
          rootMargin: '-25% 0px -65% 0px',
          threshold: 0,
        },
      );
      targets.forEach((el) => obs.observe(el));
      return () => obs.disconnect();
    });
    return () => cancelAnimationFrame(raf);
    // releaseVersion in deps so a release change re-binds against the
    // freshly-rendered subsection elements (each release ships its own
    // set of ids).
  }, [scrollerRef, releaseVersion]);
  return activeId;
}

/**
 * Smooth-scroll the element with the given id into view inside the
 * page scroller. We use `scrollIntoView` on the element directly
 * (rather than `location.hash = '#id'`) so the URL doesn't change and
 * Tauri's webview doesn't try to "navigate" within the SPA — both of
 * which would otherwise interfere with the back/close affordances.
 */
function scrollToSubsection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function DocumentReleaseDetail({
  release,
  scrollerRef,
}: {
  release: DocumentRelease;
  scrollerRef: RefObject<HTMLElement | null>;
}) {
  const releasedDate = useMemo(() => formatReleaseDate(release.releasedAt), [release.releasedAt]);
  const activeId = useActiveSubsection(scrollerRef, release.version);

  return (
    <article
      // 7xl (1280px) gives the prose column room to grow to ~72ch on
      // wide displays without the TOC suffocating against the right
      // edge. TOC at 260px so long subsection titles don't wrap into
      // 3-line blobs. Below `lg` the TOC hides and the article
      // collapses back to a single column at full width.
      className="mx-auto grid w-full max-w-7xl gap-10 px-7 py-8 lg:grid-cols-[minmax(0,1fr)_260px]"
    >
      <div className="flex min-w-0 flex-col gap-7">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-fg text-[24px] leading-tight font-semibold tracking-tight">
              RunHQ {release.version}
            </h2>
            <span className="text-fg-dim/90 text-[12.5px]">·</span>
            <span className="text-fg-dim text-[12.5px]">Released {releasedDate}</span>
          </div>
          <p className="text-fg-muted text-[14.5px] leading-relaxed">{release.headline}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={release.changelogUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-dim hover:text-fg text-[11.5px] font-medium underline-offset-2 transition-colors hover:underline"
            >
              Read full changelog ↗
            </a>
          </div>
        </header>

        <div className="text-fg-muted prose-release text-[14px] leading-relaxed">
          {release.intro}
        </div>

        {release.hooks.length > 0 && (
          <section className="border-border bg-surface-raised/30 flex flex-col gap-2 rounded-xl border px-5 py-3.5">
            <div className="text-fg-dim inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider uppercase">
              <Sparkles className="text-accent h-3 w-3" />
              In this release
            </div>
            <ul className="flex flex-col gap-1.5">
              {release.hooks.map((h) => (
                <li key={h.href} className="text-[13px] leading-relaxed">
                  <a
                    href={h.href}
                    onClick={(e) => {
                      e.preventDefault();
                      const id = h.href.replace(/^#/, '');
                      scrollToSubsection(id);
                    }}
                    className="text-accent hover:text-accent/85 font-medium underline-offset-2 transition-colors hover:underline"
                  >
                    {h.label}
                  </a>
                  <span className="text-fg-muted">: {h.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-12">
          {release.sections.map((sec) => (
            <SectionBlock key={sec.id} section={sec} />
          ))}
        </div>

        <footer className="border-border mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <a
            href={release.changelogUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-dim hover:text-fg text-[12.5px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            Read full changelog ↗
          </a>
          <span className="text-fg-dim/80 text-[10.5px] tracking-wider uppercase">
            {release.sections.length} section{release.sections.length === 1 ? '' : 's'} ·{' '}
            {totalSubsections(release.sections)} highlights
          </span>
        </footer>
      </div>

      <DocumentReleaseToc
        sections={release.sections}
        activeId={activeId}
        onJump={(id) => scrollToSubsection(id)}
      />
    </article>
  );
}

function totalSubsections(sections: ReleaseSection[]): number {
  return sections.reduce((acc, s) => acc + s.subsections.length, 0);
}

function SectionBlock({ section }: { section: ReleaseSection }) {
  return (
    <section id={section.id} className="flex flex-col gap-7">
      <div className="border-border/70 flex flex-col gap-1 border-b pb-3">
        <span className="text-fg-dim/80 text-[10.5px] font-semibold tracking-[0.18em] uppercase">
          Section
        </span>
        <h3 className="text-fg text-[20px] leading-tight font-semibold tracking-tight">
          {section.title}
        </h3>
      </div>
      <div className="flex flex-col gap-10">
        {section.subsections.map((sub) => (
          <section
            key={sub.id}
            id={sub.id}
            data-subsection-id={sub.id}
            className="flex scroll-mt-6 flex-col gap-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {sub.badge && <Badge tone={BADGE_TONE[sub.badge]}>{BADGE_LABEL[sub.badge]}</Badge>}
              <h4 className="text-fg text-[17px] leading-tight font-semibold tracking-tight">
                {sub.title}
              </h4>
            </div>
            <div className="text-fg-muted prose-release text-[14px] leading-relaxed">
              {sub.body}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

/**
 * Right-side sticky TOC. Lists every subsection across every section,
 * with section labels as non-clickable group headers. Active row tracks
 * the reader's scroll position via {@link useActiveSubsection}.
 *
 * Hidden below `lg` (1024px) — at narrower widths the article collapses
 * to a single column and the TOC would force prose under it. The "In
 * this release" hook block at the top of the article still gives users
 * a quick-jump affordance on small screens.
 */
function DocumentReleaseToc({
  sections,
  activeId,
  onJump,
}: {
  sections: ReleaseSection[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  return (
    <aside className="hidden lg:block">
      <nav aria-label="In this release" className="sticky top-6 flex flex-col gap-3 text-[12.5px]">
        <div className="text-fg-dim/80 text-[10.5px] font-semibold tracking-[0.18em] uppercase">
          In this release
        </div>
        <div className="flex flex-col gap-3.5">
          {sections.map((sec) => (
            <div key={sec.id} className="flex flex-col gap-1">
              <div className="text-fg/85 truncate text-[12px] font-semibold tracking-tight">
                {sec.title}
              </div>
              <ul className="flex flex-col">
                {sec.subsections.map((sub) => {
                  const active = sub.id === activeId;
                  return (
                    <li key={sub.id}>
                      <a
                        href={`#${sub.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onJump(sub.id);
                        }}
                        className={cn(
                          'border-l-2 py-1 pl-3 text-[12px] leading-snug transition-colors',
                          active
                            ? 'border-accent text-fg font-medium'
                            : 'text-fg-dim hover:text-fg hover:border-fg-dim/50 border-transparent',
                        )}
                      >
                        {sub.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}

function formatReleaseDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}
