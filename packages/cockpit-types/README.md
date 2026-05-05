# `@runhq/cockpit-types`

Type definitions shared between every RunHQ surface.

| Consumer            | Why it imports this package                                         |
| ------------------- | ------------------------------------------------------------------- |
| `apps/desktop`      | Type-checks IPC payloads, Zustand stores, the renderer's prop trees |
| `apps/site`         | Type-checks the mock fixtures that drive the marketing demos        |
| `@runhq/cockpit-ui` | Component prop types reference these definitions directly           |

There's intentionally no runtime code in this package — it's
`.d.ts`-equivalent only. That keeps the dependency graph honest:
cockpit-ui has zero risk of accidentally pulling marketing-site or
desktop-app code through a transitive import chain.

## What lives here

```
packages/cockpit-types/src/
├── serviceTypes.ts        # ServiceDef, ServiceId, Status, Cmd, Env
├── overviewTypes.ts       # ResourceSample, GitInfo, scan summaries
├── …                      # one file per logical domain
└── index.ts               # re-exports the lot
```

## Editing rule

**Add new fields with care.** A type added here is consumed by both
apps simultaneously, so a non-optional addition will break the desktop
app's IPC handlers and the marketing fixtures at the same time. Prefer:

1. Add the field as `field?: T` (optional) first.
2. Update the desktop app's IPC, scanners, and reducers.
3. Update the marketing fixtures.
4. Once both compile, narrow the field to `field: T` (required).

The companion package — [`@runhq/cockpit-ui`](../cockpit-ui/README.md)
— documents the broader monorepo layout and the "single source of
truth" rule.
