import type { Metadata, Viewport } from 'next';
import { StructuredData } from '@/components/site/StructuredData';
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_OG_IMAGE,
  SITE_SUMMARY,
  SITE_TITLE,
  SITE_URL,
} from '@/lib/seo';
import './globals.css';

/**
 * Marketing-site SEO surface.
 *
 * Strategy (devtool category, VSCode-adjacent positioning):
 *   - Title leads with the value prop ("Local-first dev cockpit")
 *     so the SERP first 50 chars communicates the verb-stack, then
 *     drops a keyword cluster (stacks / logs / ports). Brand goes
 *     up front because direct-nav queries already type "runhq".
 *   - Description is action-led, packs OS coverage + licence + the
 *     four nouns (logs, ports, CVEs, AI) we actually compete on.
 *     Stays under 160 chars so it doesn't get truncated on mobile
 *     SERPs.
 *   - `title.template` ('%s · RunHQ') reserves a clean per-page
 *     pattern for future routes (/blog, /vs/foreman, /docs) without
 *     having to revisit this file.
 *   - `metadataBase` resolves every relative URL — sitemap, OG
 *     images, alternates — so a missed `https://` doesn't crash a
 *     social crawler.
 *   - `robots.googleBot.max-image-preview: 'large'` is the magic
 *     directive that unlocks the dashboard hero image as a
 *     full-bleed Google Discover card.
 *   - JSON-LD lives in `<StructuredData />` (rendered once at the
 *     root). Schema set: SoftwareApplication, Organization,
 *     WebSite, VideoObject. FAQPage ships separately from the FAQ
 *     section so each Q/A stays co-located with its source.
 *
 * The legacy docs/index.html stays in the tree as the fallback
 * deploy target — its `<head>` is allowed to drift now that the
 * Next build is the canonical surface.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Erdem Baş', url: 'https://github.com/erdembas' }],
  creator: 'Erdem Baş',
  publisher: SITE_NAME,
  category: 'developer-tools',
  keywords: SITE_KEYWORDS,
  alternates: {
    canonical: SITE_URL,
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  // The default robots policy is "index, follow"; we make it
  // explicit + opt into Google's larger image preview so the
  // dashboard screenshot can carry the listing on Discover.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'en_US',
    title: SITE_TITLE,
    description: SITE_SUMMARY,
    images: [
      {
        url: SITE_OG_IMAGE,
        width: 3606,
        height: 2480,
        alt: 'RunHQ dashboard — local projects, status chips, port watchdog and AI triage panel',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_SUMMARY,
    images: [SITE_OG_IMAGE],
    creator: '@erdembas',
  },
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png', sizes: '512x512' }],
    apple: '/icon.png',
    other: [{ rel: 'mask-icon', url: '/icon.png', color: '#FB923C' }],
  },
  other: {
    // Apple-specific PWA-style hints — RunHQ is a desktop app, but
    // the marketing site itself benefits from the standalone
    // appearance on mobile bookmark launches.
    'apple-mobile-web-app-title': SITE_NAME,
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0b',
  width: 'device-width',
  initialScale: 1,
  // Don't trap zoom — the WCAG accessibility win outweighs the
  // "more polished feel" of locked viewports.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        {/*
         * Font preconnect + stylesheet match the legacy
         * docs/index.html. Static-export ships these as plain
         * <link> tags — Next does not inline Google Fonts in
         * `output: 'export'` mode unless `next/font/google` is
         * used, which we deliberately avoid here so the marketing
         * surface ships *zero* runtime font loader JS (every byte
         * counts on the LCP frame).
         */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <StructuredData />
      </head>
      <body>{children}</body>
    </html>
  );
}
