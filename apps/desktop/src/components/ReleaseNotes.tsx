/**
 * Release Notes — the permanent archive of every shipped release,
 * rendered into the main canvas alongside Dashboard / LogPanel /
 * StackDetail.
 *
 * Why a main-area page (and not a modal):
 *
 *   • Modals are *interruption surfaces*. They're great for "celebrate"
 *     ("you just updated, here's what's new") but actively hostile for
 *     "browse" ("what shipped two releases ago?"). A modal dimmed
 *     overlay tells the user "you're not here to read this, you're
 *     here to dismiss it" — exactly the wrong posture for an archive.
 *
 *   • Pages can host real content density. Room for a 16:9 hero per
 *     highlight, a vertical scroll, deep linking, future per-release
 *     screenshots and short videos — none of which fit a 640px modal.
 *
 *   • Linear, Raycast, Notion all do this exact thing as a route, not
 *     a popover. Following the proven pattern keeps users from
 *     learning a one-off interaction.
 *
 * Layout — single split (left: timeline; right: scrollable detail):
 *
 *   ┌──────────┬────────────────────────────────────────────┐
 *   │ TIMELINE │  Header: "RunHQ 0.6.0 — headline" · date  │
 *   │          │  ──────────────────────────────────────── │
 *   │ ● v0.7.0 │  Hero (16:9, themed) — first highlight    │
 *   │ ● v0.6.0 │  ──────────────────────────────────────── │
 *   │ ○ v0.5.1 │  Highlight 1: title, badge, blurb, CTA    │
 *   │          │  Hero per highlight                        │
 *   │          │  Highlight 2: …                            │
 *   │          │  ──────────────────────────────────────── │
 *   │          │  Footer: "Read full changelog ↗"          │
 *   └──────────┴────────────────────────────────────────────┘
 *
 * Asset / fallback contract: same as `WhatsNewModal` — `media.src` is
 * a base path; we append `-{light|dark}.webp` when `themeAware`.
 * Missing files render a tinted gradient + Lucide icon so the page
 * never shows an empty rectangle, even before screenshots are
 * captured.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, History, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/store/useAppStore';
import { getAllReleases } from '@/lib/whatsnew';
import type {
  Highlight,
  HighlightCta,
  HighlightFallback,
  WhatsNewActionId,
  WhatsNewRelease,
} from '@/lib/whatsnew';

const TINT_GRADIENT: Record<HighlightFallback['tint'], string> = {
  // Mirrors `WhatsNewModal` so cards feel like siblings of the modal.
  // Duplicated rather than imported because this is the brand language
  // for "release content" and both files are content-presentation
  // surfaces — keeping them self-contained is simpler than introducing
  // a one-import-deep shared util.
  accent:
    'radial-gradient(at 25% 25%, rgb(var(--accent) / 0.55), transparent 60%), radial-gradient(at 80% 80%, rgb(var(--accent) / 0.30), transparent 65%)',
  sky: 'radial-gradient(at 25% 25%, rgb(56 189 248 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(14 165 233 / 0.30), transparent 65%)',
  violet:
    'radial-gradient(at 25% 25%, rgb(167 139 250 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(139 92 246 / 0.30), transparent 65%)',
  emerald:
    'radial-gradient(at 25% 25%, rgb(110 231 183 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(52 211 153 / 0.30), transparent 65%)',
  amber:
    'radial-gradient(at 25% 25%, rgb(252 211 77 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(245 158 11 / 0.30), transparent 65%)',
};

const ASPECT_CLASS: Record<Highlight['media']['aspectRatio'], string> = {
  '16/9': 'aspect-video',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
};

const BADGE_STYLE: Record<NonNullable<Highlight['badge']>, string> = {
  new: 'bg-accent/15 text-accent ring-accent/30',
  improved: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  fix: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
};

const BADGE_LABEL: Record<NonNullable<Highlight['badge']>, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fixed',
};

function runStoreAction(actionId: WhatsNewActionId, onAfter: () => void): void {
  // Same allow-list as `WhatsNewModal` — adding new actions in one
  // place ripples to both surfaces; keeping them in sync manually is
  // cheaper than another shared file given how rarely actions change.
  const store = useAppStore.getState();
  switch (actionId) {
    case 'open-overview':
      store.setSelected(null);
      store.setSelectedStack(null);
      onAfter();
      return;
    case 'open-cross-project-diff':
      store.openCrossProjectDiff();
      onAfter();
      return;
    case 'open-timeline':
      store.openTimeline();
      onAfter();
      return;
    case 'open-changelog':
      // The surrounding card carries the external link; the action is
      // a no-op here so the click can fall through to the anchor.
      return;
  }
}

function CtaButton({ cta, onAfter }: { cta: HighlightCta; onAfter: () => void }) {
  if (cta.kind === 'store-action') {
    const actionId: WhatsNewActionId = cta.actionId;
    return (
      <button
        type="button"
        onClick={() => runStoreAction(actionId, onAfter)}
        className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
      >
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <a
      href={cta.href}
      target="_blank"
      rel="noreferrer noopener"
      className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
    >
      {cta.label}
      <ArrowRight className="h-3.5 w-3.5" />
    </a>
  );
}

function HighlightVisual({
  highlight,
  themeSuffix,
}: {
  highlight: Highlight;
  themeSuffix: string;
}) {
  const { media, fallback } = highlight;
  const [errored, setErrored] = useState(false);

  // Reset on slide change so an asset that fails to load on one
  // highlight doesn't keep its fallback visible after the next
  // selection swaps in a working asset.
  useEffect(() => {
    setErrored(false);
  }, [media.src, themeSuffix]);

  const resolvedSrc = useMemo(() => {
    if (!media.src) return null;
    if (media.themeAware) return `${media.src}-${themeSuffix}.webp`;
    return `${media.src}.webp`;
  }, [media.src, media.themeAware, themeSuffix]);

  const showImage = resolvedSrc != null && !errored;

  return (
    <div
      className={cn(
        'border-border bg-surface-muted relative w-full overflow-hidden rounded-[14px] border',
        ASPECT_CLASS[media.aspectRatio],
      )}
    >
      {showImage ? (
        <img
          key={resolvedSrc}
          src={resolvedSrc}
          alt={media.alt}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          aria-label={media.alt || fallback.caption}
          role="img"
          className="bg-surface-raised text-fg/85 relative flex h-full w-full flex-col items-center justify-center gap-3"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: TINT_GRADIENT[fallback.tint] }}
          />
          <div className="bg-surface-overlay/70 ring-border relative flex h-24 w-24 items-center justify-center rounded-2xl ring-1 backdrop-blur-sm">
            {fallback.icon}
          </div>
          <p className="text-fg-muted relative max-w-[80%] text-center text-[12px] font-medium tracking-wide">
            {fallback.caption}
          </p>
        </div>
      )}
    </div>
  );
}

interface ReleaseRowProps {
  release: WhatsNewRelease;
  selected: boolean;
  isRunning: boolean;
  isLatest: boolean;
  onSelect: () => void;
}

function ReleaseRow({ release, selected, isRunning, isLatest, onSelect }: ReleaseRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group rounded-app-sm relative flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-muted/50 hover:text-fg',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            selected ? 'bg-accent' : 'bg-border group-hover:bg-fg-dim',
          )}
        />
        <span className="font-mono text-[12px] font-semibold tracking-tight tabular-nums">
          v{release.version}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isLatest && (
            <span className="bg-accent/15 text-accent ring-accent/30 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ring-1">
              Latest
            </span>
          )}
          {isRunning && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-300 uppercase ring-1 ring-emerald-500/30">
              Running
            </span>
          )}
        </div>
      </div>
      <span className="text-fg-dim/90 ml-4 truncate text-[11px]">
        {formatReleaseDate(release.releasedAt)}
      </span>
      <span className="text-fg-dim ml-4 line-clamp-1 text-[11px]">{release.headline}</span>
    </button>
  );
}

export function ReleaseNotes() {
  const releases = useMemo(() => getAllReleases(), []);
  const appVersion = useAppStore((s) => s.appVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const closeReleaseNotes = useAppStore((s) => s.closeReleaseNotes);
  const hint = useAppStore((s) => s.releaseNotesSelectedVersion);
  const { effective: effectiveTheme } = useTheme();
  const themeSuffix = effectiveTheme === 'dark' ? 'dark' : 'light';

  // Default selection priority — see store doc-comment for the
  // running-version vs hint vs latest precedence rules.
  const initialVersion = useMemo(() => {
    const normalise = (v: string | null | undefined) => (v ? v.replace(/^v/i, '').trim() : null);
    const hinted = normalise(hint);
    if (hinted && releases.some((r) => normalise(r.version) === hinted)) return hinted;
    const running = normalise(appVersion);
    if (running && releases.some((r) => normalise(r.version) === running)) return running;
    return releases[0]?.version ?? null;
  }, [hint, appVersion, releases]);

  const [selectedVersion, setSelectedVersion] = useState<string | null>(initialVersion);

  // Reset selection when the hint changes (e.g. user opens a different
  // release from the WhatsNewModal "All releases" link). We deliberately
  // *don't* depend on `initialVersion` directly because that would also
  // force a reset every time `appVersion` resolves on cold start — and
  // we want the user's manual click to stick.
  useEffect(() => {
    if (!hint) return;
    const normalised = hint.replace(/^v/i, '').trim();
    if (releases.some((r) => r.version.replace(/^v/i, '') === normalised)) {
      setSelectedVersion(normalised);
    }
  }, [hint, releases]);

  // Scroll the detail pane back to the top when selection changes —
  // landing mid-scroll on a previously-read release feels broken.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedVersion]);

  const selected = useMemo(
    () => releases.find((r) => r.version === selectedVersion) ?? null,
    [releases, selectedVersion],
  );

  // Esc and Cmd/Ctrl+W on the page just closes the archive — there's
  // no cancel-vs-confirm ambiguity to worry about. Arrow keys move
  // through the timeline so you can scan releases one-handed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeReleaseNotes();
        return;
      }
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (releases.length === 0) return;
      e.preventDefault();
      const idx = releases.findIndex((r) => r.version === selectedVersion);
      const next =
        e.key === 'ArrowDown' ? Math.min(releases.length - 1, idx + 1) : Math.max(0, idx - 1);
      const target = releases[next];
      if (target) setSelectedVersion(target.version);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeReleaseNotes, releases, selectedVersion]);

  const handleOpenInModal = useCallback(() => {
    if (!selected) return;
    openWhatsNew(selected.version);
  }, [openWhatsNew, selected]);

  const latestVersion = releases[0]?.version ?? null;
  const normalisedRunning = appVersion ? appVersion.replace(/^v/i, '') : null;

  return (
    <div className="bg-surface flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="border-border bg-surface flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <button
          type="button"
          onClick={closeReleaseNotes}
          className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors"
          title="Back to dashboard"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="bg-border/70 h-4 w-px" aria-hidden />
        <div className="min-w-0">
          <span className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
            <History className="text-accent h-3 w-3" />
            Release notes
          </span>
          <h1 className="text-fg text-[14px] leading-tight font-semibold tracking-tight">
            Every release at a glance
          </h1>
        </div>
        <button
          type="button"
          onClick={closeReleaseNotes}
          aria-label="Close release notes"
          className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 ml-auto flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {releases.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="border-border bg-surface-raised/30 w-[240px] shrink-0 overflow-y-auto border-r p-2">
            <div className="text-fg-dim/80 px-2 pt-1 pb-2 text-[10px] font-semibold tracking-wider uppercase">
              Releases
            </div>
            <div className="flex flex-col gap-0.5">
              {releases.map((r) => (
                <ReleaseRow
                  key={r.version}
                  release={r}
                  selected={r.version === selectedVersion}
                  isRunning={
                    !!normalisedRunning && r.version.replace(/^v/i, '') === normalisedRunning
                  }
                  isLatest={r.version === latestVersion}
                  onSelect={() => setSelectedVersion(r.version)}
                />
              ))}
            </div>
          </aside>

          <main ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <ReleaseDetail
                release={selected}
                themeSuffix={themeSuffix}
                onOpenModal={handleOpenInModal}
                onAfterAction={closeReleaseNotes}
              />
            ) : (
              <SelectionEmpty />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function ReleaseDetail({
  release,
  themeSuffix,
  onOpenModal,
  onAfterAction,
}: {
  release: WhatsNewRelease;
  themeSuffix: string;
  onOpenModal: () => void;
  onAfterAction: () => void;
}) {
  const heroHighlight = release.highlights[0];
  // Skip the hero in the highlight stack so we don't render the same
  // image twice on the detail page. If the release ever ships with no
  // highlights at all, the stack is empty and the page is just the
  // header + changelog link, which is fine.
  const tail = release.highlights.slice(1);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-fg text-[22px] leading-tight font-semibold tracking-tight">
            RunHQ {release.version}
          </h2>
          <span className="text-fg-dim/90 text-[12px]">·</span>
          <span className="text-fg-dim text-[12px]">
            Released {formatReleaseDate(release.releasedAt)}
          </span>
        </div>
        <p className="text-fg-muted text-[14px] leading-relaxed">{release.headline}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onOpenModal}
            className="text-accent hover:text-accent/85 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
            title="Open the release modal with the same content in a focused popup"
          >
            <Sparkles className="h-3 w-3" />
            View as What&apos;s New
          </button>
          <span className="text-fg-dim/60 text-[11px]">·</span>
          <a
            href={release.changelogUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-dim hover:text-fg text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            Read full changelog ↗
          </a>
        </div>
      </div>

      {heroHighlight && <HighlightVisual highlight={heroHighlight} themeSuffix={themeSuffix} />}

      {heroHighlight && (
        <HighlightCopyBlock highlight={heroHighlight} onAfter={onAfterAction} variant="hero" />
      )}

      {tail.length > 0 && (
        <div className="flex flex-col gap-8">
          {tail.map((h) => (
            <section key={h.id} className="flex flex-col gap-4">
              <HighlightVisual highlight={h} themeSuffix={themeSuffix} />
              <HighlightCopyBlock highlight={h} onAfter={onAfterAction} variant="stacked" />
            </section>
          ))}
        </div>
      )}

      <footer className="border-border mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <a
          href={release.changelogUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-fg-dim hover:text-fg text-[12px] font-medium underline-offset-2 transition-colors hover:underline"
        >
          Read full changelog ↗
        </a>
        <span className="text-fg-dim/80 text-[10px] tracking-wider uppercase">
          {release.highlights.length} highlight
          {release.highlights.length === 1 ? '' : 's'}
        </span>
      </footer>
    </article>
  );
}

function HighlightCopyBlock({
  highlight,
  onAfter,
  variant,
}: {
  highlight: Highlight;
  onAfter: () => void;
  variant: 'hero' | 'stacked';
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {highlight.badge && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ring-1',
              BADGE_STYLE[highlight.badge],
            )}
          >
            {BADGE_LABEL[highlight.badge]}
          </span>
        )}
        <h3
          className={cn(
            'text-fg leading-tight font-semibold tracking-tight',
            variant === 'hero' ? 'text-[18px]' : 'text-[16px]',
          )}
        >
          {highlight.title}
        </h3>
      </div>
      <p className="text-fg-muted text-[13px] leading-relaxed">{highlight.blurb}</p>
      {highlight.cta && (
        <div className="pt-2">
          <CtaButton cta={highlight.cta} onAfter={onAfter} />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="bg-surface-muted/60 ring-border flex h-16 w-16 items-center justify-center rounded-2xl ring-1">
        <History className="text-fg-dim h-7 w-7" />
      </div>
      <p className="text-fg text-[14px] font-medium">No release history yet</p>
      <p className="text-fg-dim max-w-sm text-[12px] leading-relaxed">
        Curated highlights show up here after the first shipped release. In the meantime, the full
        developer-facing record lives in CHANGELOG.md.
      </p>
    </div>
  );
}

function SelectionEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <p className="text-fg-dim text-[12px]">Pick a release on the left to see its highlights.</p>
    </div>
  );
}

function formatReleaseDate(iso: string): string {
  // Locale-default for the same reasons the modal uses it (avoid
  // hard-coding US format for non-US users).
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}
