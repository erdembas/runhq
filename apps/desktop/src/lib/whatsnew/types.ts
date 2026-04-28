/**
 * "What's New" release-highlights schema + registry.
 *
 * The data model is intentionally separate from CHANGELOG.md:
 *
 *   • CHANGELOG is the developer-facing record — every fix, refactor, and
 *     dependency bump goes there. It's grep-able, conventional-commits
 *     friendly, and parsed by release tooling.
 *
 *   • This module is the end-user-facing pitch — three or four curated
 *     highlights per release, each with a media asset and a CTA that drops
 *     the user straight into the new feature. Trying to derive one from
 *     the other always loses something (tone in one direction, density
 *     in the other), so we keep them as independent surfaces and let the
 *     CHANGELOG link out from the modal footer.
 *
 * New releases are added to {@link WHATS_NEW_RELEASES} in descending
 * version order. The {@link getReleaseFor} helper resolves a version
 * string to the matching entry; trigger logic lives in
 * `./trigger.ts` so this file stays a pure content registry.
 */
import type { ReactNode } from 'react';

export type HighlightBadge = 'new' | 'improved' | 'fix';

/**
 * One row in the bullet-grid fallback variant.
 *
 * Each bullet is a tiny "feature card" — icon + label + optional caption.
 * Used by collection-style highlights (e.g. a "polish" release with six
 * tiny upgrades) where there is no single screenshot that tells the
 * story; trying to put a `1024×576` empty splash there reads as
 * unfinished, not minimal.
 */
export interface HighlightFallbackBullet {
  /** Lucide icon node, rendered ~16px. */
  icon: ReactNode;
  /** One-line label (≤ ~28 chars) — the "what shipped". */
  label: string;
  /** Optional second line — keyboard chord, scope, etc. (≤ ~36 chars). */
  sub?: string;
}

/**
 * In-component fallback rendered when an image asset is missing or fails
 * to load. The modal layout reserves a fixed-aspect slot for the media,
 * so we always need *something* visible there — even on first ship,
 * before the screenshots are produced.
 *
 * Two display modes:
 *
 *   • **splash** (default) — tinted gradient + centered icon + caption.
 *     Use when there *is* a real screenshot coming later or the highlight
 *     is conceptually a single thing ("Open Dashboard").
 *
 *   • **bullets** — when `bullets` is supplied, the slot becomes a 2×N
 *     grid of micro feature cards. Use for "collection" highlights
 *     (polish, quality-of-life) where a single image would lie about
 *     the scope. The icon + caption still render as a header above
 *     the grid, smaller than the splash variant.
 */
export interface HighlightFallback {
  /** Icon component slot — the modal supplies a Lucide icon by name. */
  icon: ReactNode;
  /** Short caption rendered under the icon (≤ 32 chars). */
  caption: string;
  /**
   * Tint key. Mapped to a CSS gradient inside the modal so we don't
   * leak Tailwind class strings into data files.
   */
  tint: 'accent' | 'sky' | 'violet' | 'emerald' | 'amber';
  /**
   * Optional bullet grid. Presence flips the slot into the bullets
   * variant. Recommended length: 4–8 bullets. Beyond 8 the cards
   * shrink past readability; trim or split into two highlights.
   */
  bullets?: HighlightFallbackBullet[];
}

export interface HighlightMedia {
  /**
   * Path under `/whatsnew/<version>/`. Leave undefined to force the
   * fallback visual — useful while assets are still being captured.
   * Theme-aware variants are supported via the `themeAware` flag: when
   * true, the modal swaps the suffix for `-light` / `-dark`.
   */
  src?: string;
  themeAware?: boolean;
  alt: string;
  /**
   * Display aspect ratio. Slot is reserved at this ratio even when
   * the image is still loading or has fallen back, to avoid CLS.
   */
  aspectRatio: '16/9' | '4/3' | '1/1';
  /**
   * Asset kind. Drives both file-extension resolution and the DOM
   * element used to render the slot.
   *
   *   • `'image'` (default) — `${src}.webp` rendered as `<img>`. This
   *     matches how every release prior to 0.9.0 was authored, so
   *     omitting the field keeps existing entries working unchanged.
   *
   *   • `'video'` — `${src}.webm` rendered as `<video autoplay muted
   *     loop playsinline>`. Use for highlights where motion tells the
   *     story (drag-to-reorder, search-as-you-type, terminal zoom).
   *     Encoded as VP9 / Opus and capped well under the WebP-equivalent
   *     bundle budget; see `apps/desktop/public/whatsnew/0.9.0/README.md`
   *     for the capture + encode commands.
   *
   * Theme-aware variants follow the same naming as images — when
   * `themeAware` is true the modal appends `-light` / `-dark` before
   * the extension, so `<slug>-light.webm` + `<slug>-dark.webm`.
   *
   * Lightbox / click-to-zoom is image-only by design — videos already
   * play in place, and there's nothing meaningful to enlarge.
   */
  kind?: 'image' | 'video';
}

export type HighlightCta =
  | { kind: 'store-action'; label: string; actionId: WhatsNewActionId }
  | { kind: 'external'; label: string; href: string };

/**
 * Allow-list of in-app actions a CTA may invoke. Resolving to an
 * explicit id (rather than passing closures through data files) keeps
 * the registry serialisable and keeps the modal from having to import
 * every feature panel.
 */
export type WhatsNewActionId =
  | 'open-overview'
  | 'open-cross-project-diff'
  | 'open-timeline'
  | 'open-ai-chat'
  | 'open-ai-settings'
  | 'open-changelog';

export interface Highlight {
  id: string;
  title: string;
  badge?: HighlightBadge;
  blurb: string;
  media: HighlightMedia;
  fallback: HighlightFallback;
  cta?: HighlightCta;
}

export interface WhatsNewRelease {
  version: string;
  releasedAt: string;
  /** Single-line tagline rendered under the title. */
  headline: string;
  highlights: Highlight[];
  /** External link surfaced as "Read full changelog" in the modal footer. */
  changelogUrl: string;
  /**
   * When true the modal will auto-show even on patch upgrades. Default
   * (false) means patches are silent — bug-fix-only releases shouldn't
   * shove a modal in the user's face.
   */
  showOnPatch?: boolean;
}
