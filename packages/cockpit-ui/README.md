# `@runhq/cockpit-ui`

Presentational React layer for RunHQ. **Single source of truth** for
every visual primitive that ships in either:

- the **desktop app** (`apps/desktop` — Tauri + React),
- the **marketing site** (`apps/site` — Next.js 15, `runhq.dev`).

Both surfaces import from `@runhq/cockpit-ui` via the pnpm workspace
(`"@runhq/cockpit-ui": "workspace:*"`). Edits land in one place and
propagate to both apps the next time they typecheck — no build step,
no version bumps, no copy-paste drift.

## Why this package exists

Before the split, the desktop app's components were tightly coupled
to the live machinery — Zustand stores, Tauri IPC, dnd-kit, virtualised
log buffers. The marketing site couldn't import them: a static export
running on Cloudflare Pages doesn't have a Tauri runtime to satisfy
the IPC calls, so `npm run build` would crash on a missing
`@tauri-apps/api` import.

The fix was a clean **presentational fork into a workspace package**:

| Layer                            | Lives in                                  |
| -------------------------------- | ----------------------------------------- |
| Pure UI (props-in/callbacks-out) | **`@runhq/cockpit-ui`** (this package)    |
| Tauri IPC, scanners, registry    | `apps/desktop/src-tauri/` (Rust)          |
| Zustand stores, hooks, dnd-kit   | `apps/desktop/src/` (with store wrappers) |
| Marketing fixtures + content     | `apps/site/src/lib/fixtures/`             |

The desktop app composes cockpit-ui primitives into store-binding
wrappers; the marketing site composes the same primitives with mock
fixtures. **The visual contract is identical** — visitors on
`runhq.dev` see real React renders, not screenshots.

## What lives here

```
packages/cockpit-ui/
├── src/
│   ├── components/
│   │   ├── Sparkline.tsx              # primitives — pure, no state
│   │   ├── StatusDot.tsx              # used by every cockpit surface
│   │   ├── StatusPill.tsx
│   │   ├── ResourceBadge.tsx
│   │   ├── GitStatusTrigger.tsx
│   │   ├── RuntimeBadge.tsx
│   │   │
│   │   ├── CockpitChrome.tsx          # marketing-grade composites —
│   │   ├── WorkspaceSidebar.tsx       # mirror the desktop app's
│   │   ├── ServiceCard.tsx            # visual surface but skip the
│   │   ├── LogTerminalMock.tsx        # live Zustand + IPC machinery.
│   │   ├── ActivityTimeline.tsx       # When apps/desktop refactors
│   │   ├── AiPromptMock.tsx           # to a prop-driven shape, the
│   │   │                              # desktop versions get deleted
│   │   │                              # in favour of these.
│   │   │
│   │   ├── DesktopDashboard.tsx       # full-fidelity dashboard mock —
│   │   ├── TitleBar.tsx               # composes everything above
│   │   ├── MainTabBar.tsx             # into one prop-driven shell.
│   │   ├── StatusBar.tsx              # The marketing site's
│   │   ├── RightActivityRail.tsx      # `<DesktopDashboard />` is a
│   │   ├── DashboardHeader.tsx        # 1:1 visual mirror of what
│   │   ├── DashboardServiceCard.tsx   # users see after `runhq`
│   │   └── RunningHotPanel.tsx        # launches.
│   │
│   ├── lib/
│   │   ├── cn.ts                      # local clsx wrapper
│   │   ├── format.ts                  # formatBytes, formatPercent
│   │   └── resourceTone.ts            # cpuToneClass, memoryToneClass
│   │
│   └── index.ts                       # barrel export — single import
│                                       # surface for both apps
│
└── styles/
    └── theme.css                      # design-token CSS variables
                                        # (light / dark surfaces, accent
                                        # palette, status colours).
                                        # Imported by both apps so the
                                        # palette is bit-for-bit identical
                                        # across the desktop window and
                                        # the marketing site.
```

## What does NOT live here

- **Tauri / IPC code** — stays in `apps/desktop/src-tauri/` (Rust) and
  `apps/desktop/src/lib/ipc.ts`. Cockpit-ui is platform-agnostic.
- **Zustand stores** — stay in `apps/desktop/src/state/`. Components
  here accept callbacks (`onToggleStatus`, `onRestart`, `onSelect`),
  the desktop app wires them to store actions.
- **Mock fixtures** — live in `apps/site/src/lib/fixtures/`. Cockpit-ui
  components have no fixture data baked in — you always pass props.
- **App routing / metadata** — stays in `apps/site/src/app/` (Next.js).

## Adding a new component

1. Create the file under `src/components/` and prefix it `'use client'`
   if it touches React hooks or DOM events. Most cockpit-ui components
   are client components — the marketing site's RSC boundary is at the
   section level, primitives sit below it.
2. Export from `src/index.ts`. Both apps import from the barrel.
3. **Do NOT import from `apps/desktop` or `apps/site`** — cockpit-ui
   is the leaf package. Anything you depend on must come from inside
   this package, from `@runhq/cockpit-types`, or from a public npm
   package.
4. **Do NOT import Tauri APIs.** The site build must succeed without a
   Tauri runtime. If you genuinely need Tauri, the component belongs
   in `apps/desktop/src/` as a wrapper around a cockpit-ui primitive.

## Theming

Every component reads colours through CSS variables defined in
`styles/theme.css`:

```css
--accent: 251 146 60; /* RGB triplet, used as rgb(var(--accent)) */
--surface: 12 12 12;
--fg: 245 245 245;
--status-running: 34 197 94;
--status-error: 239 68 68;
/* … */
```

Both apps `@import "@runhq/cockpit-ui/styles/theme.css"` at the top of
their global stylesheet, so a token edit (e.g. accent → blue) recolours
the desktop app and the marketing site together on the next reload.

## Tailwind v4 + JIT

Tailwind v4's content scanner only walks the consumer project tree by
default. Both apps include this `@source` directive in their global CSS
so Tailwind sees the classes used inside cockpit-ui:

```css
@source '../../../../packages/cockpit-ui/src/**/*.{ts,tsx}';
```

If you add a new component using a class neither app has used before
(e.g. `bg-status-attention`), make sure the class name is referenced
literally somewhere in source. Dynamic class strings (`bg-${status}`)
are invisible to the scanner — Tailwind v4 will silently tree-shake
them. The pattern is to define a tone map at module scope and pick
keys from it (see `lib/resourceTone.ts`).

## Two surfaces, one package — what to remember

| Edit                                        | Effect                                         |
| ------------------------------------------- | ---------------------------------------------- |
| `<Sparkline>` colour                        | Desktop graph + marketing demo update together |
| `<DashboardServiceCard>` action button copy | Hero dashboard + Features card update together |
| `theme.css` accent token                    | Every surface re-tints on next reload          |
| `index.ts` barrel — remove an export        | Both apps' typecheck breaks until both updated |

When in doubt: **edit cockpit-ui first, see both apps update, then
write the wrapper if any.** That's the workflow that keeps the
desktop / marketing visual contract from drifting.
