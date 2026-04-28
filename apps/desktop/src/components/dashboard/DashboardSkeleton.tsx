import { Layers, ArrowDownWideNarrow, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * First-paint skeleton for the dashboard.
 *
 * The dashboard is one of those screens that's *almost* there on
 * cold start — services hydrate from Rust within ~150-400ms — but
 * during that window the user sees an empty `<div>`, then a snap
 * to either the onboarding card (if zero services) or the populated
 * grid. Both transitions are jarring: the former because it falsely
 * suggests "you have nothing", the latter because the layout pops
 * in all at once with no easing.
 *
 * This component fills the gap with a layout-matched ghost: same
 * header / kpi strip / filter bar / 6-card grid as the real thing,
 * but every textual element is replaced with a pulsing rectangle.
 * The eye accepts it as "loading content of this shape" rather than
 * "no content", and when the real data arrives the page doesn't
 * jump — the bones are already in place.
 *
 * Implementation choices:
 *   - Tailwind's built-in `animate-pulse` is good enough; we don't
 *     need a custom keyframe for what is at most 400ms of presence
 *     and benefits from being the same effect React Suspense /
 *     react-loading-skeleton libraries use (familiar visual
 *     vocabulary for users who grew up on Linear / Vercel / GitHub).
 *   - Card-grid widths are *staggered* (6 cards with slightly
 *     different ghost-line widths) so the skeleton doesn't look
 *     like wallpaper. A perfectly uniform skeleton reads as "broken
 *     UI"; subtle variation reads as "loading data".
 */
export function DashboardSkeleton() {
  return (
    <div
      className="bg-surface relative flex min-h-0 flex-1 overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
    >
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex-1 overflow-y-auto">
          {/*
            Faint accent halo at the top mirrors what the real
            dashboard renders when there are running services —
            we don't know whether that branch will fire post-load,
            but a soft halo is more inviting than a flat surface
            and matches the busy-state we expect most of the time.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
            style={{
              background:
                'radial-gradient(900px 340px at 50% -20%, rgb(var(--accent) / 0.06), transparent 70%)',
            }}
          />
          <div className="@container/main relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
            <header className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end @3xl/main:justify-between">
              <div className="min-w-0">
                {/*
                  Eyebrow row: brand badge + RunHQ name + greeting.
                  We render the actual brand glyph (it's instantly
                  available) so the screen always *says* "RunHQ"
                  even mid-skeleton. Only the dynamic text bits
                  ("Good morning", "v0.6.0") become bars.
                */}
                <div className="text-fg-dim mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase">
                  <span className="from-accent to-accent-hover border-accent/40 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-gradient-to-br text-white shadow-[0_2px_8px_-2px_rgb(var(--accent)/0.6)]">
                    <Zap className="h-3 w-3" />
                  </span>
                  <span className="text-fg">RunHQ</span>
                  <SkeletonBar className="h-2 w-8 opacity-60" />
                  <span className="text-fg-dim mx-1 opacity-30">·</span>
                  <SkeletonBar className="h-2 w-20 opacity-60" />
                </div>
                <SkeletonBar className="h-7 w-72" />
                <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <SkeletonBar className="h-3 w-20" />
                  <span className="text-fg-dim">·</span>
                  <SkeletonBar className="h-3 w-24" />
                  <span className="text-fg-dim">·</span>
                  <SkeletonBar className="h-3 w-16" />
                </div>
              </div>
              {/*
                Action button cluster on the right. We render three
                ghost buttons matching the real header
                ("Analyze Workspace · New service · Actions ▾") so the
                user sees the affordances about to appear, rather than
                them popping in mid-scroll.
              */}
              <div className="flex items-center gap-2">
                <SkeletonBar className="h-7 w-40 rounded-md" />
                <SkeletonBar className="h-7 w-28 rounded-md" />
                <SkeletonBar className="h-7 w-24 rounded-md" />
              </div>
            </header>

            {/*
              Filter / Organize bar — chrome is real (icon + visible
              "glass" surface) so the placement of controls is locked
              in even before the data drives them. Inside, two select
              ghosts and a few pill ghosts pace the layout.
            */}
            <div className="glass flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
              <div className="flex items-center gap-2">
                <Layers className="text-fg-dim/40 h-3 w-3" />
                <SkeletonBar className="h-6 w-24 rounded-md" />
                <ArrowDownWideNarrow className="text-fg-dim/40 h-3 w-3" />
                <SkeletonBar className="h-6 w-28 rounded-md" />
              </div>
              <span aria-hidden className="bg-border/70 h-4 w-px shrink-0" />
              <div className="flex items-center gap-1.5">
                <SkeletonBar className="rounded-app-sm h-5 w-12" />
                <SkeletonBar className="rounded-app-sm h-5 w-14" />
                <SkeletonBar className="rounded-app-sm h-5 w-12" />
                <SkeletonBar className="rounded-app-sm h-5 w-16" />
              </div>
            </div>

            {/*
              Section heading + 6-card grid. Six is enough cards to
              fill three rows on the typical 1440px window without
              overflowing the viewport — the user always sees the
              skeleton "below" the header, never the inverse.
            */}
            <section className="group/section">
              <div className="mb-3 flex items-center gap-2">
                <span className="bg-fg-dim/30 inline-block h-1.5 w-1.5 rounded-full" />
                <SkeletonBar className="h-3 w-20" />
                <SkeletonBar className="h-3 w-6 opacity-60" />
              </div>
              <div className="grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                {SKELETON_CARDS.map((card, i) => (
                  <ServiceCardSkeleton key={i} variant={card} />
                ))}
              </div>
            </section>

            {/*
              Footer mirrors the real footer's height so the scroll
              container doesn't subtly resize when content swaps in.
            */}
            <footer className="text-fg-dim mt-auto flex items-center justify-between pt-4 text-[11px] opacity-60">
              <SkeletonBar className="h-2.5 w-44" />
              <SkeletonBar className="h-2.5 w-20" />
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-card variants. Each tweaks the relative widths of the title /
 * subtitle / chip ghosts so the grid doesn't read as wallpaper. The
 * underlying card chrome is identical — only the inner bars vary.
 */
type CardVariant = 'wide' | 'narrow' | 'mid' | 'long' | 'tall' | 'compact';
const SKELETON_CARDS: CardVariant[] = ['wide', 'mid', 'narrow', 'long', 'compact', 'tall'];

function ServiceCardSkeleton({ variant }: { variant: CardVariant }) {
  // Centralise the per-variant numbers so the visual rhythm is
  // adjustable from one place. Widths are intentionally in the
  // 28-44 / 16-28 range — enough variation to break monotony,
  // narrow enough that the cards don't flag-pole their text.
  const titleWidth =
    variant === 'wide'
      ? 'w-44'
      : variant === 'long'
        ? 'w-40'
        : variant === 'mid'
          ? 'w-32'
          : variant === 'narrow'
            ? 'w-24'
            : variant === 'tall'
              ? 'w-36'
              : 'w-28';
  const subtitleWidth =
    variant === 'wide' ? 'w-28' : variant === 'long' ? 'w-32' : variant === 'mid' ? 'w-20' : 'w-16';
  return (
    <div className="border-border/60 bg-surface-muted/20 rounded-app flex flex-col gap-3 border p-3">
      {/* Title row: status dot + name + tags. */}
      <div className="flex items-center gap-2">
        <span className="bg-fg-dim/30 inline-block h-2 w-2 shrink-0 rounded-full" />
        <SkeletonBar className={cn('h-3', titleWidth)} />
        <span className="text-fg-dim/40 ml-auto">
          <SkeletonBar className="h-2.5 w-10" />
        </span>
      </div>
      {/* Subtitle row: command preview / branch / etc. */}
      <SkeletonBar className={cn('h-2.5', subtitleWidth)} />
      {/*
        Mid-card chip strip — emulates the badge cluster (runtime,
        port, last-activity). Two pills are enough to feel populated;
        more would make the skeleton noisier than the real card.
      */}
      <div className="flex items-center gap-1.5">
        <SkeletonBar className="h-4 w-12 rounded-full" />
        <SkeletonBar className="h-4 w-14 rounded-full" />
        {variant === 'tall' && <SkeletonBar className="h-4 w-10 rounded-full" />}
      </div>
      {/* Footer action row mirrors the real card's button rail. */}
      <div className="border-border/40 mt-1 flex items-center justify-between border-t pt-2">
        <SkeletonBar className="h-3 w-16 opacity-70" />
        <div className="flex items-center gap-1">
          <SkeletonBar className="h-5 w-5 rounded" />
          <SkeletonBar className="h-5 w-5 rounded" />
          <SkeletonBar className="h-5 w-5 rounded" />
        </div>
      </div>
    </div>
  );
}

/**
 * One pulsing block. Sized purely by `className` so callers can
 * place it inline next to text bullets, inside grids, etc.
 *
 * `bg-fg/10` is deliberately subtle — high-contrast skeletons read
 * as "broken empty boxes" on dark themes; we want the bars to
 * suggest "content is on its way" without dominating the page.
 * The `animate-pulse` adds a slow opacity cycle that keeps the
 * eye gently engaged during the wait.
 */
function SkeletonBar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('bg-fg/10 inline-block animate-pulse rounded-md', className)} />
  );
}
