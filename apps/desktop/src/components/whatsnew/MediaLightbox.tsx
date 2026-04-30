/**
 * Full-screen zoom view for release-note media.
 *
 * Shared between the legacy `HighlightVisual` zoom on the archive page
 * and the document-style `InlineMedia` primitive used inside
 * subsection prose. Lives in its own file so both call sites can mount
 * a single overlay without duplicating the keyboard handler / portal-
 * style fixed positioning.
 *
 * Handles two media kinds in the same shell, but with **kind-specific
 * sizing** because their default scaling rules disagree:
 *
 *   • `kind: 'image'` — `<img>` capped at 94vh / 96vw via `max-*`
 *     classes. Static screenshots have a known intrinsic size; a 2× DPR
 *     `.webp` rarely needs more room, and we want tiny captures to stay
 *     at native size rather than blow up into a soft, upscaled mess.
 *
 *   • `kind: 'video'` — wrapped in an `aspect-video` container at
 *     `w-[96vw] max-h-[94vh]` and the `<video>` itself stretched via
 *     `h-full w-full object-contain`. A `<video>` element without
 *     explicit dimensions falls back to its intrinsic size (1280×720
 *     for our 0.9.0+ clips), so plain `max-*` classes would let the
 *     lightbox render as a small ~67vw box on a 1920px display — the
 *     exact opposite of "zoom in". Forcing the wrapper to a viewport-
 *     relative 16:9 rectangle and letting the video fill it pushes the
 *     clip up to ~94vw × 94vh on widescreen and keeps it perfectly
 *     aspect-fit on tall / narrow viewports too. `controls` lights up
 *     only at the zoomed level so the inline tile stays decorative
 *     motion; pause / scrub becomes a "study mode" affordance unique
 *     to the lightbox.
 *
 * Common behaviour:
 *   • Backdrop click closes (matches GitHub / Linear / Stripe lightboxes)
 *   • `Escape` closes (and stops propagation so the parent page's own
 *     Escape-handler doesn't also pop the Release Notes view)
 *   • Click on the media itself doesn't bubble to backdrop — only
 *     clicks on the dim area dismiss. For video this is critical:
 *     hitting Play/Pause inside `controls` would otherwise also close
 *     the lightbox.
 */
import { useEffect, type MouseEvent } from 'react';
import { X } from 'lucide-react';

export interface MediaLightboxProps {
  src: string;
  alt: string;
  kind: 'image' | 'video';
  onClose: () => void;
}

export function MediaLightbox({ src, alt, kind, onClose }: MediaLightboxProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const stopBackdrop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-80 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={kind === 'video' ? 'Close video preview' : 'Close image preview'}
        className="absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-white/20 focus-visible:bg-white/20 focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
      </button>
      {kind === 'video' ? (
        <div
          onClick={stopBackdrop}
          className="relative aspect-video max-h-[94vh] w-[96vw] overflow-hidden rounded-lg bg-black shadow-[0_20px_60px_-12px_rgb(0_0_0/0.6)]"
        >
          <video
            src={src}
            aria-label={alt}
            autoPlay
            muted
            loop
            playsInline
            controls
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          onClick={stopBackdrop}
          className="max-h-[94vh] max-w-[96vw] rounded-lg shadow-[0_20px_60px_-12px_rgb(0_0_0/0.6)]"
        />
      )}
    </div>
  );
}
