/**
 * Static-export config tuned for Cloudflare Pages.
 *
 * - `output: 'export'` makes `next build` write a fully static
 *   site to `out/` — no Node runtime needed at the edge, which
 *   keeps us on the existing Cloudflare Pages "static asset"
 *   pipeline that the docs/ tree already uses.
 * - `images: { unoptimized: true }` is mandatory for static
 *   export; the `next/image` loader otherwise needs a Node
 *   runtime to resize on the fly.
 * - `trailingSlash: true` makes every page serialise to
 *   `<route>/index.html` rather than `<route>.html`. Cloudflare
 *   Pages serves both shapes, but the slash variant is what
 *   `_headers` glob rules and Pages Functions expect, and it
 *   matches the existing `docs/` structure (root `index.html`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // Pin Next's workspace-root inference to the monorepo root.
  // Without this, Next walks up the parent directories looking for a
  // lockfile and (on this machine) latches onto a stray
  // ~/package-lock.json, which makes file tracing scan unrelated trees
  // and prints a noisy warning on every build.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // Phase 1+ will add presentational packages from the workspace
  // here; transpilePackages tells Next to run them through SWC even
  // though they're imported as raw .ts/.tsx (no build step in the
  // package itself).
  transpilePackages: ['@runhq/cockpit-ui', '@runhq/cockpit-types'],
};

export default nextConfig;
