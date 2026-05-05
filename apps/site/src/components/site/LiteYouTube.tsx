'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@runhq/cockpit-ui';

interface Props {
  /** YouTube video ID — the bit after `youtu.be/` or `?v=` in the share URL. */
  videoId: string;
  /** Caption shown next to the play button on the poster overlay. */
  title?: string;
  /** Optional duration label (e.g. `4:50`) shown as a chip on the poster. */
  durationLabel?: string;
  /** Optional override for the poster image. Defaults to YouTube's
   *  `maxresdefault.jpg` thumbnail, which is the highest-resolution
   *  auto-generated frame YouTube exposes. */
  poster?: string;
  /** Additional info line shown beneath the play button (e.g.
   *  recording context). */
  caption?: string;
  className?: string;
}

/**
 * Performance-conscious YouTube embed — a.k.a. the "lite-embed"
 * pattern (popularised by Paul Irish's `lite-youtube`).
 *
 * On first paint we render *only* a static thumbnail + a play
 * button. The full YouTube iframe (which adds ~600 KB of JavaScript +
 * a network of trackers) is created lazily, on the user's click.
 *
 * Privacy: we point at `youtube-nocookie.com`, the privacy-enhanced
 * embed origin. YouTube doesn't drop tracking cookies until the
 * visitor actually plays the video.
 *
 * CSP: requires `frame-src https://www.youtube-nocookie.com
 * https://www.youtube.com` (latter for fullscreen / chapters). Image
 * thumbnails come from `i.ytimg.com`, allowed by the existing
 * `img-src 'self' data: https:` rule.
 */
export function LiteYouTube({
  videoId,
  title = 'Watch the demo',
  durationLabel,
  poster,
  caption,
  className,
}: Props) {
  const [activated, setActivated] = useState(false);

  // YouTube auto-generates several thumbnail sizes; `maxresdefault`
  // is the sharpest (up to 1280×720) and exists for nearly all
  // public videos. If a particular upload doesn't have one, callers
  // can override via `poster`.
  const thumb = poster ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  if (activated) {
    // `playsinline=1` keeps the video inline on iOS instead of
    // forcing the full-screen native player. `rel=0` confines the
    // post-play "more videos" suggestions to this channel.
    // `modestbranding=1` removes the YouTube logo overlay during
    // playback.
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
        title={title}
        loading="eager"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className={cn('block aspect-video w-full border-0', className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      aria-label={`Play: ${title}`}
      className={cn(
        'group relative block aspect-video w-full cursor-pointer overflow-hidden border-0 p-0',
        className,
      )}
    >
      <img
        src={thumb}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.15) 100%)',
        }}
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="bg-accent text-accent-fg group-hover:bg-accent-hover relative flex h-16 w-16 items-center justify-center rounded-full shadow-2xl transition group-hover:scale-105 sm:h-20 sm:w-20">
          <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
        </span>
      </span>
      {(durationLabel || caption) && (
        <span className="absolute right-4 bottom-4 left-4 flex flex-wrap items-center gap-2 text-left">
          {durationLabel && (
            <span className="bg-surface/80 text-fg rounded-md px-2.5 py-1 font-mono text-[10.5px] font-semibold tracking-wider uppercase backdrop-blur">
              {durationLabel}
            </span>
          )}
          {caption && (
            <span className="bg-surface/80 text-fg-muted rounded-md px-2.5 py-1 text-[11px] backdrop-blur">
              {caption}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
