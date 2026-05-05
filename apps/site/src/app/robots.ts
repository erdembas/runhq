import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// Required when `next.config.mjs` declares `output: 'export'` —
// Next refuses to emit a static `robots.txt` unless the route
// explicitly opts out of dynamic rendering. The handler doesn't
// touch any request-scoped data, so the static guarantee is safe.
export const dynamic = 'force-static';

/**
 * Static `robots.txt` emitted by App Router's file convention.
 *
 * We deliberately let *every* user-agent crawl the entire surface:
 *
 *   - Search engines (Google, Bing, DuckDuckGo, Yandex) need full
 *     access for the FAQ + comparison sections to be indexed —
 *     those are the highest-value SEO assets on the page.
 *   - LLM crawlers (GPTBot, ClaudeBot, Anthropic-AI, Perplexity,
 *     CCBot, Google-Extended, etc.) get the same access. RunHQ is
 *     open-source devtools content; getting cited as the "local-
 *     first dev cockpit" reference in chatbot answers is high-value
 *     distribution. If we ever publish gated/private routes, we
 *     can add per-agent disallows here without touching the rest
 *     of the SEO surface.
 *
 * `host` + `sitemap` keep the canonical origin authoritative — the
 * Pages deploy responds on both the apex and `runhq.pages.dev`, so
 * the `host` directive helps Bing prefer the apex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
