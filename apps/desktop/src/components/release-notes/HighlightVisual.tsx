import { useEffect, useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { cn } from '@/lib/cn';
import { resolveMediaSrc } from '@/lib/whatsnew/resolveMediaSrc';
import { ASPECT_CLASS, TINT_GRADIENT } from './model';
import type { Highlight } from '@/lib/whatsnew';

interface HighlightVisualProps {
  highlight: Highlight;
  themeSuffix: 'light' | 'dark';
  onZoom?: (media: { src: string; alt: string; kind: 'image' | 'video' }) => void;
}

export function HighlightVisual({ highlight, themeSuffix, onZoom }: HighlightVisualProps) {
  const { media, fallback } = highlight;
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [media.src, themeSuffix]);

  const isVideo = media.kind === 'video';
  const resolvedSrc = useMemo(() => resolveMediaSrc(media, themeSuffix), [media, themeSuffix]);

  if (resolvedSrc == null) return null;

  const showMedia = !errored;
  const canZoom = showMedia && onZoom != null;
  const handleZoom = canZoom
    ? () => onZoom({ src: resolvedSrc, alt: media.alt, kind: isVideo ? 'video' : 'image' })
    : undefined;

  return (
    <div
      className={cn(
        'border-border bg-surface-muted relative w-full overflow-hidden rounded-[14px] border',
        ASPECT_CLASS[media.aspectRatio],
      )}
    >
      {showMedia ? (
        canZoom ? (
          <button
            type="button"
            onClick={handleZoom}
            className="group relative block h-full w-full cursor-zoom-in overflow-hidden focus-visible:outline-none"
            aria-label={`${media.alt} — click to enlarge`}
          >
            {isVideo ? (
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
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
              />
            ) : (
              <img
                key={resolvedSrc}
                src={resolvedSrc}
                alt={media.alt}
                loading="lazy"
                decoding="async"
                onError={() => setErrored(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
              />
            )}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
            <span
              aria-hidden
              className="ring-border bg-surface-overlay/85 text-fg/85 pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium opacity-0 ring-1 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <ZoomIn className="h-3 w-3" /> Click to enlarge
            </span>
          </button>
        ) : isVideo ? (
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
            loading="lazy"
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
