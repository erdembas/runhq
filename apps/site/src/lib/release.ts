/**
 * Latest GitHub release metadata, resolved at build time.
 *
 * The legacy docs/index.html shipped a runtime fetch against
 * `https://api.github.com/repos/erdembas/runhq/releases/latest`,
 * which forced `connect-src https://api.github.com` into the
 * Cloudflare CSP and added a network round-trip to every visit.
 * Resolving the version at build time lets us:
 *
 *   - Drop the api.github.com allowlist from the CSP entirely
 *     (Phase 4 cuts that line out of `_headers`).
 *   - Inline the version label into the static HTML, so the hero
 *     pill paints with the right text on the LCP frame instead of
 *     popping in 200ms later.
 *   - Rewrite every download anchor's href to the versioned bundle
 *     URL at build time, with the static
 *     `releases/latest/download/...` alias as a hard-coded
 *     fallback if the GitHub fetch ever fails.
 *
 * If the API is unreachable during build (offline, rate limit, CI
 * proxy) we silently fall back to a sensible default — Cloudflare
 * Pages re-builds on every push, so the next deploy will refresh.
 */

const ENDPOINT = 'https://api.github.com/repos/erdembas/runhq/releases/latest';
const FALLBACK_VERSION = 'v0.10.0';

export interface ReleaseAsset {
  /** Raw asset filename, e.g. `RunHQ_0.10.1_aarch64.dmg`. */
  name: string;
  /** Direct download URL the GitHub release CDN serves. */
  browser_download_url: string;
}

export interface ReleaseInfo {
  /** Human-facing tag, e.g. `v0.10.1`. */
  version: string;
  /** Resolved asset list — empty when the build couldn't reach GitHub. */
  assets: ReleaseAsset[];
}

interface RawRelease {
  tag_name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

let cached: ReleaseInfo | null = null;

/**
 * Resolve once per build (Next caches the module across page renders
 * within a single `next build` invocation). Returns synthetic data on
 * any failure so the page never throws on missing connectivity.
 */
export async function getReleaseInfo(): Promise<ReleaseInfo> {
  if (cached) return cached;

  try {
    const res = await fetch(ENDPOINT, {
      headers: { Accept: 'application/vnd.github+json' },
      // Cache for 1h so re-invocations within a CI window don't waste
      // the 60-req anonymous quota; Cloudflare Pages builds run on
      // single-worker images so this is per-build effectively.
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`release fetch ${res.status}`);
    const data = (await res.json()) as RawRelease;
    const tag = (data.tag_name ?? '').trim();
    const version = tag ? (tag.startsWith('v') ? tag : `v${tag}`) : FALLBACK_VERSION;
    const assets: ReleaseAsset[] = (data.assets ?? [])
      .filter(
        (a): a is { name: string; browser_download_url: string } =>
          typeof a.name === 'string' && typeof a.browser_download_url === 'string',
      )
      .map((a) => ({ name: a.name, browser_download_url: a.browser_download_url }));
    cached = { version, assets };
  } catch {
    // Sealed off — every download anchor has a static
    // `releases/latest/download/...` href as the source of truth, so
    // the page degrades to "current version" links when the fetch
    // fails (offline build, CI proxy, GitHub rate limit).
    cached = { version: FALLBACK_VERSION, assets: [] };
  }

  return cached;
}

/**
 * Map an asset suffix (e.g. `_aarch64.dmg`) onto the matching
 * `browser_download_url` from the release manifest. Returns the
 * caller-supplied `fallback` when the asset isn't present.
 *
 * Same semantics as the legacy inline resolver: skip `.sig` files,
 * match on `endsWith` so the call sites can stay declarative about
 * each bundler's arch vocabulary.
 */
export function resolveAssetHref(release: ReleaseInfo, suffix: string, fallback: string): string {
  const hit = release.assets.find((a) => !a.name.endsWith('.sig') && a.name.endsWith(suffix));
  return hit?.browser_download_url ?? fallback;
}
