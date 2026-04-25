# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.6.0](https://github.com/erdembas/runhq/compare/v0.5.1...v0.6.0) (2026-04-23)

This release is the **project command center** chapter — RunHQ stops
being a per-service manager and turns into a single window that knows
about _every_ repo on disk. Three flagship features land together,
plus a Source Control window built for VSCode parity:

1. **Cross-Project Dashboard** — bird's-eye view across all projects
   ([#32](https://github.com/erdembas/runhq/issues/32))
2. **Git Diff Viewer** — full Source Control window with diff,
   staging, history, branches and graph
   ([#37](https://github.com/erdembas/runhq/issues/37))
3. **Activity Timeline** — chronological feed across every project,
   SQLite-persisted, with daily / weekly summaries and standup export
   ([#34](https://github.com/erdembas/runhq/issues/34))

### Cross-Project Dashboard ([#32](https://github.com/erdembas/runhq/issues/32))

The killer feature for developers with dozens of projects. Turns
RunHQ from a per-service manager into a bird's-eye view that answers
"which ones are out of date? which have uncommitted work? which are
hogging resources?" without visiting each project individually.

- **overview:** cross-project dashboard closing the full #32 scope —
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

### Git Diff Viewer ([#37](https://github.com/erdembas/runhq/issues/37))

A full Source Control window — Monaco-powered diff, staging, commit,
history, branches and graph — built so you never have to bounce out
to VSCode just to read a diff or write a commit message. Closes
ROADMAP §5.

- **diff:** Cross-Project Uncommitted Changes view — a fullscreen
  overlay that rolls up every dirty project into one searchable tree,
  so "wait, did I commit that two-line fix before switching branches?"
  becomes a single glance instead of N tab-switches. Surfaces a
  `N dirty` chip in the sidebar workspace header that only appears when
  there's actually something to worry about, and each service row has a
  shortcut back to its dedicated DiffViewer for the full commit flow.
  Reuses `DiffPane`, `TreeView`, and the existing overview poll — no
  extra backend polling. Monaco theme registration was extracted into a
  shared `useMonacoTheme` hook so the two fullscreen diff surfaces stay
  visually in sync.
- **diff:** Material Icon Theme (PKief) integration via `@iconify/react`
  + `@iconify-json/material-icon-theme` — the de-facto modern VSCode
  icon theme. Every file row in the Source Control tree (Changes,
  Staged, History, Cross-Project) and every diff breadcrumb now shows
  the flat, colourful tile for its filetype: purple "C#" square,
  blue "TS" square, the Rust crab, React atom, etc. Curated mapping
  covers 90+ extensions plus special-case basenames (`Dockerfile`,
  `package.json`, `tsconfig.json`, lockfiles for every package
  manager, `.gitignore`, `.env`, Cargo manifests, Tauri config,
  README / LICENSE / CHANGELOG, Gradle / Maven build files, .NET
  `Directory.Build.props`) so common config files get a recognisable
  brand glyph instead of a generic file icon. Unmapped files fall
  back to a status-tinted Lucide `<File>` so the tree never renders
  a blank slot.
- **diff:** tree indentation deepened from 12 px per level to 14 px,
  and file rows now start 8 px deeper than their parent folder. At 1x
  density the parent / child relationship is now obvious at a glance
  instead of differing by just 2 px — scannability win for large
  monorepos where folders nest 4+ levels deep.
- **diff:** `parseUnifiedDiff` now strips git's bookkeeping preamble
  (`diff --git`, `index`, `--- a/…`, `+++ b/…`, `similarity index`,
  rename / mode metadata, `Binary files differ`) before feeding
  Monaco. Previously those lines rendered as literal file content at
  the top of every diff — doubly ugly in full-file mode because
  they'd show up above the real source as if they were imports. Also
  drops the `\ No newline at end of file` sentinel that was leaking
  into the editor when files lacked a trailing newline.
- **diff:** full-line diff rendering — the tint on added / removed
  lines now spans the whole editor width at a VSCode-comparable
  intensity (~20% alpha vs the previous ~8%), so a block of changes
  reads as a solid band instead of a faint cloud behind the text. The
  character-level tint is bumped in parallel so actual changed tokens
  still pop against the whole-line wash. `diffEditorGutter.inserted/
  removedLineBackground` is now set explicitly so the gutter strip
  matches even on vs-light. Added a "Diffs only / Full file" toggle
  in the diff header that actually fetches a wider git diff. Previously
  the toggle only flipped Monaco's `hideUnchangedRegions`, but git's
  unified-diff output only contains changed hunks + 3 lines of context
  — so "Full file" had no extra content to show. Now the IPC layer
  forwards a `context: Option<u32>` to `git diff -U<N>`; when the
  toggle is on every DiffPane (Changes, Commit, History, Cross-Project)
  re-fetches with `-U100000`, giving Monaco both sides of the full file
  so the diff renders with every unchanged line in place. Toggle state
  lives in `useAppStore.diffShowUnchanged` so the choice syncs across
  every open surface and persists to localStorage. Default is ON —
  most reviewers want the full context; one click flips to hunk-only
  for giant files where a 100k-line context would OOM the renderer.
- **diff:** every file explorer sidebar in the Git editor is now
  resizable — Changes tab, Commit tab, History tab (both commit list
  and file tree), and Cross-Project view. Width is clamped to
  220–720px, persisted per-surface in localStorage under namespaced
  keys (e.g. `runhq.diff.commit.sidebar.v1`), and double-clicking the
  grip resets to the default. Keyboard accessible via ← / → (hold
  Shift for coarse 32px steps) with proper `role="separator"` +
  `aria-orientation="vertical"` so screen readers announce it. Logic
  lives in a new `useResizableWidth` hook so future splitters drop in
  with one line of code; the visual grip is a shared `ResizeHandle`
  component that tints on hover / while dragging.
- **diff:** Source Control rows redesigned for strict VSCode parity —
  the status pill on the left (which several users read as an empty
  checkbox and tried to click) is gone. Status is now a bold coloured
  letter (M / A / D / U / R / C) at the far right, matching VSCode's
  Source Control pane exactly. The file icon inherits the status
  colour so the row is still scannable at a glance even when the name
  truncates. Stage / unstage actions share the right-edge slot with
  the +/− stats: stats show at rest, the action button replaces them
  on hover (and is always visible in the dense Commit sidebar where
  discoverability matters more than density). The DiffPane breadcrumb
  got the same treatment — no more confusing pill, just a coloured
  letter on the right.
- **diff:** modern shadcn-style branch picker (`BranchPicker`) replaces
  every native `<select>` in the Source Control window — Commit /
  Branches / History / Graph all share the same combobox now. Built on
  a portal with auto-flip, type-ahead search, ↑/↓/↵/Esc keyboard
  contract, and groups so meta-options ("All branches", "Current
  HEAD") sit on top while real branches live under a "Branches"
  heading. macOS' ugly bordered popup is gone.
- **diff:** Graph tab gained a client-side commit search box. Matches
  subject, author, email, full hash, short hash, and ref labels.
  Non-matching rows fade to 30% opacity instead of disappearing — the
  lane topology stays put so spatial memory survives. Live "n/total"
  counter mirrors HistoryPanel.
- **diff:** layered Esc handling in the Source Control window. Esc now
  defers to any open transient overlay (context menu, confirm dialog,
  popover) so it dismisses *that* first instead of nuking the whole
  window. With nothing nested open, Esc pops a close-confirm — the old
  instant-close path was reflex-fire-friendly and routinely lost typed
  commit messages. The X button still closes immediately because that's
  a deliberate click, not a reflex.
- **diff:** right-click context menu for files in the Commit panel's
  Source Control list. Mirrors VSCode's parity item-for-item: Open
  File · Reveal in Folder · Copy Path · Copy Relative Path ·
  Stage / Unstage Changes · Discard Changes (or Restore / Delete File
  for deleted / untracked entries). The menu is portal-rendered, auto-
  flips at the viewport edge, and closes on outside-click or Esc.
- **diff:** destructive context-menu actions are gated behind
  `ConfirmDialog`. Modified / deleted files get a single-click
  confirmation; untracked files (which `git clean` deletes from disk
  beyond reflog recovery) require typing `delete` to confirm — same
  pattern as Force Delete Branch elsewhere in the app, so the UX is
  consistent across irreversible ops.
- **diff:** `FileRow` and `TreeView` gained an `onContextMenuFile`
  prop. Folder rows intentionally do not get a menu (matches VSCode's
  Source Control behavior — folder operations are global, not
  per-folder).
- **git:** new `discard_file` core operation in `runhq-core::git`.
  Auto-detects whether the path is tracked (`git checkout HEAD --
  <path>` after a defensive index reset so partial-stage states can't
  survive) or untracked (`git clean -f -d -- <path>`). Exposed via the
  `git_discard_file` Tauri command and `ipc.gitDiscardFile` on the
  frontend.
- **git:** DiffViewer and CrossProjectDiffViewer now share the main
  sidebar's elevated surface (`--surface-raised`) instead of layering
  three or four semi-transparent `/20`/`/30`/`/40` variants of
  `bg-surface-muted` on top of each other. The result is one
  continuous dark panel — tabs, file tree, toolbars, breadcrumb,
  branch picker, commit composer, history rail, graph filters all
  inherit the same tone — structured by borders rather than by opacity
  washes. The Monaco editor intentionally stays at the body `--surface`
  tone so the code area still sinks slightly below its chrome
  (matches VSCode's panel / editor hierarchy). Side effects:
  `statusBarBg` (the left-edge status tick on file rows) was also
  removed in the previous pass, so the whole left gutter is now
  clean — status is communicated exclusively via the right-edge
  letter + tinted file icon.
- **git:** right-edge status letters (M/A/D/R/C/U) on every file row —
  and on the DiffPane breadcrumb — now render as softly tinted 18x18
  indicators with raw `rgba()` backgrounds, not Tailwind utilities.
  Root cause turned out to be much nastier than a CSS bug: serde
  defaults serialize the `FileDiffStatus` enum with CamelCase tags
  (`"Modified"`, `"Added"`…) but the TypeScript union is all-lowercase,
  so every `statusLetter[file.status]` / `statusColor[file.status]`
  lookup had been returning `undefined` for the lifetime of the
  feature — the letter wasn't invisible, it was literally never being
  rendered. Fixed at the boundary with
  `#[serde(rename_all = "lowercase")]` so the wire format matches the
  contract the frontend expects. Scannability is now identical to
  JetBrains / Sublime Merge without introducing the "pill / checkbox"
  affordance the previous left-side chips did.
- **git:** the `N dirty` badge inside the Git popover is now a button.
  Clicking it opens the diff viewer directly and closes the popover —
  the second, faster entry point to the same flow as the existing
  `Diff` action button, matching the affordance we already have on
  the chip header itself. Clean repos keep the decorative `clean`
  pill (no-op, no hover).
- **git-editor:** sidebar search across both file tree and commit
  history. The file-tree sidebars (Commit + Branches) grew a
  `Search files…` box that filters by substring on full path
  (case-insensitive) and auto-expands every folder so matches are
  visible without an extra click. The History tab grew a matching
  `Search commits…` box that filters the commit list against subject,
  author, email, short/full hash, and refs (branch / tag names) — the
  count chip in the branch toolbar switches to `matches/total` while a
  query is active so it's obvious how aggressively the list is being
  trimmed. Both inputs ship the standard one-click clear (×) affordance
  and live entirely client-side, so typing never round-trips git.
- **git-editor:** the Changes and Commit tabs have been collapsed into
  a single **Commit** tab — they used to share ~90% of the same data
  set (working tree + staged file lists) presented in two slightly
  different ways, which forced users to flip between them mid-task to
  see "what changed" vs "what will I commit". The merged Commit view
  uses the more complete CommitPanel layout — stacked *Staged Changes*
  / *Changes* sections with per-file stage/unstage buttons, commit
  message + amend + Commit + Push above — and absorbs everything the
  old Changes tab had: file search, tree/list toggle, expand-all /
  collapse-all, and the A/M/D/R status legend. Browsing-only flow
  still works (just don't touch the staging buttons). Stage-all and
  Unstage-all always operate on the unfiltered set, so typing into the
  search box can never silently shrink what `Stage all` does. Branch-
  vs-branch comparison was promoted out of the Changes sub-mode into
  its own top-level **Branches** tab — it's a fundamentally different
  workflow (comparing two committed refs, no staging) and lumping it
  into the commit panel would have been a VSCode anti-pattern.

### Activity Timeline ([#34](https://github.com/erdembas/runhq/issues/34))

The answer to "what did I work on today?" without `git log` in 8
repos and shell-history archaeology. A chronological feed of
everything that happened across every project — service starts, git
operations, errors, file changes — persisted to SQLite so it survives
restarts and crashes.

- **timeline:** SQLite-backed activity timeline that survives app
  restarts. New `runhq-core::timeline` module owns the schema, write
  path, and aggregation queries; events live in
  `~/Library/Application Support/runhq/timeline.db` (or the platform
  equivalent) so history persists across sessions, machine reboots,
  and crashes. Schema is migrated transparently; no user action ever
  required.
- **timeline:** unified chronological feed across **every project** —
  one stream where service start/stop/crash, git commits, pushes,
  pulls, checkouts, branch creations, stashes, log errors / warnings,
  and file changes interleave by timestamp. No more bouncing between
  per-service log panels to reconstruct the morning.
- **timeline:** correlated `run_id` ties every event in a single
  service "run" together — the `service_started`, the noisy stderr it
  produced, and the terminating `service_stopped` / `service_crashed`
  collapse into one lifecycle entry. An 80-line shutdown spam stops
  burying the actual lifecycle event that caused it.
- **timeline:** **daily summary** rollups — projects worked, commits
  authored, services started, errors logged, and the unique project
  list — exposed via `timeline_daily_summary` IPC. Powers the standup
  export and the in-drawer "today at a glance" header.
- **timeline:** **weekly summary** with project / time filters —
  narrow the rollup to a specific project, event type, or time range.
  The filter set is the same one the live feed uses, so the summary
  always matches what's on screen.
- **timeline:** **standup export** — generates a clean
  "what I did yesterday" markdown block ready to paste into Slack /
  Linear / a standup doc. Groups commits by project, lists services
  touched, and surfaces error counts so retrospectives don't have to
  invent themselves.
- **timeline:** auto-recording from app events — service status
  transitions and log error / warning lines hook into the existing
  `EventSink` so the timeline populates itself with zero user
  ceremony. Git operations performed inside RunHQ (commits, pushes,
  branch checkouts via the diff viewer) emit events at the IPC
  boundary; external `git` calls outside the app are still picked up
  by the periodic working-tree poll.
- **timeline:** redesigned as a **right-side drawer** (640px) with a
  node-graph visualization — events render as connected nodes along a
  vertical spine, color-coded per type, with the current day's spine
  pinned at the top. Search box filters by description / project, the
  standup chip exports the current view, and the drawer can be torn
  off into a fullscreen mode for end-of-week review.
- **timeline:** sidebar entry point — a clock-icon button next to the
  workspace header opens the timeline drawer in one click. Keyboard
  reachable from the command palette.
- **timeline:** integrated `tauri-plugin-clipboard-manager` so the
  standup export and individual event copy actions land cleanly in
  the system clipboard on every platform (the manual
  `navigator.clipboard` path was unreliable from the Tauri webview on
  Linux).

### Deferred

- **Auto-execute upgrade / CVE-fix commands** — intentionally held
  off. A one-click `npm i pkg@latest` can pull breaking majors, shift
  peer deps, rewrite the lockfile, and burn minutes with no obvious
  rollback; responsibility for that decision normally lives in CI,
  tests, and review. The current _copy-as-script_ pattern already
  captures ~90% of the value with zero risk surface. If ever
  revisited, the preferred shape is **"Run in RunHQ terminal"**: open
  the embedded terminal with `cwd` set and the command pre-filled but
  _not submitted_ — the user sees the exact line and hits Enter
  themselves. See ROADMAP.md §1 for the full reasoning.

### Removed

- **git-editor:** the windowed (non-fullscreen) mode of the Diff
  Viewer. The F11 / ⌘⇧F toggle and the Maximize / Restore button on
  the title bar have been removed; the editor is always fullscreen
  now. The smaller mode was added defensively but never actually
  used — a 1000×700px diff viewer is unusable on any modern monitor
  and the toggle was just one more piece of UI to read on every open.
  Keyboard contract simplifies to _Esc closes_ and nothing else.
- **dashboard:** the two 4-up stat grids at the top of the dashboard
  (Running / Starting / Stopped / Failed and CVE / Outdated / Stale /
  Dirty). Each one duplicated information already present in the
  page header summary, the filter bar chips, and the WorstOffenders
  band — on a quiet day they burned ~200px of vertical real estate
  to display mostly zeros, pushing the actual project cards below the
  fold. Their filter affordances survived intact in the filter bar
  chips, which are tighter and more honest about being _filters_.
- **components:** orphaned `StatTile` / `AttentionTile` components
  and their barrel export.
- **components:** old `ProjectDashboard` modal replaced by the
  integrated dashboard + drawer flow.

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
