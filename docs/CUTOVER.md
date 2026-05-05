# runhq.dev cutover — `docs/` → `apps/site/`

This file documents how to flip the production runhq.dev deploy from
the legacy static `docs/index.html` to the new Next.js cockpit-driven
site under `apps/site/`. Both versions can coexist in `main` until the
Cloudflare Pages dashboard is updated; the cutover itself is one
settings change with a 30-second rollback path.

## What changed

| Area             | Legacy (`docs/`)                       | New (`apps/site/`)                                                |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Source           | hand-rolled `index.html` + `style.css` | Next.js 15 App Router (`output: 'export'`)                        |
| Cockpit demos    | `.lc-*` mocks built from inline JS     | real `@runhq/cockpit-ui` React components fed mock fixtures       |
| Release version  | runtime fetch of api.github.com        | build-time fetch in `apps/site/src/lib/release.ts` (no runtime)   |
| Headers          | `docs/_headers`                        | `apps/site/_headers` — drops `connect-src https://api.github.com` |
| Pages Functions  | `docs/functions/api/updates`           | unchanged — `scripts/site-postbuild.mjs` carries them over        |
| CI build command | none (static)                          | `pnpm install && pnpm site:build`                                 |
| CI output dir    | `docs/`                                | `apps/site/out/`                                                  |

## Cloudflare Pages settings change

In the Cloudflare dashboard, project **runhq-dev** (or whatever the
runhq.dev project is named):

1. Pages → Settings → Builds & deployments → Build configurations:
   - **Build command:** `pnpm install --frozen-lockfile && pnpm site:build`
   - **Build output directory:** `apps/site/out`
   - **Root directory:** repo root (leave blank).
2. Pages → Settings → Environment variables (Production):
   - **NODE_VERSION** = `22` (matches `package.json` `engines.node`).
   - **PNPM_VERSION** = `9.14.4` (matches `packageManager` field).
3. Pages → Deployments → Retry deployment (or push a no-op commit).

After the next deploy succeeds, browse runhq.dev and verify:

- The hero loads with the cockpit-ui sidebar + service cards (not the
  legacy `.lc-*` mock).
- View source on the rendered HTML — the version pill should be inlined
  (e.g. `v0.10.1`), not the `v0.9.0` build-time fallback.
- `_headers` (via `curl -I`) shows
  `Content-Security-Policy: ... connect-src 'self'; ...` — no api.github.com.
- `/api/updates` still returns the Tauri updater manifest (Cloudflare
  Pages Functions kept working).

## Rollback (≤ 30 seconds)

If anything looks wrong after cutover:

1. Cloudflare dashboard → Settings → Builds & deployments:
   - **Build command:** _(blank)_
   - **Build output directory:** `docs`
2. Pages → Deployments → Retry the previous successful build (or push
   any commit).

The legacy `docs/index.html` and `docs/_headers` are intentionally
left in `main` until a follow-up PR removes them, so the rollback
deploys cleanly with no further code changes.

## Removing the legacy tree (follow-up PR, after stable cutover)

Once runhq.dev has been on `apps/site/` for ~2 weeks with no rollback,
a separate PR can:

1. Delete `docs/index.html`, `docs/style.css`, `docs/dashboard.png`
   (now also lives in the carry-over list and could be moved into
   `apps/site/public/` to fingerprint).
2. Update `scripts/site-postbuild.mjs` `carryOver` to point its asset
   sources at `apps/site/public/` (or fold them into Next's static
   pipeline outright).
3. Drop this CUTOVER.md.

`docs/functions/` (Pages Functions) and `docs/RELEASING.md`,
`docs/KNOWN_ISSUES.md` etc. are NOT scheduled for removal — those
serve operational runbooks and are unrelated to the marketing site.
