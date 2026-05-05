import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// Same `force-static` requirement as `app/robots.ts` — Next's
// static-export mode demands the route declare itself static so
// the build pipeline can serialise `sitemap.xml` to disk.
export const dynamic = 'force-static';

/**
 * Sitemap for the marketing surface.
 *
 * RunHQ ships a single canonical route at `/` today, but the
 * landing page has six anchor-addressable sections that double as
 * landing targets for "X alternative" / "how to Y" queries:
 *
 *   - `#demo`          — full-length narrated demo (YouTube embed)
 *   - `#alternatives`  — comparison table, ranks for X-alternative
 *                         queries
 *   - `#loop`          — product-loop interactive tour
 *   - `#why`           — value-prop comparison
 *   - `#features`      — feature grid
 *   - `#install`       — download matrix
 *   - `#faq`           — FAQ block, paired with FAQPage JSON-LD
 *
 * Most search engines treat anchors as section hints rather than
 * separate URLs, but listing them in the sitemap (a) signals
 * priority to the robots and (b) sets us up for sitelinks in the
 * SERP without us having to ship per-section pages.
 *
 * `lastModified` is `new Date()` so a redeploy bumps the timestamp
 * — Cloudflare Pages will rebuild this file on every deploy
 * because it's emitted at build-time by `next export`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/#demo`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/#alternatives`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/#loop`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/#why`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/#features`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/#install`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/#faq`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.75,
    },
  ];
}
