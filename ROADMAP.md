# RunHQ Roadmap

This document outlines the planned features and improvements for RunHQ. Items are ordered by priority (impact x feasibility).

The overarching goal: transform RunHQ from a **service manager** into a **project command center** — the single window where developers see, control, and understand every project they work on.

---

## 1. Cross-Project Dashboard

**Priority:** High | **Effort:** Medium | **Status:** Shipped (feature/32)

The killer feature for developers with dozens of projects. Today, each service card is isolated — there is no way to see the big picture across all projects at once.

### Scope

- **Git Status Matrix** — A single screen showing every project's git state: dirty working tree, behind/ahead of remote, unpushed commits, stale branches. No more `git status` in 15 terminals.
- **Resource Heatmap** — Which projects are consuming the most RAM/CPU? Sort and visualize. "These 3 projects are burning 4GB combined" should be obvious at a glance.
- **Last Activity Tracker** — "You haven't touched this project in 47 days." Detect stale projects and surface them.
- **Dependency Outdatedness** — Show outdated dependency counts from `package.json`, `Cargo.toml`, `go.mod`, etc. with red/yellow/green indicators.
- **Security Alerts** — Surface `npm audit`, `cargo audit`, and equivalent results across all projects in one view.
- **Filter & Sort** — Filter by status (dirty, stale, running), runtime (node, rust, go), category, or custom tags. Sort by last activity, resource usage, name.

### Delivered

- `runhq-core::overview` — two-phase aggregator: fast path (git, resources, staleness, tags) and opt-in slow path (`npm outdated` / `cargo outdated` / `npm audit` / `cargo audit`) in parallel with per-command timeouts and a 5-minute memoised cache.
- Dashboard with filter bar (status, runtime, tags), group / sort dropdowns, resource heatmap, and a worst-offenders panel whose chips jump straight to the relevant drawer tab.
- **ProjectDetailDrawer** ("triage cockpit") — severity / bump tiles that double as filters, hover-reveal row actions, sticky bulk bar with multi-select + copy-as-script, in-drawer rescan with scan-freshness indicator, and an overflow menu whose "Open in…" submenu lists detected editors and falls back to Finder/Explorer.
- Auto-hiding macOS-style scrollbars, global `cursor: pointer` on interactive elements, floating drawer (margin + radius) scoped to the content area so the sidebar rail stays visible.

### Deferred — Auto-execute upgrade / CVE-fix commands

Considered but intentionally held off (see discussion on feature/32):

- **Risk surface**: a one-click `npm i pkg@latest` can pull a breaking major, shift peer deps, rewrite the lockfile, and burn minutes of wall time with no obvious rollback. Even with user confirmation, the app would be assuming responsibility for a decision that normally rides on CI, tests, and review.
- **Current pattern is already 90% of the value**: the drawer emits a ready-to-paste upgrade command per row and a `Copy as script` for the full selection. The user owns the paste into their terminal where their existing safety net (branch, tests, commit hooks) still applies.
- **If we ever revisit**, the preferred shape is _not_ a background "run and hope" execute. It's:
  - **"Run in RunHQ terminal" (pre-filled, not submitted)** — open the embedded terminal (`LogPanel`) with `cwd` set and the command typed in, but require the user's Enter. Zero-surprise: the user sees the exact line before it runs.
  - **Dry-run preflight** where the package manager supports it (`npm install --dry-run`, `cargo update --dry-run`) before the real invocation, so the diff / plan is surfaced first.
  - **Per-runtime opt-in** — enable per-project, never as a global default.

### Why

When you have 20+ projects, answering "which ones are out of date?", "which have uncommitted work?", "which are hogging resources?" requires visiting each one individually. A bird's-eye view eliminates that.

---

## 2. Bulk Operations

**Priority:** High | **Effort:** Low | **Status:** Planned

Perform operations across multiple projects at once instead of one by one.

### Scope

- **Bulk Git** — `git pull` all clean projects, `git fetch` all, `git stash pop` on projects with stashes. Show per-project results in a summary view.
- **Bulk Dependency Install** — Run `npm install` / `cargo build` / `go mod download` across all projects of a given runtime.
- **Smart Start/Stop** — "Start all frontend projects", "Stop everything idle for more than 3 days", "Start only projects with uncommitted changes".
- **Custom Bulk Command** — Execute any shell command across a selection of projects, with parallel or sequential execution mode and a per-project output viewer.
- **Progress Tracking** — Show a progress bar and per-project status (pending / running / success / failed) for bulk operations.

### Why

With dozens of projects, repeating the same command in each directory is tedious and error-prone. Bulk operations turn minutes of manual work into one click.

---

## 3. Internal Browser

**Priority:** High | **Effort:** Medium-High | **Status:** Planned

An embedded browser view for web services — see your running app without leaving RunHQ.

### Scope

- **Service Preview Tab** — Each service card gets a preview tab. When the service is up, automatically render `http://localhost:{port}`.
- **Auto-Refresh on Change** — Detect file changes in the service's working directory and auto-reload the preview (basic hot-reload awareness).
- **Mobile Preview Toggle** — Quick viewport switching: 375px (mobile), 768px (tablet), 1024px (desktop). Essential for responsive development.
- **DevTools Lite** — Capture `console.log`, `console.error`, and `console.warn` from the page and merge them into the RunHQ log stream. Surface JS errors directly in the service's log view.
- **Network Overview** — Minimal network tab: which endpoints are being hit, response status codes, and failing requests. Not a full DevTools replacement, but enough to spot problems.
- **URL Bar & Navigation** — Manual URL entry, back/forward, refresh. Navigate to specific routes without switching to an external browser.
- **Dark Mode Aware** — Respect the page's dark mode or force light/dark via the URL bar.

### Technical Notes

- Implementation via a Tauri WebView (already available as a Tauri plugin). No need for a full Chromium embed — use the system WebView.
- The system WebView shares cookies and sessions with the user's default browser, which is usually the desired behavior for local development.

### Why

When developing a web service, you constantly switch between editor, terminal, and browser. RunHQ already embeds the terminal. Embedding the browser eliminates the last context switch — everything in one window.

---

## 4. Quick Config & .env Editor

**Priority:** High | **Effort:** Low | **Status:** Planned

View and edit configuration files without leaving RunHQ or opening an editor.

### Scope

- **Config File Viewer** — Detect and display `.env`, `.env.local`, `.env.production`, `config.json`, `config.yaml`, `docker-compose.yml`, `Makefile`, and other common config files for each project.
- **Inline Editor** — Make quick edits to config files directly in RunHQ. Syntax highlighting for common formats (dotenv, JSON, YAML, TOML).
- **Cross-Project Env Diff** — Compare environment variables across projects. "Why does project A point to the staging DB but project B points to production?"
- **Env Variable Search** — Search for a specific variable across all projects. "Which projects are pointing to the production database?"
- **Secrets Scanner** — Detect hardcoded API keys, JWT secrets, private keys, and other sensitive values in `.env` files. Show warnings with the file path and line number.
- **Env Template** — Generate a `.env.example` from an existing `.env` file, stripping values but keeping keys and comments.

### Why

Config files are the most frequently edited files during local development, but they require opening an editor or using `cat`/`vim` in a terminal. A built-in viewer/editor with cross-project awareness saves time and catches misconfigurations early.

---

## 5. Git Diff Viewer

**Priority:** Medium-High | **Effort:** Medium | **Status:** Planned

See what changed without opening an editor or running `git diff` in a terminal.

### Scope

- **Inline Diff View** — Click the dirty file count on a service card to open an inline diff viewer. Show changed files, additions, and deletions.
- **Syntax Highlighting** — Language-aware syntax highlighting for common languages (JS/TS, Rust, Python, Go, YAML, JSON, etc.).
- **View Modes** — Side-by-side (split) and unified (inline) diff views, toggleable.
- **Quick Commit** — Stage files, write a commit message, and push — all from the diff viewer without touching a terminal.
- **Cross-Project Uncommitted Changes** — A dedicated view showing all uncommitted changes across all projects. Never forget to commit before switching branches again.
- **Branch Comparison** — View diff between any two branches (e.g., `main` vs `feature-branch`) without checking out.

### Technical Notes

- Use the existing `runhq-core/src/git.rs` infrastructure. Add `git diff` and `git diff --staged` commands with structured output parsing.
- For syntax highlighting, leverage an existing Rust crate (e.g., `tree-sitter` or `syntect`) or handle it on the frontend with a library like `highlight.js`.

### Why

`git diff` in a terminal is functional but hard to read for large changes. Opening VS Code just to see a diff is overkill. An inline viewer gives you the information at a glance with proper formatting.

---

## 6. Workspace Snapshots

**Priority:** Medium | **Effort:** Low-Medium | **Status:** Planned

Save and restore the exact state of your development environment — like a "save game" for your workspace.

### Scope

- **Snapshot Save** — Capture the current state: which services are running, which terminals are open, which git branches are checked out, which projects are expanded in the sidebar.
- **Snapshot Restore** — Restore a saved snapshot: start the same services, checkout the same branches, reopen the same terminals. One-click environment setup.
- **Auto-Save on Close** — When the app closes, automatically save a snapshot. On next launch, prompt: "Return to your previous session?"
- **Named Snapshots** — Save named snapshots for different workflows: "Friday debugging session", "Feature X development", "Demo prep". Switch between them freely.
- **Snapshot Sharing** — Export a snapshot as JSON. Team members can import it to replicate the exact same environment setup (paths adjusted per machine).

### Why

Context switching between different tasks or projects is expensive. If you spent 20 minutes getting 5 services running with the right branches and env vars, you shouldn't have to redo that tomorrow.

---

## 7. Service Health Checks & Readiness Probes

**Priority:** Medium-High | **Effort:** Medium | **Status:** Planned

Know whether a service is actually healthy — not just whether its process is running.

### Scope

- **TCP Port Check** — Periodically verify that a specified port is listening. Extends the existing port-watchdog infrastructure.
- **HTTP Health Check** — Periodically send a request to a health endpoint (e.g., `GET /health`) and check for expected status code and optional body regex match.
- **Custom Command Check** — Run a user-defined shell command. Exit code 0 = healthy, non-zero = unhealthy.
- **Lifecycle State Expansion** — Extend service states from `{ Stopped, Running }` to `{ Stopped, Starting, Healthy, Unhealthy, Degraded }`:
  - `Starting`: process is up but health check hasn't passed yet.
  - `Healthy`: health check is passing consistently.
  - `Unhealthy`: health check has failed N consecutive times (configurable threshold).
  - `Degraded`: was healthy, now intermittently failing (flapping detection).
- **Auto-Restart on Unhealthy** — Optionally restart a service after N consecutive health check failures. Configurable cooldown and max retry limit to prevent infinite restart loops.
- **Dashboard Indicators** — Green checkmark (healthy), yellow warning (starting/degraded), red X (unhealthy). Show last health check result, latency, and failure reason.
- **Stack Dependency-Aware Startup** — Don't start service B until service A is healthy (explicit dependency graph, not just sequential ordering).

### Technical Notes

- The existing resource sampling infrastructure (`resources.rs`, 2s interval) provides the pattern for periodic health check polling.
- The `EventSink` trait already supports event abstraction — add a `HealthStatusChanged` event.
- Health check configuration is serializable and fits naturally into the persisted state.

### Why

A process can be running but not ready (still initializing, waiting for a database, crash-looping). An orchestrator that can't distinguish "running" from "healthy" can't make smart decisions about dependencies, restarts, or user notifications.

---

## 8. CLI Interface

**Priority:** Medium | **Effort:** Low-Medium | **Status:** Planned

A terminal-first interface for RunHQ — use it without the desktop app.

### Scope

- **Service Management** — `runhq start <service>`, `runhq stop <service>`, `runhq restart <service>`, `runhq status`.
- **Log Streaming** — `runhq logs <service> [--follow] [--tail N]`. Stream logs to stdout with ANSI colors.
- **Stack Operations** — `runhq stack start <stack>`, `runhq stack stop <stack>`.
- **Project Scan** — `runhq scan <directory>`. Discover and import projects.
- **Bulk Operations** — `runhq bulk git-pull`, `runhq bulk start --filter frontend`.
- **TUI Mode** — `runhq tui` for an interactive terminal UI (similar to `lazygit` or `htop` but for service orchestration).
- **CI/CD Integration** — Use RunHQ to start/stop services in CI pipelines with the same configuration as local development.

### Technical Notes

- The `runhq-core` crate is already headless with zero UI dependencies. The `EventSink` trait and `NullSink` implementation are in place.
- A new binary target in the workspace (`crates/runhq-cli`) would consume `runhq-core` directly.
- For TUI mode, consider `ratatui` or `crossterm`.

### Why

Not every workflow needs a GUI. A CLI enables scripting, CI/CD integration, SSH sessions, and appeals to terminal-native developers. The core crate was designed for this from day one.

---

## 9. Log Persistence & Search

**Priority:** Medium | **Effort:** Medium | **Status:** Planned

Don't lose logs when the app restarts. Search through historical logs for debugging.

### Scope

- **Log-to-Disk** — Persist service logs to disk (SQLite or append-only files). Configurable retention policy (e.g., keep last 7 days, max 500MB per service).
- **Historical Log Viewer** — Browse logs from previous sessions, not just the current one.
- **Full-Text Search** — Search across all logs (current and historical) with regex support. "When was the last time this service threw ECONNREFUSED?"
- **Log Bookmarks** — Mark specific log lines for later reference. "This is the error from the incident on Tuesday."
- **Log Export** — Export logs for a service or time range as plain text or JSON. Share with teammates or attach to bug reports.
- **Smart Log Level Detection** — Automatically classify log lines as INFO/WARN/ERROR based on patterns (e.g., `[ERROR]`, `Exception`, `panic!`, `FATAL`).

### Why

Currently, logs exist only in memory (ring buffers). Restarting the app clears everything. For debugging production-like issues locally, historical log access is essential.

---

## Implementation Order

The suggested implementation sequence, balancing impact and dependencies:

| Phase       | Features                                               | Rationale                                                                                     |
| ----------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Phase 1** | ~~Cross-Project Dashboard~~ (shipped), Bulk Operations | Highest impact, lowest friction. Transform RunHQ from per-service to cross-project awareness. |
| **Phase 2** | Quick .env Editor                                      | High daily value, relatively self-contained.                                                  |
| **Phase 3** | Internal Browser, Git Diff Viewer                      | Rich UI features that require new embedded components.                                        |
| **Phase 4** | Service Health Checks, Log Persistence                 | Infrastructure improvements that other features can build on.                                 |
| **Phase 5** | Workspace Snapshots, CLI Interface                     | Polish and reach — snapshots for convenience, CLI for new audiences.                          |

---

## Contributing

Want to work on one of these? Open an issue referencing the feature and let's discuss the design before jumping into code. RunHQ's architecture (headless core + thin Tauri shell) makes most of these additions clean and modular.
