import { useCallback, useEffect, useRef } from 'react';
import { ArrowUpRight, Sparkles, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatReleaseDate } from './model';
import type { DocumentRelease } from '@/lib/whatsnew';

interface DocumentSlimModalProps {
  release: DocumentRelease;
  onClose: () => void;
}

export function DocumentSlimModal({ release, onClose }: DocumentSlimModalProps) {
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);
  const finish = useCallback(() => {
    onClose();
  }, [onClose]);

  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const handleOpenNotes = useCallback(() => {
    finish();
    openReleaseNotes(release.version);
  }, [finish, openReleaseNotes, release.version]);

  const releasedDate = formatReleaseDate(release.releasedAt);

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/65 p-6 backdrop-blur-md"
      onClick={finish}
      role="dialog"
      aria-modal="true"
      aria-labelledby="runhq-whatsnew-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-overlay animate-fade-in rounded-app-lg relative flex w-full max-w-xl flex-col overflow-hidden border shadow-2xl select-text"
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

        <div className="flex flex-col gap-4 px-6 pt-1 pb-5">
          <div className="text-fg-muted max-w-prose text-[13px] leading-relaxed">
            {release.intro}
          </div>

          {release.hooks.length > 0 && (
            <div className="border-border bg-surface-raised/40 flex flex-col gap-2 rounded-xl border px-4 py-3">
              <div className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase">
                <Sparkles className="text-accent h-3 w-3" />
                In this release
              </div>
              <ul className="flex flex-col gap-1">
                {release.hooks.map((hook) => (
                  <li key={hook.href} className="text-[12.5px] leading-relaxed">
                    <span className="text-fg font-medium">{hook.label}</span>
                    <span className="text-fg-muted">: {hook.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="bg-surface-raised/60 border-border flex items-center justify-between gap-2 border-t px-4 py-3">
          <a
            href={release.changelogUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-dim hover:text-fg text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            Read full changelog ↗
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={finish}
              className="text-fg-dim hover:text-fg inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors"
            >
              Maybe later
            </button>
            <button
              ref={primaryRef}
              type="button"
              onClick={handleOpenNotes}
              className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
            >
              Read full notes
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
