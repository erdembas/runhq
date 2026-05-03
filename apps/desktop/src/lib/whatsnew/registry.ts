/**
 * Registry of all shipped "What's New" releases.
 *
 * Order: newest first. The default entry surfaced by {@link getLatestRelease}
 * is the head of this list — that's what pops up post-update and what the
 * "View What's New" entry point opens by default.
 */
import { release_0_6_0 } from './data/0.6.0';
import { release_0_7_0 } from './data/0.7.0';
import { release_0_9_0 } from './data/0.9.0';
import { release_0_10_0 } from './data/0.10.0';
import { release_0_10_3 } from './data/0.10.3';
import type { WhatsNewRelease } from './types';

export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [
  release_0_10_3,
  release_0_10_0,
  release_0_9_0,
  release_0_7_0,
  release_0_6_0,
];

export function getLatestRelease(): WhatsNewRelease | null {
  return WHATS_NEW_RELEASES[0] ?? null;
}

export function getReleaseFor(version: string): WhatsNewRelease | null {
  const normalised = normaliseVersion(version);
  return WHATS_NEW_RELEASES.find((r) => normaliseVersion(r.version) === normalised) ?? null;
}

/**
 * Every shipped release in descending version order. Used by the
 * Release History surface, which renders the full archive (timeline
 * on the left, selected entry on the right) so users can revisit any
 * past release after the post-update modal has been dismissed.
 *
 * Returning a new array (rather than the readonly tuple) keeps callers
 * free to filter / slice without TS complaining about mutating the
 * source-of-truth tuple.
 */
export function getAllReleases(): WhatsNewRelease[] {
  return [...WHATS_NEW_RELEASES];
}

/** Strips a leading `v` so `v0.6.0` and `0.6.0` are interchangeable. */
function normaliseVersion(v: string): string {
  return v.replace(/^v/i, '').trim();
}
