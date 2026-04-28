/**
 * Release-highlights modal ("What's New in RunHQ X.Y.Z").
 *
 * Layered above WelcomeTour in the modal stack — when both fire on the
 * same launch (fresh install + a release that already had highlights),
 * the tour wins; we only auto-trigger after `hasSeenTour()` returns
 * true (handled in App.tsx). Manual entry points (Settings, sidebar
 * version chip, command palette) bypass the queue and open immediately.
 *
 * Layout follows the WelcomeTour shell so the two modals feel like
 * siblings: same border / surface / accent halo, same dot pagination,
 * same `prev / counter / next` footer rhythm. Differences:
 *
 *   • Wider container (max-w-2xl) because each highlight gets a 16:9
 *     media slot at the top — at the tour's max-w-lg the image would
 *     letterbox awkwardly.
 *   • Theme-aware image swap. `media.themeAware: true` + `media.src`
 *     of `/whatsnew/0.6.0/dashboard` resolves to
 *     `/whatsnew/0.6.0/dashboard-{light|dark}.webp` so screenshots
 *     match the running theme without a runtime tint hack.
 *   • Image-load fallback chain: declared `src` → theme-flipped
 *     sibling → in-component gradient + icon. This means the modal
 *     can ship before any screenshot is captured (ship-now vs.
 *     wait-for-assets) without an empty rectangle anywhere.
 *   • CTAs map through a small allow-list of in-app actions
 *     (open-overview / open-cross-project-diff / open-timeline /
 *     open-changelog) so the data file stays JSON-safe and we don't
 *     have to import every feature panel into the registry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, History, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/store/useAppStore';
import { getReleaseFor, markVersionSeen } from '@/lib/whatsnew';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type {
  Highlight,
  HighlightCta,
  HighlightFallback,
  WhatsNewActionId,
  WhatsNewRelease,
} from '@/lib/whatsnew';

interface Props {
  version: string;
  onClose: () => void;
}

const TINT_GRADIENT: Record<HighlightFallback['tint'], string> = {
  // Each tint maps a (start → end) gradient that tracks the brand accent
  // closely enough to feel like part of the modal, not a stock placeholder.
  // Encoded as inline styles because Tailwind doesn't ship arbitrary
  // gradient stops without a JIT-time string at build time, and the
  // stops here are derived from CSS custom properties we want the user's
  // theme to drive.
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

// Highlight tier → semantic tone. We render with the shared <Badge>
// component so light/dark contrast is handled by the token system instead
// of hand-tuned `sky-300` / `emerald-300` shades that previously bleached
// out on the ivory surface.
const BADGE_TONE: Record<NonNullable<Highlight['badge']>, BadgeTone> = {
  new: 'accent',
  improved: 'info',
  fix: 'success',
};

const BADGE_LABEL: Record<NonNullable<Highlight['badge']>, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fixed',
};

/**
 * Resolve a CTA `actionId` into a side-effect closure that opens the
 * relevant in-app surface. Lives outside the component so the closures
 * are stable across renders and we can unit-test the wiring without
 * mounting the modal.
 *
 * Note: store accessors are read at *call time* (`useAppStore.getState()`),
 * not at render time, so the closures don't need to be re-derived when
 * the user navigates around — they always operate on the live store.
 */
function runStoreAction(actionId: WhatsNewActionId, onClose: () => void): void {
  const store = useAppStore.getState();
  switch (actionId) {
    case 'open-overview':
      // Dashboard surface is whatever renders when no service / stack is
      // selected — there's no dedicated overview panel above that.
      store.setSelected(null);
      store.setSelectedStack(null);
      onClose();
      return;
    case 'open-cross-project-diff':
      store.openCrossProjectDiff();
      onClose();
      return;
    case 'open-timeline':
      store.openTimeline();
      onClose();
      return;
    case 'open-ai-chat':
      // The right-side panel hosts the AI chat hub; clearing the active
      // conversation drops the user into the empty composer rather than
      // a stale prior turn list, which is the more useful "show me how"
      // landing for someone who just came out of the modal.
      store.setRightPanel('ai');
      store.setActiveConversation(null);
      onClose();
      return;
    case 'open-ai-settings':
      // AiSettings is a window-level dialog wired to a CustomEvent so
      // surfaces deep in the tree don't have to thread props all the
      // way up. We close the modal first so the dialog isn't stacked
      // on top of it.
      onClose();
      window.dispatchEvent(new CustomEvent('runhq:open-ai-settings'));
      return;
    case 'open-changelog':
      // Changelog is an external link rather than an in-app surface —
      // surfaced through the data registry's `changelogUrl`. Closing
      // the modal would interrupt the user mid-read in their browser,
      // so we leave it open and let them dismiss manually.
      return;
  }
}

/**
 * CTA button. Split out so the discriminated union narrows correctly
 * without `!` assertions inside the JSX — TypeScript can't track the
 * `kind` check across an inline arrow function, so passing the cta in
 * by prop and switching on it locally is cleaner than the alternative
 * (typecasting `actionId` to silence the compiler).
 */
function CtaButton({ cta, onAction }: { cta: HighlightCta; onAction: () => void }) {
  if (cta.kind === 'store-action') {
    const actionId: WhatsNewActionId = cta.actionId;
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={() => runStoreAction(actionId, onAction)}
          className="btn-chrome rounded-app-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
        >
          {cta.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="pt-1">
      <a
        href={cta.href}
        target="_blank"
        rel="noreferrer noopener"
        className="btn-chrome rounded-app-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
      >
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
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

  // Reset the error flag whenever the highlight changes — without this
  // an image that fails to load on slide 1 keeps the fallback even
  // after the user pages forward to a slide whose asset is fine.
  useEffect(() => {
    setErrored(false);
  }, [media.src, themeSuffix]);

  const resolvedSrc = useMemo(() => {
    if (!media.src) return null;
    // `media.src` is the *base* path (no extension). We always append
    // `.webp` because that's the format we publish — Tauri's bundled
    // webview supports it on every platform we ship to. If a future
    // release wants a different format, the schema can grow an
    // explicit `format` field; for now keeping it implicit avoids
    // every release entry repeating `format: 'webp'`.
    if (media.themeAware) return `${media.src}-${themeSuffix}.webp`;
    return `${media.src}.webp`;
  }, [media.src, media.themeAware, themeSuffix]);

  // Image-less highlight: don't render a visual slot at all. The modal's
  // copy section will surface bullets / blurb inline so the slide reads
  // as a content card, not a screenshot with a missing image.
  if (resolvedSrc == null) return null;

  const showImage = !errored;

  return (
    <div
      className={cn(
        'border-border bg-surface-muted relative w-full overflow-hidden rounded-t-[12px] border-b',
        ASPECT_CLASS[media.aspectRatio],
      )}
    >
      {showImage ? (
        <img
          key={resolvedSrc /* force re-render so onError clears between slides */}
          src={resolvedSrc}
          alt={media.alt}
          loading="eager"
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
          <div className="bg-surface-overlay/70 ring-border relative flex h-20 w-20 items-center justify-center rounded-2xl ring-1 backdrop-blur-sm">
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

/**
 * In-flow feature grid for image-less highlights inside the modal.
 *
 * Mirrors the helper in `ReleaseNotes.tsx` but with tighter spacing for
 * the modal's narrower content area (~32rem). Lives in the prose flow
 * (no aspect-locked container, no gradient backdrop) because the
 * highlight was deliberately authored without a screenshot — the
 * bullets *are* the content, not artwork.
 *
 * Duplicated rather than factored to a shared module: modal and page
 * are deliberately self-contained presentation surfaces and the tile
 * is small enough that the coupling cost would dwarf the savings.
 */
function InlineBulletGrid({ fallback }: { fallback: HighlightFallback }) {
  if (!fallback.bullets || fallback.bullets.length === 0) return null;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {fallback.bullets.map((b, i) => (
        <li
          key={i}
          className="bg-surface-raised/40 border-border/70 text-fg flex items-start gap-2 rounded-lg border px-2.5 py-2"
        >
          <span className="bg-surface-muted/70 text-fg/85 ring-border/70 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1">
            {b.icon}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
            <span className="text-fg truncate text-[11.5px] font-semibold tracking-tight">
              {b.label}
            </span>
            {b.sub && (
              <span className="text-fg-dim truncate font-mono text-[10px] tracking-tight">
                {b.sub}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WhatsNewModal({ version, onClose }: Props) {
  const release = useMemo<WhatsNewRelease | null>(() => getReleaseFor(version), [version]);
  const [i, setI] = useState(0);
  const { effective: effectiveTheme } = useTheme();
  const themeSuffix = effectiveTheme === 'dark' ? 'dark' : 'light';

  // Mark the *running* version (not the release version) as seen — this
  // means even if a fresh install never sees the modal (first-launch
  // silent rule), the trigger still records a baseline so the next
  // major / minor upgrade fires correctly. We do this in an effect
  // because reading the store inside render is a footgun, and because
  // we want the side-effect to run exactly once per mount.
  const appVersion = useAppStore((s) => s.appVersion);
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);
  useEffect(() => {
    if (appVersion) markVersionSeen(appVersion);
  }, [appVersion]);

  const finish = useCallback(() => {
    onClose();
  }, [onClose]);

  const slides = release?.highlights ?? [];
  const last = slides.length - 1;
  const isFirst = i === 0;
  const isLast = i === last;

  const next = useCallback(() => {
    if (isLast) finish();
    else setI((n) => n + 1);
  }, [isLast, finish]);

  const prev = useCallback(() => {
    setI((n) => Math.max(0, n - 1));
  }, []);

  // Focus the primary action on slide change so keyboard users can
  // ↩ / Esc / ← / → without ever reaching for the mouse.
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, finish]);

  // Render-safe early exit. We render `null` (rather than throwing)
  // because the modal can be opened with an arbitrary version string
  // from a future "release history" picker; an unknown version simply
  // means "nothing to show" and shouldn't crash the app.
  if (!release || slides.length === 0) return null;

  const slide = slides[i]!;
  const releasedDate = formatReleaseDate(release.releasedAt);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-6 backdrop-blur-md"
      onClick={finish}
      role="dialog"
      aria-modal="true"
      aria-labelledby="runhq-whatsnew-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-overlay animate-fade-in rounded-app-lg relative flex w-full max-w-2xl flex-col overflow-hidden border shadow-2xl select-text"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-52 w-[28rem] -translate-x-1/2 opacity-70"
          style={{
            background: 'radial-gradient(closest-side, rgb(var(--accent) / 0.30), transparent 70%)',
          }}
        />

        <header className="relative flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <span className="text-fg-dim inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
              <Sparkles className="text-accent h-3.5 w-3.5" />
              What&apos;s new
            </span>
            <h2
              id="runhq-whatsnew-title"
              className="text-fg mt-1 text-[16px] leading-tight font-semibold tracking-tight"
            >
              RunHQ {release.version}
              <span className="text-fg-dim ml-2 text-[12px] font-normal">— {release.headline}</span>
            </h2>
            {releasedDate && (
              <p className="text-fg-dim mt-0.5 text-[11px]">Released {releasedDate}</p>
            )}
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Close What's New"
            className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 -mt-1 -mr-1 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {slide.media.src && (
          // Visual slot only renders when the highlight has an actual
          // image to show. Image-less slides skip this block entirely
          // so the modal compresses around the copy + bullets.
          <div className="relative">
            <HighlightVisual highlight={slide} themeSuffix={themeSuffix} />
          </div>
        )}

        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="flex items-center gap-2">
            {slide.badge && (
              <Badge tone={BADGE_TONE[slide.badge]}>{BADGE_LABEL[slide.badge]}</Badge>
            )}
            <h3 className="text-fg text-[15px] leading-tight font-semibold tracking-tight">
              {slide.title}
            </h3>
          </div>
          <p className="text-fg-muted max-w-prose text-[13px] leading-relaxed">{slide.blurb}</p>

          {!slide.media.src && slide.fallback.bullets && slide.fallback.bullets.length > 0 && (
            <InlineBulletGrid fallback={slide.fallback} />
          )}

          {slide.cta && <CtaButton cta={slide.cta} onAction={finish} />}
        </div>

        <div className="flex items-center justify-center gap-1.5 px-5 pb-3">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Go to highlight ${idx + 1}`}
              aria-current={idx === i}
              onClick={() => setI(idx)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === i ? 'bg-accent w-6' : 'bg-border hover:bg-fg-dim/60 w-1.5',
              )}
            />
          ))}
        </div>

        <div className="bg-surface-raised/60 border-border flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex items-center gap-3">
            <a
              href={release.changelogUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-dim hover:text-fg text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
            >
              Read full changelog ↗
            </a>
            <button
              type="button"
              onClick={() => {
                // Close the modal *then* open the page so the user
                // doesn't see the modal flash through to the new
                // canvas. The page consumes the version hint to
                // pre-select this release.
                finish();
                openReleaseNotes(release.version);
              }}
              className="text-fg-dim hover:text-fg inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
              title="Browse every release"
            >
              <History className="h-3 w-3" />
              All releases
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className={cn(
                'text-fg-dim hover:text-fg inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                isFirst && 'invisible',
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <span className="text-fg-dim font-mono text-[11px] tabular-nums">
              {i + 1} / {slides.length}
            </span>

            <button
              ref={primaryRef}
              type="button"
              onClick={next}
              className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Got it
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatReleaseDate(iso: string): string {
  // Intentionally locale-default: a fixed `Apr 23, 2026` string would
  // feel American to non-US users, while `Intl.DateTimeFormat` honours
  // the OS locale. Falling back to the raw string keeps things sane
  // if a future release entry uses a non-ISO date by mistake.
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
