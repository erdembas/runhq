/**
 * Public surface of the "What's New" module.
 *
 * Centralised export so call sites import from a single barrel and we
 * can reorganise the internal layout (data files, registry, trigger)
 * without churning every consumer.
 */
export type {
  CalloutTone,
  DocumentRelease,
  Highlight,
  HighlightBadge,
  HighlightCta,
  HighlightFallback,
  HighlightMedia,
  LegacyHighlightsRelease,
  ReleaseHook,
  ReleaseSection,
  ReleaseSubsection,
  WhatsNewActionId,
  WhatsNewRelease,
} from './types';
export { WHATS_NEW_RELEASES, getAllReleases, getLatestRelease, getReleaseFor } from './registry';
export { getLastSeenVersion, markVersionSeen, resetWhatsNewSeen, shouldAutoShow } from './trigger';
