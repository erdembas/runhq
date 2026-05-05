/**
 * Single source of truth for marketing-site SEO copy.
 *
 * Why centralised: every metadata surface (Next `Metadata`, OG,
 * Twitter, JSON-LD `SoftwareApplication`, `WebSite`, `VideoObject`,
 * sitemap, robots) reads the same fields, so a copy edit in one
 * place propagates to every downstream serializer without drift.
 *
 * Keyword strategy (devtool category, VSCode-adjacent positioning):
 *
 *   Tier 1 — own / brandable:
 *     "local-first dev cockpit", "RunHQ"
 *
 *   Tier 2 — comparison / replacement intent (the queries that
 *   convert):
 *     "Foreman alternative", "Overmind alternative",
 *     "Procfile manager", "Docker Compose alternative for local dev",
 *     "Concurrently alternative", "mprocs alternative"
 *
 *   Tier 3 — problem-driven:
 *     "run multiple services locally",
 *     "kill port 3000 macOS", "manage terminal tabs developer",
 *     "process manager Mac Linux Windows"
 *
 *   Tier 4 — adjacency to established devtools (we *complement*,
 *   don't compete with editors):
 *     "VSCode tasks alternative", "Cursor IDE companion",
 *     "JetBrains run configuration", "Tauri devtool", "open source
 *     dev dashboard"
 *
 * The headline copy weaves Tier 1 + Tier 3 naturally; the FAQ +
 * comparison sections carry Tier 2.
 */

export const SITE_URL = 'https://runhq.dev';

export const SITE_NAME = 'RunHQ';

/** ≤ 60 chars. Lead with the verb-stack so SERPs show the value
 *  prop in the first 50 chars on mobile too. */
export const SITE_TITLE = 'RunHQ — Local-first dev cockpit for stacks, logs & ports';

/** ≤ 160 chars. Includes the platform list (macOS · Linux ·
 *  Windows), the licence (MIT), the runtime breadth, and an action
 *  verb. */
export const SITE_DESCRIPTION =
  'RunHQ runs, watches and triages every service on your machine — logs, ports, CVEs, git, AI — in one local cockpit. Free, MIT-licensed, macOS · Linux · Windows.';

/** Short, punchy summary used by OG / Twitter cards (no "macOS ·
 *  Linux · Windows" suffix, social previews already imply
 *  cross-platform). */
export const SITE_SUMMARY =
  'One local-first desktop cockpit for every project, service, log, port, git state, CVE and AI triage on your machine.';

/** OG / Twitter card image. Hosted on the site so social crawlers
 *  hit the same edge cache as the rest of the surface. */
export const SITE_OG_IMAGE = `${SITE_URL}/dashboard.png`;

/** Tagged so JSON-LD blob can reference the same constant
 *  consumed by `<title>`. */
export const SITE_TAGLINE = 'The local dev cockpit.';

/** Canonical YouTube ID powering `<FullDemoSection />` and the
 *  schema.org `VideoObject` blob. */
export const DEMO_YOUTUBE_ID = '9rc44683e1s';

/** ISO 8601 — used by VideoObject `uploadDate`. Hard-coded so the
 *  timestamp doesn't drift with deploys. Update when the demo is
 *  re-recorded. */
export const DEMO_UPLOAD_DATE = '2026-05-05';

/** PT4M50S in ISO 8601 duration format — VideoObject `duration`. */
export const DEMO_DURATION = 'PT4M50S';

export const GITHUB_REPO = 'https://github.com/erdembas/runhq';

/** Comma-free list — the meta `keywords` directive is largely
 *  ignored by Google, but Bing + Yandex still weight it. Keep the
 *  list tight so it stays useful. */
export const SITE_KEYWORDS = [
  'local-first dev cockpit',
  'RunHQ',
  'Foreman alternative',
  'Overmind alternative',
  'Procfile manager',
  'Docker Compose alternative',
  'Concurrently alternative',
  'mprocs alternative',
  'process manager developer',
  'run multiple services locally',
  'kill port macOS',
  'manage terminal tabs',
  'developer dashboard',
  'monorepo runner',
  'AI workspace triage',
  'CVE scanner local',
  'Tauri devtool',
  'open source devtools',
];
