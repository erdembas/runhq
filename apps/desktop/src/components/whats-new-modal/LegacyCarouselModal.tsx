import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, History, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import { CtaButton } from './CtaButton';
import { HighlightVisual } from './HighlightVisual';
import { InlineBulletGrid } from './InlineBulletGrid';
import { BADGE_LABEL, BADGE_TONE, formatReleaseDate } from './model';
import type { LegacyHighlightsRelease } from '@/lib/whatsnew';

interface LegacyCarouselModalProps {
  release: LegacyHighlightsRelease | null;
  onClose: () => void;
}

export function LegacyCarouselModal({ release, onClose }: LegacyCarouselModalProps) {
  const [i, setI] = useState(0);
  const { effective: effectiveTheme } = useTheme();
  const themeSuffix = effectiveTheme === 'dark' ? 'dark' : 'light';
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);

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
          {slides.map((slideItem, idx) => (
            <button
              key={slideItem.id}
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
