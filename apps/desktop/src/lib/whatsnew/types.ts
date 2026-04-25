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
 * In-component fallback rendered when an image asset is missing or fails
 * to load. The modal layout reserves a fixed-aspect slot for the media,
 * so we always need *something* visible there — even on first ship,
 * before the screenshots are produced.
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
