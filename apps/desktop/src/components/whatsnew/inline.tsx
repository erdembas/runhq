/**
 * Inline primitives for document-style release notes.
 *
 * These render *inside* the prose body of a `ReleaseSubsection`, so
 * they're authored as JSX in the data file:
 *
 *   ```tsx
 *   body: (
 *     <>
 *       <p>Cmd/Ctrl+F now opens a search bar across logs and terminal.</p>
 *       <p>Selecting text first auto-fills the query — same muscle
 *          memory as <KbdChip>Cmd+F</KbdChip> in Chrome / VS Code.</p>
 *       <Callout tone="tip">
 *         Decoration runs against the rendered ANSI buffer, so matches
 *         inside coloured spans get highlighted correctly.
 *       </Callout>
 *       <InlineMedia
 *         src="https://cdn.runhq.dev/whatsnew/0.10.0/terminal-search"
 *         alt="Search bar across log + terminal panes"
 *         kind="video"
 *       />
 *     </>
 *   )
 *   ```
 *
 * Four primitives, each tuned for a specific authoring need:
 *
 *   • {@link SettingChip} — a `Setting:` style monospace chip pointing
 *     at an env var or app setting. Borrowed from VS Code release
 *     notes, where `Setting: github.copilot.chat.x` chips appear inline
 *     to make config references scannable. Rendered as a tinted pill
 *     that wraps with the surrounding text.
 *
 *   • {@link KbdChip} — release-notes-flavoured `<kbd>` for keyboard
 *     shortcuts. A thin wrapper on the existing `Kbd` primitive that
 *     adapts spacing for inline-prose (vs. the original tight chrome
 *     used in shortcut lists).
 *
 *   • {@link Callout} — GFM-style `> [!NOTE/TIP/WARNING/SUCCESS]`
 *     block. Tone drives a tinted left border + matching icon. Use
 *     for one-paragraph asides ("requires reload", "opt-in for now")
 *     that would otherwise interrupt the surrounding prose if inlined.
 *
 *   • {@link InlineMedia} — aspect-locked `<img>` / `<video>` slot
 *     embedded directly in the prose flow, with click-to-zoom into a
 *     shared `MediaLightbox`. Replaces the carousel "media slot" of
 *     the legacy schema; visuals now live next to the prose that
 *     describes them, not in a separate ribbon.
 *
 * All four are deliberately styled to match the surrounding prose
 * (same `text-fg-muted`, same `[13px]` rhythm) instead of fighting
 * for attention — release notes should read like a doc, not like a
 * marketing landing page.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, Lightbulb, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { resolveMediaSrc } from '@/lib/whatsnew/resolveMediaSrc';
import type { CalloutTone, HighlightMedia } from '@/lib/whatsnew/types';
import { MediaLightbox } from './MediaLightbox';

/**
 * Inline `Setting: NAME` chip. Encourages discoverability of env vars
 * and app settings the way VS Code's release notes do — every config
 * key the release adds or changes gets a chip the user can copy with
 * a click later (future enhancement; for now it's display-only).
 */
export function SettingChip({
  name,
  prefix = 'Setting',
}: {
  name: string;
  /** Override the leading label. Defaults to `Setting`; `Env` is also common. */
  prefix?: string;
}) {
  return (
    <span className="border-border/70 bg-surface-muted/60 text-fg/90 mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-px align-baseline">
      <span className="text-fg-dim text-[10px] font-semibold tracking-wider uppercase">
        {prefix}
      </span>
      <span className="text-fg/90 font-mono text-[12px] leading-none break-all">{name}</span>
    </span>
  );
}

/**
 * Release-notes flavoured `<kbd>`. Same accent-leaning ring the
 * shortcuts surface uses, but with a touch more vertical padding so
 * it sits on a 13px prose line without floating.
 */
export function KbdChip({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border bg-surface-muted text-fg/90 mx-0.5 inline-flex h-[20px] min-w-[22px] items-center justify-center rounded-md border px-1.5 align-baseline font-mono text-[11.5px]">
      {children}
    </kbd>
  );
}

const CALLOUT_TONE: Record<
  CalloutTone,
  { ring: string; bg: string; tint: string; label: string; icon: ReactNode }
> = {
  // Borders + icons stay on a soft tinted ring rather than a hard
  // saturated colour — release notes are read in long stretches and a
  // ribbon of warning-yellow boxes would fatigue the eye fast.
  note: {
    ring: 'ring-border/70',
    bg: 'bg-surface-raised/40',
    tint: 'text-fg-dim',
    label: 'Note',
    icon: <Info className="h-3.5 w-3.5" />,
  },
  tip: {
    ring: 'ring-accent/35',
    bg: 'bg-accent/[0.06]',
    tint: 'text-accent',
    label: 'Tip',
    icon: <Lightbulb className="h-3.5 w-3.5" />,
  },
  success: {
    ring: 'ring-emerald-400/30',
    bg: 'bg-emerald-400/[0.06]',
    tint: 'text-emerald-400',
    label: 'Why it matters',
    icon: <CircleCheck className="h-3.5 w-3.5" />,
  },
  warning: {
    ring: 'ring-amber-400/35',
    bg: 'bg-amber-400/[0.06]',
    tint: 'text-amber-400',
    label: 'Heads up',
    icon: <CircleAlert className="h-3.5 w-3.5" />,
  },
};

/**
 * Tinted aside block. Stays tight (no big icon, no border-radius blob)
 * because it lives inside long-form prose — heavier chrome would feel
 * like a marketing CTA in the middle of a doc.
 *
 * Optional `title` overrides the default tone label ("Note", "Tip",
 * "Why it matters", "Heads up"). Leave undefined for the default.
 */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  const cfg = CALLOUT_TONE[tone];
  return (
    <aside
      className={cn('my-3 flex flex-col gap-1.5 rounded-lg px-3.5 py-2.5 ring-1', cfg.ring, cfg.bg)}
    >
      <div
        className={cn(
          'inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase',
          cfg.tint,
        )}
      >
        {cfg.icon}
        {title ?? cfg.label}
      </div>
      <div className="text-fg-muted text-[13.5px] leading-relaxed">{children}</div>
    </aside>
  );
}

const ASPECT_CLASS: Record<HighlightMedia['aspectRatio'], string> = {
  '16/9': 'aspect-video',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
};

/**
 * In-prose media block — aspect-locked `<img>` / `<video>` with
 * click-to-zoom into a {@link MediaLightbox}. Lives directly in the
 * subsection body so visuals appear next to the prose that explains
 * them, not in a separate ribbon (which is what the legacy carousel
 * model did and why navigation felt fragmented).
 *
 * Theme-aware variants follow the same `-light` / `-dark` suffix
 * convention as legacy `HighlightMedia`, resolved through the shared
 * `resolveMediaSrc` helper. Absolute URLs (CDN-hosted videos) bypass
 * extension / theme machinery — see helper docs.
 *
 * The `caption` prop renders as a small `<figcaption>` underneath
 * the media. Keep it short (≤ ~120 chars) — anything longer belongs
 * in the surrounding prose, not the figure.
 */
export function InlineMedia({
  src,
  alt,
  kind = 'image',
  themeAware = false,
  aspectRatio = '16/9',
  caption,
}: {
  src: string;
  alt: string;
  kind?: 'image' | 'video';
  themeAware?: boolean;
  aspectRatio?: HighlightMedia['aspectRatio'];
  caption?: ReactNode;
}) {
  const { effective: effectiveTheme } = useTheme();
  const themeSuffix = effectiveTheme === 'dark' ? 'dark' : 'light';

  const resolvedSrc = useMemo(
    () => resolveMediaSrc({ src, alt, kind, themeAware, aspectRatio }, themeSuffix),
    [src, alt, kind, themeAware, aspectRatio, themeSuffix],
  );

  const [errored, setErrored] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const isVideo = kind === 'video';
  const showMedia = resolvedSrc != null && !errored;

  const openZoom = useCallback(() => {
    if (showMedia) setZoomed(true);
  }, [showMedia]);
  const closeZoom = useCallback(() => setZoomed(false), []);

  if (!resolvedSrc) return null;

  return (
    <figure className="my-4 flex flex-col gap-2">
      <div
        className={cn(
          'border-border bg-surface-muted relative w-full overflow-hidden rounded-[12px] border',
          ASPECT_CLASS[aspectRatio],
        )}
      >
        {showMedia ? (
          <button
            type="button"
            onClick={openZoom}
            aria-label={`${alt} — click to enlarge`}
            className="group relative block h-full w-full cursor-zoom-in overflow-hidden focus-visible:outline-none"
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
                aria-label={alt}
                onError={() => setErrored(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
              />
            ) : (
              <img
                key={resolvedSrc}
                src={resolvedSrc}
                alt={alt}
                loading="lazy"
                decoding="async"
                onError={() => setErrored(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
              />
            )}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
            <span
              aria-hidden
              className="ring-border bg-surface-overlay/85 text-fg/85 pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium opacity-0 ring-1 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <ZoomIn className="h-3 w-3" /> Click to enlarge
            </span>
          </button>
        ) : (
          <div
            role="img"
            aria-label={alt}
            className="bg-surface-raised text-fg-dim flex h-full w-full items-center justify-center text-[11px]"
          >
            Asset failed to load
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="text-fg-dim text-[12px] leading-relaxed">{caption}</figcaption>
      )}
      {zoomed && showMedia && (
        <MediaLightbox
          src={resolvedSrc}
          alt={alt}
          kind={isVideo ? 'video' : 'image'}
          onClose={closeZoom}
        />
      )}
    </figure>
  );
}
