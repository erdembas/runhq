/**
 * Registry of all shipped "What's New" releases.
 *
 * Order: newest first. The default entry surfaced by {@link getLatestRelease}
 * is the head of this list — that's what pops up post-update and what the
 * "View What's New" entry point opens by default.
 */
import { release_0_6_0 } from './data/0.6.0';
import type { WhatsNewRelease } from './types';

export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [release_0_6_0];

export function getLatestRelease(): WhatsNewRelease | null {
  return WHATS_NEW_RELEASES[0] ?? null;
}

export function getReleaseFor(version: string): WhatsNewRelease | null {
  const normalised = normaliseVersion(version);
  return WHATS_NEW_RELEASES.find((r) => normaliseVersion(r.version) === normalised) ?? null;
}

/** Strips a leading `v` so `v0.6.0` and `0.6.0` are interchangeable. */
function normaliseVersion(v: string): string {
  return v.replace(/^v/i, '').trim();
}
