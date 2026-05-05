#!/usr/bin/env node
/**
 * Post-build glue between `next build` (apps/site/out/) and Cloudflare
 * Pages (which serves whatever directory we point its build settings
 * at, plus `_headers`, `_redirects`, and `functions/`).
 *
 * Next's static export does not know about:
 *   - `_headers` / `_redirects` (Cloudflare Pages metadata)
 *   - `functions/` (Pages Functions — currently `/api/updates`)
 *   - the legacy static binaries we still link from the marketing
 *     copy (`dashboard.png`, `RunHQ-web-version-final.mp4`, the
 *     manifest favicon, robots/sitemap)
 *
 * We could move these into `apps/site/public/` so Next copies them
 * automatically — but they live with the legacy site for now so a
 * Phase 4 rollback (`cf-pages output dir → docs/`) keeps working
 * without any file moves. Until cutover ships, this script is the
 * single source of truth for the `out/` payload shape.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const docsDir = path.join(repoRoot, 'docs');
const siteDir = path.join(repoRoot, 'apps', 'site');
const outDir = path.join(siteDir, 'out');

/**
 * Files / directories to copy into the freshly-built
 * `apps/site/out/`. Each entry is checked against the search roots in
 * order — we look in `apps/site/` first so site-specific overrides
 * (currently `_headers`, which ships a tighter CSP than the legacy
 * one) win over their `docs/` equivalents. Adding an asset to
 * `apps/site/` automatically retires the docs/ copy from the new
 * deploy without needing a code change here.
 *
 * Note on `icon.png` / `dashboard.png`: these now live in
 * `apps/site/public/` so Next's dev server (`next dev`) and static
 * export (`next export`) both find them at `/icon.png` and
 * `/dashboard.png` without this script needing to do anything. The
 * `docs/` copies are kept as a Phase-4 rollback safety net only —
 * if the Pages output dir is ever flipped back to `docs/`, the
 * legacy URLs still resolve. Because Next already wrote both files
 * into `out/` from `public/`, this script no longer needs explicit
 * carryOver entries for them.
 *
 * `optional: true` lets us add aspirational entries (e.g. a future
 * `_redirects`) without breaking CI when the file isn't present yet.
 */
const searchRoots = [siteDir, docsDir];
const carryOver = [
  { src: '_headers', dest: '_headers' },
  { src: 'robots.txt', dest: 'robots.txt' },
  { src: 'sitemap.xml', dest: 'sitemap.xml' },
  { src: 'RunHQ-web-version-final.mp4', dest: 'RunHQ-web-version-final.mp4' },
  // Note: the VP9 webm pair (`runhq-hero-loop.webm`,
  // `runhq-full-demo.webm`) is served from cdn.runhq.dev directly —
  // see Hero.tsx and FullDemoSection.tsx. Keeping them off the Pages
  // payload means the static export stays under the per-deploy
  // 25 MB soft cap and the visitor pulls media from a CDN that's
  // tuned for byte-range video traffic.
  { src: 'functions', dest: 'functions', recursive: true },
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findSource(name) {
  for (const root of searchRoots) {
    const candidate = path.join(root, name);
    if (await exists(candidate)) return { path: candidate, root };
  }
  return null;
}

async function copyEntry(entry) {
  const found = await findSource(entry.src);
  const dest = path.join(outDir, entry.dest);

  if (!found) {
    if (entry.optional) return { skipped: true, src: entry.src, from: null };
    throw new Error(
      `[site-postbuild] required source missing: ${entry.src} ` +
        `(searched ${searchRoots.join(', ')}). If the legacy docs/ tree ` +
        `was already removed, fold this asset into apps/site/ (or apps/site/public/ ` +
        `for static files Next should fingerprint) and drop the entry from ` +
        `carryOver.`,
    );
  }

  if (entry.recursive) {
    await fs.cp(found.path, dest, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(found.path, dest);
  }
  return { skipped: false, src: entry.src, from: path.relative(repoRoot, found.root) };
}

async function main() {
  if (!(await exists(outDir))) {
    throw new Error(
      `[site-postbuild] ${outDir} does not exist. Did \`next build\` finish? ` +
        `Run \`pnpm --filter @runhq/site build\` first.`,
    );
  }

  const results = await Promise.all(carryOver.map(copyEntry));
  const copied = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  console.log(`[site-postbuild] copied ${copied.length} entr${copied.length === 1 ? 'y' : 'ies'}:`);
  for (const r of copied) console.log(`  + ${r.src}  ←  ${r.from}/`);
  if (skipped.length > 0) {
    console.log(`[site-postbuild] skipped ${skipped.length} optional:`);
    for (const r of skipped) console.log(`  - ${r.src}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
