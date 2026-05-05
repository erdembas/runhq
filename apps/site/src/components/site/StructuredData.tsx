import {
  DEMO_DURATION,
  DEMO_UPLOAD_DATE,
  DEMO_YOUTUBE_ID,
  GITHUB_REPO,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OG_IMAGE,
  SITE_SUMMARY,
  SITE_TITLE,
  SITE_URL,
} from '@/lib/seo';

/**
 * Emits all schema.org JSON-LD blobs the marketing surface
 * publishes. Renders inert `<script type="application/ld+json">`
 * tags — they're invisible to humans but parsed by every modern
 * search engine + AI crawler (GPT, Perplexity, Claude) for rich
 * results and citation-eligible snippets.
 *
 * What we publish and why:
 *
 *   1. SoftwareApplication
 *      Eligible for Google's "Software App" rich result. Tells the
 *      crawler this is a downloadable desktop app (price 0,
 *      cross-platform), unlocks the dotted-rating + price chip in
 *      SERP. We don't yet expose `aggregateRating` because there's
 *      no review feed to back it; faking one is a manual-action
 *      risk.
 *
 *   2. Organization
 *      Authoritative entity card — gives Google a stable identity
 *      to attach the GitHub / Twitter / LinkedIn `sameAs` set to.
 *      Powers the right-hand knowledge panel over time.
 *
 *   3. WebSite (with `potentialAction.SearchAction` reserved)
 *      Required for the sitelinks-search-box rich result. We
 *      currently don't ship an in-site search; the action is
 *      stubbed out to keep the schema valid without falsely
 *      promising a search endpoint. Re-enable once a `?q=` route
 *      lands.
 *
 *   4. VideoObject
 *      Wraps the YouTube demo (FullDemoSection) so the embed shows
 *      up as a video result with a thumbnail + duration chip in
 *      Google Video search.
 *
 * Notes:
 *   - All blobs render in the document `<head>`. Next handles that
 *     automatically when the component is mounted from
 *     `app/layout.tsx`.
 *   - `dangerouslySetInnerHTML` is the canonical pattern for
 *     JSON-LD: stringifying through React would HTML-escape the
 *     quotes and break the JSON. The payload is built from
 *     constants, never user input, so the XSS surface is zero.
 */
export function StructuredData() {
  const softwareApplication = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    alternateName: 'RunHQ Cockpit',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    image: SITE_OG_IMAGE,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'IDE / Process Manager',
    operatingSystem: 'macOS, Linux, Windows',
    softwareVersion: 'latest',
    downloadUrl: `${SITE_URL}/#install`,
    installUrl: `${SITE_URL}/#install`,
    screenshot: SITE_OG_IMAGE,
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Auto-discover repos and runtimes',
      'Start services and stacks with one click',
      'Live log tabs with ANSI colour and search',
      'Port watchdog and one-click kill',
      'CVE + outdated dependency scanner',
      'Git status across the workspace',
      'AI workspace triage (BYO endpoint)',
      'Cross-platform native desktop (Tauri + Rust)',
    ],
    keywords:
      'local dev cockpit, foreman alternative, overmind alternative, procfile manager, docker compose alternative, mprocs alternative, process manager, dev dashboard, devtools',
    author: {
      '@type': 'Person',
      name: 'Erdem Baş',
      url: 'https://github.com/erdembas',
    },
  };

  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.png`,
    sameAs: [GITHUB_REPO, 'https://github.com/erdembas'],
  };

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: SITE_TITLE,
    url: SITE_URL,
    description: SITE_SUMMARY,
    inLanguage: 'en',
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  const videoObject = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: 'RunHQ — the full daily loop',
    description:
      'Discover repos, start the stack, chase logs, triage CVEs, ask AI for next actions — captured straight off a real workspace.',
    thumbnailUrl: [
      `https://i.ytimg.com/vi/${DEMO_YOUTUBE_ID}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${DEMO_YOUTUBE_ID}/hqdefault.jpg`,
    ],
    uploadDate: DEMO_UPLOAD_DATE,
    duration: DEMO_DURATION,
    contentUrl: `https://www.youtube.com/watch?v=${DEMO_YOUTUBE_ID}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${DEMO_YOUTUBE_ID}`,
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/icon.png`,
      },
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoObject) }}
      />
    </>
  );
}
