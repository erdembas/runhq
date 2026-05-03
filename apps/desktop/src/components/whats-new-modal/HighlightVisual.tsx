import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { resolveMediaSrc } from '@/lib/whatsnew/resolveMediaSrc';
import { ASPECT_CLASS, TINT_GRADIENT } from './model';
import type { Highlight } from '@/lib/whatsnew';

interface HighlightVisualProps {
  highlight: Highlight;
  themeSuffix: 'light' | 'dark';
}

export function HighlightVisual({ highlight, themeSuffix }: HighlightVisualProps) {
  const { media, fallback } = highlight;
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [media.src, themeSuffix]);

  const isVideo = media.kind === 'video';
  const resolvedSrc = useMemo(() => resolveMediaSrc(media, themeSuffix), [media, themeSuffix]);

  if (resolvedSrc == null) return null;

  const showMedia = !errored;

  return (
    <div
      className={cn(
        'border-border bg-surface-muted relative w-full overflow-hidden rounded-t-[12px] border-b',
        ASPECT_CLASS[media.aspectRatio],
      )}
    >
      {showMedia ? (
        isVideo ? (
          <video
            key={resolvedSrc}
            src={resolvedSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={media.alt}
            onError={() => setErrored(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <img
            key={resolvedSrc}
            src={resolvedSrc}
            alt={media.alt}
            loading="eager"
            decoding="async"
            onError={() => setErrored(true)}
            className="h-full w-full object-cover"
          />
        )
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
