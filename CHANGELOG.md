# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Ships the Cross-Project Dashboard — the killer feature for developers
with dozens of projects. Turns RunHQ from a per-service manager into a
bird's-eye view that answers "which ones are out of date? which have
uncommitted work? which are hogging resources?" without visiting each
project individually.

### Features

- **overview:** cross-project dashboard closing the full
  [#32](https://github.com/erdembas/runhq/issues/32) scope —
  Git Status Matrix, Resource Heatmap, Last Activity Tracker,
  Dependency Outdatedness, Security Alerts, and Filter & Sort all in
  one screen.
- **overview:** two-phase aggregator in `runhq-core::overview`. The
  fast path (git status, resource samples, staleness, tags) returns in
  tens of ms; the opt-in slow path runs `npm outdated` / `cargo
  outdated` / `npm audit` / `cargo audit` in parallel with per-command
  timeouts and memoises results for 5 minutes, so re-opening the
  dashboard or flipping filters never re-spawns scans.
- **overview:** `ProjectDetailDrawer` — a per-project "triage
  cockpit". Severity- and bump-tinted tabs, a **triage rail** where
  tiles double as both count summary *and* filter, multi-select with
  a sticky bulk bar that copies all selected upgrade commands as a
  shell script, in-drawer rescan with scan-freshness indicator, and
  an "Open in…" overflow submenu listing detected editors with a
  Finder/Explorer fallback. Advisory rows keep the external-link
  button persistently visible because reading the GHSA write-up is
  the primary triage action, not a secondary one.
- **overview:** dashboard filter bar restructured into three logical
  chambers — **Organize** (Group / Sort dropdowns) · **Git** (All /
  Dirty / Clean / Ahead / Behind / No upstream) · **Attention**
  (Stale / Risk / Outdated). Each chamber is a single flex-child so
  its label stays glued to its pills; chambers are separated by a
  vertical divider plus a larger `gap-x-5`, so the row reads as three
  distinct units instead of a flat stream of controls.
- **overview:** WorstOffenders band surfaces the top N projects
  weighted by CVE severity × outdated majors; chips are clickable and
  jump straight to the relevant drawer tab.
- **overview:** resource heatmap sorts the running fleet by
  RAM / CPU, non-running projects pushed to the bottom so they never
  wedge between hot ones.
- **ui:** auto-hiding macOS-style scrollbars (visible only during
  scroll), global `cursor: pointer` on interactive elements, floating
  drawer (margin + radius) scoped to the content area so the sidebar
  rail stays visible underneath.

### Deferred

- **Auto-execute upgrade / CVE-fix commands** — intentionally held
  off. A one-click `npm i pkg@latest` can pull breaking majors, shift
  peer deps, rewrite the lockfile, and burn minutes with no obvious
  rollback; responsibility for that decision normally lives in CI,
  tests, and review. The current *copy-as-script* pattern already
  captures ~90% of the value with zero risk surface. If ever
  revisited, the preferred shape is **"Run in RunHQ terminal"**: open
  the embedded terminal with `cwd` set and the command pre-filled but
  *not submitted* — the user sees the exact line and hits Enter
  themselves. See ROADMAP.md §1 for the full reasoning.

### Removed

- **dashboard:** the two 4-up stat grids at the top of the dashboard
  (Running / Starting / Stopped / Failed and CVE / Outdated / Stale /
  Dirty). Each one duplicated information already present in the
  page header summary, the filter bar chips, and the WorstOffenders
  band — on a quiet day they burned ~200px of vertical real estate
  to display mostly zeros, pushing the actual project cards below the
  fold. Their filter affordances survived intact in the filter bar
  chips, which are tighter and more honest about being *filters*.
- **components:** orphaned `StatTile` / `AttentionTile` components
  and their barrel export.
- **components:** old `ProjectDashboard` modal replaced by the
  integrated dashboard + drawer flow.

## [0.6.0](https://github.com/erdembas/runhq/compare/v0.5.1...v0.6.0) (2026-04-23)


### Features

* **timeline:** add Activity Timeline with SQLite persistence and standup export ([#34](https://github.com/erdembas/runhq/issues/34))
* **timeline:** add daily & weekly summaries with project/time filters
* **timeline:** redesign as right drawer with node graph visualization
* **timeline:** hook status and log events to auto-record timeline entries
* **timeline:** add Timeline button to sidebar with clock icon
* **timeline:** integrate clipboard manager and enhance git event tracking

## [0.5.1](https://github.com/erdembas/runhq/compare/v0.5.0...v0.5.1) (2026-04-22)


### Bug Fixes

* **dashboard:** enhance grouping functionality and improve log message format ([d22136a](https://github.com/erdembas/runhq/commit/d22136acf9ffd7ed87968574f8084e487e238d36))
* **docs:** correct hero video HTML structure and format with Prettier ([98b0a86](https://github.com/erdembas/runhq/commit/98b0a86d99f7a0c0216c13049e5df3e682239810))
* **terminal,logs:** use standard terminal colors and fix PTY environment ([8f14e5d](https://github.com/erdembas/runhq/commit/8f14e5d177d25b5c1846b500ea8f5a55b4b59c18))

## [0.5.0](https://github.com/erdembas/runhq/compare/v0.4.0...v0.5.0) (2026-04-22)


### Features

* add interactive hero video modal, update brand logo, and implem… ([ccad62e](https://github.com/erdembas/runhq/commit/ccad62ea33c3db6e8eed09ba9dd6182c2f0c6032))
* add interactive hero video modal, update brand logo, and implement navigation glow effects ([967c4de](https://github.com/erdembas/runhq/commit/967c4def9750f3fd5f8121aeddfb218b482fe812))
* fix and cpu utils ([b310e3e](https://github.com/erdembas/runhq/commit/b310e3e546168a5be86bc287d1af8aba72ab1ab7))
* **git:** add git utility integration ([2d85aa9](https://github.com/erdembas/runhq/commit/2d85aa9ba4cb97fbe980c86f1a5ddbed7be9453e))
* **git:** portal popovers, dashboard git chip, filter bar, compact mode ([76013e8](https://github.com/erdembas/runhq/commit/76013e8e9bc84472b21e27826d1e7c4439016e8f))
* stash pop ([9749c4a](https://github.com/erdembas/runhq/commit/9749c4aaa2043f3a73e1442ce63fda608c2aa82d))

## [0.4.0](https://github.com/erdembas/runhq/compare/v0.3.0...v0.4.0) (2026-04-21)


### Features

* scan wizard, custom context menu, tray actions, full reset, scanner dedup ([1ecaee1](https://github.com/erdembas/runhq/commit/1ecaee1b93f91b2799578f982cb895b27b9e45ec))
* scan wizard, custom context menu, tray actions, full reset, scanner dedup ([531b10a](https://github.com/erdembas/runhq/commit/531b10a085a1f57445f508d4d924ed2e26e19273))
* scan wizard, custom context menu, tray actions, full reset, scanner dedup ([78bbdf0](https://github.com/erdembas/runhq/commit/78bbdf02ace204f6c55f7b4a1294bb45acacbf05))

## [0.3.0](https://github.com/erdembas/runhq/compare/v0.2.3...v0.3.0) (2026-04-20)


### Features

* improve service editor UX and fix release pipeline race ([6d181f0](https://github.com/erdembas/runhq/commit/6d181f0c378f8e6c9250fc10d94ee85954ad4da9))

## [0.2.3](https://github.com/erdembas/runhq/compare/v0.2.2...v0.2.3) (2026-04-20)


### Bug Fixes

* **updater:** recover gracefully when auto-relaunch is blocked ([3ccd35f](https://github.com/erdembas/runhq/commit/3ccd35f2e01807fe30079c4eb2d8f62086088656))


### Documentation

* add apps.json for World Vibe Web and sharpen project-cockpit pitch ([ea1cdce](https://github.com/erdembas/runhq/commit/ea1cdce655583e8a9ee9fa584def80ba109cb415))

## [0.2.2](https://github.com/erdembas/runhq/compare/v0.2.1...v0.2.2) (2026-04-20)


### Bug Fixes

* dismiss QuickAction on click-outside and cross-platform shortcut bindings ([46c60b7](https://github.com/erdembas/runhq/commit/46c60b701fc4129444720e61c4f06ae97298f158))
* dismiss QuickAction on click-outside and cross-platform shortcut bindings ([9c005ae](https://github.com/erdembas/runhq/commit/9c005ae44d921e3ec3663b5da510895cf0759e0c))


### Code Refactoring

* split Port Manager into App Ports and System Ports sections ([04dde9c](https://github.com/erdembas/runhq/commit/04dde9c5409f383bc4d948057bb79350bc57185c))
* split Port Manager into App Ports and System Ports sections ([83f555f](https://github.com/erdembas/runhq/commit/83f555fae77d3bc066d89ac9553a8520eae2a91e))

## [0.2.1](https://github.com/erdembas/runhq/compare/v0.2.0...v0.2.1) (2026-04-20)


### Bug Fixes

* **docs:** update hero link in index.html to point to the contact page ([c56351f](https://github.com/erdembas/runhq/commit/c56351fca9f808cced1d510790520f569524287c))


### Code Refactoring

* **App:** remove update check logic and integrate UpdateBanner component ([8ffcab8](https://github.com/erdembas/runhq/commit/8ffcab85dad0cf45e8d1448bad0a053d170effd0))
* **App:** remove update check logic and integrate UpdateBanner component ([7a38e58](https://github.com/erdembas/runhq/commit/7a38e581c88c9d94a1321e7a50422d084752d6c6))

## [0.2.0](https://github.com/erdembas/runhq/compare/v0.1.3...v0.2.0) (2026-04-20)

This release is a major UX polish pass on the Quick Action palette plus
robust cross-platform editor detection — "Open in VS Code / Cursor /
Windsurf" now works reliably even when the CLI shim isn't on `$PATH`,
and the command palette finally reads like a native macOS Spotlight-
class overlay.

### Features

* **editors:** cross-platform editor detection on macOS, Windows, and
  Linux — scans canonical install locations (`/Applications`,
  `%LOCALAPPDATA%\Programs`, `/snap/bin`, `/var/lib/flatpak/exports/bin`,
  `/opt/<app>/<app>`) instead of relying on `$PATH`. VS Code, Cursor,
  and Windsurf are now discovered for users who never ran the manual
  "Shell Command: Install 'code' command in PATH" step.
  ([dfa2391](https://github.com/erdembas/runhq/commit/dfa23913c2cac8d80f730d9808e08db5c27106cf))
* **quick-action:** native-feeling command palette overhaul.
  ([a866eeb](https://github.com/erdembas/runhq/commit/a866eeb40e098322d6367f09dce95bf3bf96f511),
  [07eba03](https://github.com/erdembas/runhq/commit/07eba0390628a4353d1b792926dd70957dd7a17d))
  * Re-centers on the monitor owning the main RunHQ window on every
    show, with the window size clamped to the monitor's logical bounds
    so the palette never renders off-screen on 13" MacBook Air
    (1280×800) setups.
  * Panel is vertically centered with a subtle upward bias (Raycast /
    Spotlight convention) instead of the previous top-anchored
    `pt-[18vh]` layout.
  * Native-feeling search input: 15px type, tighter letter-spacing,
    `autoCorrect` / `autoCapitalize` disabled so service and command
    names aren't auto-munged while typing.
  * The perpetual accent-colored focus ring that the global
    `*:focus-visible` rule was drawing around the always-focused input
    is suppressed via unlayered CSS — correctly beating Tailwind v4's
    `@layer utilities` emission model.
  * Removed the redundant right-side kbd hints (`↹ filter` / `← back`)
    next to the input — the footer already surfaces the same shortcuts
    and the duplication was pure visual noise.

### Bug Fixes

* **quick-action:** restore first action row + add "Actions" section
  header — fixes two tightly-coupled palette bugs: the first
  app-action ("Open RunHQ") being clipped by the filter bar border on
  mount (the cursor-sync `scrollIntoView` was scrolling it out of
  view), and app-actions silently bleeding into Stacks/Services
  without a grouping label. Actions / Stacks / Services now read as
  three distinct bands.
  ([5c612f8](https://github.com/erdembas/runhq/commit/5c612f8cba7c67f841f3ce75ed3a693939efe9cf))
* **quick-action:** suppress the macOS show/key-window blur race — the
  palette no longer opens and immediately closes itself when triggered
  while the main RunHQ window is focused. A 250ms post-show grace
  window now swallows the transient `Focused(false)` event that
  transparent/borderless NSWindows fire between `show()` returning and
  the window actually becoming the key window. Same pattern Raycast /
  Alfred / Spotlight use; legitimate click-away dismissal is
  preserved.
  ([d4cc6c9](https://github.com/erdembas/runhq/commit/d4cc6c973dc6da5230184c9ce85301f94490524a))
* **quick-action:** "padding never works" class of layout bugs — the
  legacy `* { margin: 0; padding: 0; box-sizing: border-box }`
  universal reset has been removed from `quick-action.html`. Root
  cause: Tailwind v4 emits utilities into `@layer utilities`, and
  unlayered CSS unconditionally beats layered CSS regardless of
  specificity — so the universal reset was silently nuking every
  `px-*` / `py-*` / `m-*` utility in the palette window. Tailwind's
  preflight, which lives inside a layer, now handles the
  normalization properly.
  ([07eba03](https://github.com/erdembas/runhq/commit/07eba0390628a4353d1b792926dd70957dd7a17d))
* **editors:** resolve CLI shims outside of the GUI-launch PATH — when
  RunHQ.app is launched from Finder or the Dock it only inherits
  `/usr/bin:/bin:/usr/sbin:/sbin`, so `which code` / `which cursor`
  silently returned "not found" and the Editor dropdown rendered
  empty. Now probes `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.local/bin`, `~/.cargo/bin`, `~/bin` directly and passes the
  resolved absolute path to `tokio::process::Command` so launches work
  even from minimal-PATH contexts.
  ([c7b0275](https://github.com/erdembas/runhq/commit/c7b02750798879867e544e0ac330b17c29a25a1a))
* **docs:** stop stranding Cloudflare Pages visitors on stale
  `style.css` — `docs/_headers` shipped
  `Cache-Control: public, max-age=31536000, immutable` for `/*.css`,
  `/*.png`, `/*.svg`. `immutable` is only safe on fingerprinted URLs —
  our docs site uses stable filenames, so after the 0.2.0 rebuild the
  Amsterdam CF edge was returning the 2h-old pre-rebuild CSS (no
  `hero-maas` styles, 54.3 KB) while Düsseldorf had the fresh one
  (56.2 KB), collapsing the "Built with GLM on Huawei Cloud MaaS"
  hero badge to an unstyled default anchor depending on which edge
  the visitor hit. Headers now use a short TTL plus
  `stale-while-revalidate`, and the `<link>` carries a `?v=0.2.0`
  cache-bust so every already-poisoned edge re-fetches from origin.
  ([a2de7d3](https://github.com/erdembas/runhq/commit/a2de7d30d4c7c7ab748072ec229de749177b3540))

### Dependencies

* **tailwind-merge:** 2.6.1 → 3.5.0 — aligns conflict resolution with
  Tailwind v4's utility emission model.
  ([07eba03](https://github.com/erdembas/runhq/commit/07eba0390628a4353d1b792926dd70957dd7a17d))

## [0.1.3](https://github.com/erdembas/runhq/compare/v0.1.2...v0.1.3) (2026-04-20)


### Bug Fixes

* **brew:** migrate Homebrew tap to erdembas/homebrew-tap ([652d8d9](https://github.com/erdembas/runhq/commit/652d8d9372bb37358b3c7010253110a0d6c87b07))
* **ci:** stop leaking empty APPLE_* secrets into tauri-action env ([129a1d0](https://github.com/erdembas/runhq/commit/129a1d0af0d42e504ce316c7130966b1749fa19c))


### Performance Improvements

* **appimage:** drop GStreamer media framework from Linux AppImage ([8e4e2a3](https://github.com/erdembas/runhq/commit/8e4e2a32e514599ad1e1bd6da7645af217d4cb20))

## [0.1.2](https://github.com/erdembas/runhq/compare/v0.1.1...v0.1.2) (2026-04-19)


### Bug Fixes

* **macos:** ad-hoc sign bundle and strip quarantine via brew postflight ([00c7625](https://github.com/erdembas/runhq/commit/00c762503f8a2cf4bc378a0ef5a0e22938295d6d))


### Documentation

* explain ad-hoc signing strategy and demote Apple Dev ID to optional ([8b5163b](https://github.com/erdembas/runhq/commit/8b5163b4e1aa61018aab12475f01e01acae05d5c))
* update installation instructions for macOS and add first launch troubleshooting steps ([6dc0d68](https://github.com/erdembas/runhq/commit/6dc0d68db75f9ee0d73f2f3786a338ac216cdef5))

## [0.1.1](https://github.com/erdembas/runhq/compare/v0.1.0...v0.1.1) (2026-04-19)


### Documentation

* **landing:** surface editor + terminal in hero lead ([80eeb25](https://github.com/erdembas/runhq/commit/80eeb252e2adaa8da6cf02cefd200206f23c8f1c))
* **readme:** add dashboard screenshot above the fold ([614cf49](https://github.com/erdembas/runhq/commit/614cf493df96f330bb21612fae5dad4a1633ebec))

## [0.1.0] - 2026-04-18

### Added
- Initial MVP release of RunHQ.
- Auto-detection of 10 runtime types: Node, .NET, Java (Maven/Gradle), Go, Rust, Python, Ruby, PHP, Docker.
- Service lifecycle management (start/stop/restart) with multi-command support.
- Stacks for grouped orchestration with start-all/stop-all/restart-all.
- Real-time log streaming with virtualized rendering and URL detection.
- Embedded terminal (PTY) per service via xterm.js.
- Port watchdog with kill capability and PID-to-service attribution.
- Quick Action command palette (Cmd/Ctrl+K) with drill-down navigation.
- Sidebar with sections, drag-and-drop, and collapsible groups.
- First-run onboarding tour.
- System tray integration (hide-to-tray on window close).
- Light/dark/system theme with cross-window sync.
- Global keyboard shortcuts with customisation.
- Project scanning with multi-select import.
- Editor detector (VS Code, Cursor, Windsurf, Zed, Sublime, WebStorm, IDEA, Neovim).
- CI pipeline (lint, typecheck, clippy, test) on macOS, Windows, Linux.
- Release pipeline with Homebrew cask generation.

[0.1.0]: https://github.com/erdembas/runhq/releases/tag/v0.1.0
