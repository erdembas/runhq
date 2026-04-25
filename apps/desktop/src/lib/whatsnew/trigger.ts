/**
 * Auto-show eligibility for the "What's New" modal.
 *
 * Rules — kept deliberately conservative so the modal can never feel
 * like a nag screen:
 *
 *   1. Modal is only shown for the *latest* release we have curated
 *      content for. If the running app jumps multiple minors at once,
 *      we still only show the newest entry — the others will be
 *      browseable from the in-app entry points if we ever add a
 *      history view.
 *
 *   2. Auto-show fires only when the running version is strictly
 *      greater than the last-seen version on (major, minor). Patch
 *      bumps are silent unless the release entry opts in via
 *      {@link WhatsNewRelease.showOnPatch}, because shipping a modal
 *      for a one-line bug-fix release would train users to dismiss
 *      it without reading.
 *
 *   3. First-ever launch (no last-seen recorded) is also silent. New
 *      users get the WelcomeTour, not a release-highlights modal that
 *      assumes prior context. We mark the current version as seen so
 *      the next legitimate update fires correctly.
 *
 * The localStorage layer mirrors `lib/onboarding.ts` — versioned key,
 * safe wrappers around storage access so private-mode / quota errors
 * never crash the trigger path.
 */
import type { WhatsNewRelease } from './types';

const LAST_SEEN_KEY = 'runhq.whatsnew.last-seen.v1';

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(raw: string): SemverParts | null {
  const cleaned = raw.replace(/^v/i, '').trim();
  // Strip any pre-release / build metadata before comparing — we only
  // care about (major, minor, patch). A bare `1.2.3-rc.1` still compares
  // as `1.2.3` for the purposes of "should I show what's new".
  const core = cleaned.split(/[-+]/)[0] ?? '';
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(core);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / quota errors are non-fatal — worst case is we show
    // the modal again next launch, which is still bounded.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op
  }
}

export function getLastSeenVersion(): string | null {
  return safeGet(LAST_SEEN_KEY);
}

export function markVersionSeen(version: string): void {
  safeSet(LAST_SEEN_KEY, version);
}

export function resetWhatsNewSeen(): void {
  safeRemove(LAST_SEEN_KEY);
}

/**
 * Decide whether the modal should auto-show for `installedVersion`.
 *
 * Returns the release to display, or `null` to stay silent. Encapsulates
 * the entire "is this the right moment?" decision so the call site in
 * App.tsx is a one-liner — keeps the noisy semver / first-launch /
 * patch-skip logic out of the React effect.
 */
export function shouldAutoShow(
  installedVersion: string | null,
  release: WhatsNewRelease | null,
): WhatsNewRelease | null {
  if (!installedVersion || !release) return null;

  const installed = parseSemver(installedVersion);
  const target = parseSemver(release.version);
  if (!installed || !target) return null;

  // Don't promote a release the running build hasn't actually delivered
  // yet (e.g. dev preview opening 0.7.0 highlights from a 0.6.0 binary).
  if (compareSemver(installed, target) < 0) return null;

  const lastSeenRaw = getLastSeenVersion();

  // First-ever launch: silent. Stamp the current version so that the
  // *next* upgrade fires legitimately — without this we'd train fresh
  // installs to see a release modal for a version they never lived
  // through, which feels like marketing copy.
  if (!lastSeenRaw) {
    markVersionSeen(installedVersion);
    return null;
  }

  const lastSeen = parseSemver(lastSeenRaw);
  if (!lastSeen) {
    // Corrupt stored value — treat as fresh and recover.
    markVersionSeen(installedVersion);
    return null;
  }

  const cmp = compareSemver(target, lastSeen);
  if (cmp <= 0) return null; // already seen or older

  const isMajorOrMinor = target.major !== lastSeen.major || target.minor !== lastSeen.minor;

  if (!isMajorOrMinor && !release.showOnPatch) return null;

  return release;
}

function compareSemver(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
