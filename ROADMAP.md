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

**Priority:** Medium-High | **Effort:** Medium | **Status:** Shipped

See what changed without opening an editor or running `git diff` in a terminal.

### Scope

- **Inline Diff View** ✅ — Click the dirty file count on a service card to open an inline diff viewer. Show changed files, additions, and deletions.
- **Syntax Highlighting** ✅ — Language-aware syntax highlighting for common languages (JS/TS, Rust, Python, Go, YAML, JSON, etc.).
- **View Modes** ✅ — Side-by-side (split) and unified (inline) diff views, toggleable.
- **Quick Commit** ✅ — Stage files, write a commit message, and push — all from the diff viewer without touching a terminal.
- **Cross-Project Uncommitted Changes** ✅ — A dedicated view showing all uncommitted changes across all projects. Never forget to commit before switching branches again.
- **Branch Comparison** ✅ — View diff between any two branches (e.g., `main` vs `feature-branch`) without checking out.

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

## 10. AI Integration (OpenAI-Compatible)

**Priority:** High | **Effort:** Medium-High | **Status:** Proposed

A first-class AI assistant layer for RunHQ — bring-your-own-key, OpenAI-API-compatible, optional and privacy-respecting. The goal is not "another chatbox bolted onto an IDE" but **AI surfaces that disappear into the developer's existing flow**: write a commit message from a staged diff, explain a noisy log line in place, summarise a branch as a PR description, ask a question about a single project or across the whole workspace.

The integration is deliberately **provider-agnostic**: anything that speaks the OpenAI Chat Completions / Responses API works — OpenAI, Azure OpenAI, OpenRouter, Together, Groq, DeepSeek, Mistral, Ollama, LM Studio, llama.cpp server, and most self-hosted gateways. Anthropic / Gemini are reachable via OpenRouter or a proxy, so we don't need a per-vendor SDK.

### Scope

#### Foundations

- **Provider Profiles** — Save multiple named profiles (e.g., "OpenAI prod", "Local Ollama", "Work OpenRouter") with `base_url`, `api_key`, default `model`, request `headers`, and per-profile flags (streaming, function calling, vision).
- **Secure Credential Storage** — API keys stored in the OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service via `tauri-plugin-stronghold` or the `keyring` crate). Never in plaintext config, never synced to git, never logged.
- **Per-Feature Model Routing** — Pick a different model per feature: a cheap/fast model for commit messages, a strong model for code review, a long-context model for whole-repo Q&A. Keeps cost predictable.
- **Streaming-First** — All long responses stream token-by-token via Tauri channels (`tauri::ipc::Channel<T>`), so the UI feels instant and cancellable. No "spinner for 30s then a wall of text".
- **Cost & Token Telemetry** — Show estimated input/output tokens before send, actual usage after, and a running monthly total per profile. Hard limit ("warn at $X/month, block at $Y") to avoid surprise bills.
- **Privacy Switches**:
  - **Per-project AI off** — A boolean on each service that disables every AI surface for that repo. For regulated work (fintech, medical) where the policy is "nothing leaves this machine".
  - **Local-only mode** — Globally restrict requests to providers whose `base_url` resolves to localhost / private network. Sanity-checked at request time, not just trusted from config.
  - **Secret redaction** — Before any prompt leaves the process, scrub `.env` values, JWT/Bearer tokens, AWS keys, private keys, and obvious password patterns. Show the scrubbed prompt in a "preview before send" disclosure.
- **Offline-Tolerant** — A network failure or 5xx must never break the host UI. AI surfaces degrade silently to "AI unavailable" with retry, and never block the underlying flow (commit, view log, etc.).

#### AI Surfaces (in dependency order)

- **Commit Message Generator** — A `✨ Generate` button next to the commit textarea in the Source Control window. Sends the staged unified diff (with redaction), gets a Conventional Commit-style message back, streams it into the textarea. User can re-roll, edit freely, or reject. Configurable: subject-only vs. subject + body, language (English / Turkish / etc.), tone (terse / detailed), Conventional Commit toggle.
- **Branch Name Suggester** — From an issue title, ticket key, or one-line task description, suggest a branch name following the project's existing convention (detected from `git branch --list`). One-click create-and-checkout.
- **Diff Explainer** — In the diff viewer, select a hunk → context menu → "Explain". Shows a popover with a plain-English summary, intent guess ("looks like a refactor extracting X into Y"), and possible review concerns ("the early-return on line N skips the cleanup block").
- **Log Triage** — Right-click any log line in `LogPanel` → "Explain error" or "Suggest fix". Sends the line plus the surrounding ±30 lines and the service's runtime hint (Node, Rust, Go…). Result drops into a side panel with copy-paste-ready commands and links to the offending file:line when the LLM produces them.
- **PR Description Generator** — From the Branches tab, "Draft PR description" runs the diff between the current branch and its base, plus the commit log, and produces a Markdown body with sections: Summary, Changes, Risk, Testing notes. Templates per repo (e.g., the team's Jira-link header).
- **Release Notes / Changelog** — From the History tab, select a commit range → "Draft release notes". Groups commits by Conventional type (feat / fix / docs / chore) and rewrites them human-readably. Especially useful when the team's commit messages are sloppy.
- **Code Review on Diff** — Staged or branch-vs-branch diffs can be sent for an LLM review pass: nullability misses, off-by-ones, error-handling gaps, missing tests. Output is shown as inline review comments on the diff lines (same UI we already have for selection), not a wall of text. Always framed as suggestions, never blocking.
- **Project Q&A (Chat Panel)** — A dedicated chat panel anchored to the current project. The panel auto-injects context: project README, file tree (paths only, not contents), recent commits, package manifests, top-level scripts. Slash commands escape into structured actions:
  - `/explain <file:line>` — open the file at the cursor and ask for an explanation.
  - `/test <function>` — generate test cases for the named symbol.
  - `/diff` — explain whatever the user is currently looking at in the diff viewer.
  - `/run <task>` — propose a shell command (never auto-execute; goes through the same "Run in RunHQ terminal pre-filled" path we used for upgrade commands in Phase 1).
- **Cross-Project Q&A** — At the dashboard level: "Which projects are pointing to staging?", "Which Node projects have outdated deps?", "What did I work on last Friday?". Backed by the existing Cross-Project Dashboard data (no extra scans), so the LLM just structures answers from already-collected facts.
- **Smart Auto-Tagging** — On project import, the LLM looks at `package.json` / `Cargo.toml` / `go.mod` / `README.md` and suggests tags ("frontend", "rest-api", "tauri", "fintech-onboarding"). User accepts/edits before they stick.
- **Health-Check Policy Advisor** — Once Service Health Checks ship (#7), an "AI suggest" button reads the service's recent log patterns + open ports + framework hint and proposes a sensible health-check config (HTTP path + expected status, or a TCP port, or a custom command). User reviews before saving.
- **Cross-Project Knowledge Graph** — Parse `.env` HTTP base URLs, shared `DATABASE_URL`s, Docker network names, and workspace links into an in-memory architecture graph. The dashboard renders the graph; the AI consumes it to answer wiring questions ("which service calls the auth API?", "which services share the analytics Postgres?"). Pure derivation from data already collected — zero extra scans, zero new permissions.
- **Agentic Upgrade Runner** — Beyond chat, give the model a multi-step goal ("upgrade React to 19 across all Node projects, halt on the first failing test suite") and let it iterate inside the embedded terminal with a hard "user must press Enter on each command" gate (the Phase-1 `Run in RunHQ terminal pre-filled` pattern, but looped). Per-step progress appears as a streaming todo list; user can pause, edit, or abort. Bounded by a max-steps budget, max-wall-time budget, and a per-tool consent allowlist.

#### Operational Surfaces

- **Prompt Library** — Reusable, parameterised prompts the user can edit. Ships with our defaults but every prompt is overridable per-profile and per-project. No black-box prompts.
- **Conversation History** — Local SQLite, per-project. Searchable. Can be wiped with one click. Never leaves the machine.
- **"Preview Before Send"** — A keyboard-toggleable disclosure that shows the exact final prompt (after templating + redaction) and the model/profile being used. The day someone sees an unexpected token count, this view is what saves them.
- **Function Calling / Tools (later)** — When the selected provider supports it, expose RunHQ-internal tools to the model: `get_logs(service, lines)`, `get_diff(service)`, `list_branches(service)`. Always read-only, never mutating, gated behind explicit per-tool consent.

### Technical Notes

- **Core module: `runhq-core::ai`** — Provider abstraction (`Provider` trait + `OpenAICompatible` impl), request/response types, streaming primitives, redaction pipeline, token estimator. Stays headless; the Tauri shell only does IPC plumbing and UI.
- **Streaming via Tauri channels** — Use `tauri::ipc::Channel<AIEvent>` for token streaming; map server-sent events from the OpenAI-compatible endpoint into a typed `AIEvent::Delta { text } | AIEvent::Tool { … } | AIEvent::Done { usage }`. Cancellation via dropping the channel.
- **Redaction pipeline** — A `Redactor` step (`String -> String + RedactionReport`) runs before every outbound request. The report is surfaced in the "Preview Before Send" panel so the user sees what was masked.
- **Model registry** — Lightweight static catalog (id, context window, input/output cost per 1k tokens, supports streaming/tools/vision) seeded for known models, with an "unknown — costs not tracked" fallback. Updateable via a JSON file the user can edit.
- **Frontend hooks** — `useAIComplete`, `useAIChat` (streaming), `useAIProviders`. UI components: `AIChatPanel`, `CommitMessageGenerator`, `LogExplainerPopover`, `DiffExplainerPopover`. Reuse the `BranchPicker`-style portal/popover pattern for context menus.
- **Failure budget** — Every AI call wrapped in a 30s timeout, exponential-backoff retry on 5xx (max 2 retries), and a circuit-breaker per profile (5 consecutive failures = "this profile is sad" banner with a "test connection" button).
- **No background calls without consent** — AI features never make a network request on app start, on project scan, or on any background sweep. Every request is traceable to a user action.

### Why

A modern dev tool without AI feels dated; a dev tool that drops a chatbox into a sidebar and calls it done feels lazy. RunHQ has something neither pure chatbots nor in-editor copilots have: **structured project context across many repos** (cross-project dashboard data, git status matrix, log streams, dependency state). That context is the unlock — it lets the assistant answer questions a single-repo IDE assistant can't, like "which services are pointing to the wrong DB?" or "what did I work on this week?", and produce commit messages / PR descriptions that match the team's actual conventions.

Doing it BYOK + OpenAI-compatible from day one means every user keeps their existing keys, picks their preferred provider (cloud or local), and pays nothing through us. We never become a billing relay or a data hop.

---

## 11. Docker Compose Integration

**Priority:** Medium-High | **Effort:** Medium | **Status:** Planned

First-class Docker Compose support — discover, manage, and monitor compose stacks alongside native services.

### Scope

- **Compose File Detection** — Automatically detect `docker-compose.yml`, `compose.yaml`, and Dockerfile in scanned directories. Parse service names, ports, and dependencies from the compose file.
- **Compose Stack as a Service** — Each compose project appears as a service in RunHQ. Start/stop the entire compose project with one click. Individual compose services can be toggled via the existing multi-command pattern.
- **Log Aggregation** — Stream `docker compose logs --follow` output into the service's log panel, merged with any native services running alongside.
- **Port Exposure** — Parse exposed ports from compose files and register them with the port watchdog. Show which compose service maps to which port.
- **Compose UI Actions** — Quick actions: `docker compose build`, `docker compose pull`, `docker compose down --volumes`, `docker compose restart <service>`.
- **Hybrid Stacks** — Mix compose projects and native services in a single stack. A full-stack app might start a compose project (DB, Redis) alongside native Node/Go services.

### Why

A huge percentage of local dev environments rely on Docker Compose for infrastructure (databases, queues, caches). Today, users either manage compose separately or skip RunHQ for those projects. Native compose integration makes RunHQ the single orchestrator for _everything_ a project needs.

---

## 12. Web UI Mode (`runhq serve`)

**Priority:** Medium | **Effort:** Medium | **Status:** Planned

Serve the RunHQ UI over HTTP — use it from any browser without the Tauri desktop app.

### Scope

- **Headless HTTP Server** — A new binary target (`crates/runhq-server`) that consumes `runhq-core` and exposes a web API (Axum or Actix-web). Reuses the same domain logic — state, process supervisor, git, logs.
- **Web Frontend** — A lightweight web build of the React frontend (separate Vite config, no Tauri APIs). Tauri-specific features (tray, global shortcuts, native dialogs) gracefully degrade. PTY terminal is omitted; logs are served via SSE or WebSocket.
- **SSE / WebSocket Log Streaming** — Replace Tauri event channels with Server-Sent Events for real-time log streaming in the browser.
- **Authentication** — Optional basic auth or token-based auth for the web interface. Defaults to localhost-only for security.
- **Shared State** — The desktop app and web server share the same `~/.runhq/` config. Run them simultaneously (desktop for terminal/tray, web for dashboard).
- **CI/CD Mode** — `runhq serve --ci` starts services, runs a health check loop, and exits with the appropriate status code. Integrates into GitHub Actions, GitLab CI, etc.

### Technical Notes

- `runhq-core` already has zero Tauri dependencies. The `EventSink` trait abstracts all side effects. A new `WebSocketSink` or `SSESink` implementation is all that's needed on the core side.
- The web frontend shares components with the desktop app via the existing `apps/desktop/src/` tree, conditionally importing Tauri-free versions of platform code.

### Why

The desktop app requires installation and a GUI environment. A web UI works on headless servers, in CI pipelines, over SSH, and on devices where you can't install Tauri apps (Chromebooks, tablets, remote dev boxes). It transforms RunHQ from "a desktop app" into "a platform."

---

## 13. Remote Machine Management (SSH)

**Priority:** Low-Medium | **Effort:** High | **Status:** Planned

Manage services on remote machines from the same RunHQ interface.

### Scope

- **Remote Connection Profiles** — Save SSH connection details: host, port, user, auth method (key, agent, password). Test connection with a single click.
- **Remote Agent** — A lightweight `runhq agent` binary that runs on the remote machine. It exposes the same `runhq-core` operations over a thin TCP or SSH-tunneled protocol.
- **Unified Dashboard** — Remote machines appear as collapsible sections in the sidebar, alongside local services. Filter by remote/local. Indicators show connection status (connected, reconnecting, disconnected).
- **Log & Status Streaming** — Real-time log streaming from remote services via the same `EventSink` abstraction, tunneled over the SSH connection.
- **File Sync** — Optional bidirectional file sync (rsync-based) for remote development. "Edit locally, run remotely."
- **Port Forwarding** — Automatically forward remote service ports to localhost so the Internal Browser (#3) can preview remote services.
- **Security Boundary** — Connections are user-initiated and per-session. No persistent background connections. All remote operations are clearly labeled in the UI with the hostname.

### Technical Notes

- Implement the remote agent protocol on top of the existing `EventSink` trait. The agent is just `runhq-core` wrapped in a minimal TCP listener.
- For SSH transport, use the `ssh2` crate (libssh2 bindings) or shell out to the system `ssh` command for key-agent forwarding support.
- The Tauri shell handles connection lifecycle; the core crate remains network-unaware.

### Why

Developers don't always work on a single machine. They have dev servers, staging environments, cloud workstations, and team boxes. Remote management turns RunHQ into a universal control plane, not just a local tool. This is the kind of feature that makes a team standardise on RunHQ.

---

## 14. Hot Reload & Watch Mode

**Priority:** Medium | **Effort:** Low-Medium | **Status:** Planned

Automatically restart services when files change — no more switching to a terminal to re-run after every edit.

### Scope

- **File Watcher per Service** — Use the system filesystem notification API (via `notify` crate) to watch each service's working directory for changes.
- **Watch Strategy by Runtime** — Different strategies per runtime:
  - **Node/Bun**: delegate to the project's existing dev script (`nodemon`, `tsx watch`, `bun --watch`) if detected.
  - **Rust**: run `cargo watch` or trigger a build on change.
  - **Go**: use `air` or `gow` if available, or `go build && restart`.
  - **Python**: use `uvicorn --reload`, `fastapi dev`, or detect `watchfiles`.
  - **Generic**: debounced restart — wait 500ms of file silence, then SIGTERM + restart.
- **Watch Exclusions** — Respect `.gitignore` patterns. Add additional exclusion globs via UI (e.g., exclude `**/*.test.ts`).
- **UI Indicators** — A "watching" badge on the service card. Show last restart reason and time. A small activity log: "Restarted due to changes in src/routes/users.ts."
- **Per-Service Toggle** — Enable/disable watch mode per service. Some services (databases, infra) should never auto-restart.
- **Graceful Restart** — Reuse the existing graceful shutdown infrastructure (SIGTERM → grace → SIGKILL). The restart respects the service's grace period.

### Why

The edit-save-restart loop is one of the most frequent developer workflows. Automating it saves dozens of context switches per day. RunHQ already knows the runtime — it can pick the right watch strategy without the user configuring anything.

---

## 15. Historical Performance Charts

**Priority:** Low-Medium | **Effort:** Medium | **Status:** Planned

Track CPU, memory, and port activity over time — visualize trends, find leaks, and correlate changes with deployments.

### Scope

- **Time-Series Storage** — Persist CPU and memory samples to SQLite (alongside the existing timeline DB). Configurable sampling interval (default: 10s). Retention policy (default: 7 days).
- **Dashboard Charts** — Per-service sparklines on the service card showing CPU/memory over the last hour. Expand to a full chart view with configurable time ranges (1h, 6h, 24h, 7d).
- **Cross-Project Comparison** — "Which services consumed the most memory this week?" Sortable bar chart view across all projects.
- **Anomaly Detection** — Highlight significant deviations from baseline. "Service X is using 3x its normal memory — possible leak?"
- **Correlation with Events** — Overlay timeline events (deployments, git operations, crashes) on the performance chart. "Memory spiked right after that deploy at 14:32."
- **Export** — Export performance data as CSV or JSON for external analysis.

### Technical Notes

- Extend the existing resource sampling infrastructure (`resources.rs`, 2s interval). Add a `ResourceSample` struct with timestamp, CPU%, memory bytes, and RSS.
- The timeline DB already has event correlation infrastructure. Add a `resource_samples` table with service_id, timestamp, cpu_pct, memory_bytes.
- Charts render on the frontend using a lightweight charting library (e.g., `uplot` or a minimal Canvas-based approach).

### Why

Right now, RunHQ shows live resource usage but has no memory. When a service starts consuming more memory over time, or CPU spikes after a certain deploy, there's no way to see the trend. Historical charts turn RunHQ from a snapshot tool into a diagnostic tool — especially valuable for performance regressions and memory leak hunting.

---

## 16. Service Templates

**Priority:** Medium | **Effort:** Low | **Status:** Planned

One-click service creation from pre-built templates for common project types.

### Scope

- **Built-in Template Library** — Templates for common project types:
  - **Node**: Next.js, Express API, NestJS, Nuxt, Astro, Remix
  - **Rust**: Axum API, Actix-web, Tauri app, CLI tool
  - **Python**: FastAPI, Django, Flask, Litestar
  - **Go**: Gin API, Fiber, standard HTTP server
  - **Docker**: Docker Compose with Postgres/Redis, single Dockerfile
- **Template Contents** — Each template defines: commands to run, port to watch, environment variables, pre-commands, suggested tags, and a README snippet.
- **Quick Start Flow** — "Add Service" → pick template → select or create directory → template fills in the config → tweak and save. Reduces setup from minutes to seconds.
- **Custom Templates** — Users can define their own templates as JSON/YAML files in `~/.runhq/templates/`. Share them with the team.
- **Template Suggestions on Scan** — When `runhq scan` detects a `package.json` with `next`, suggest the Next.js template. Pre-fill detected values (build command, dev script, port).

### Why

Adding a new project to RunHQ requires configuring commands, ports, env vars, and tags manually — even though 90% of projects follow known patterns. Templates eliminate that friction and make RunHQ feel proactive rather than reactive.

---

## 17. Service Run Profiles

**Priority:** Medium | **Effort:** Low-Medium | **Status:** Planned

Define multiple execution configurations per service — dev, staging, production-like, test, debug.

### Scope

- **Profiles per Service** — Each service can have named profiles (e.g., "dev", "debug", "profiling"). Each profile overrides: commands, environment variables, path override, pre-commands, port, grace period, watch mode, and health check config.
- **Profile Switcher** — A dropdown on the service card to switch profiles. Switching restarts the service with the new profile.
- **Inheritance** — Profiles inherit from a base config. Override only what differs. "The debug profile is the same as dev but with `RUST_LOG=debug` and `--features debug`."
- **Profile-Aware Stacks** — Stacks can specify which profile each member service should use. "Start the full stack with all services in debug profile."
- **Quick Profile Actions** — Right-click a service → "Start with profile..." → select profile. Keyboard shortcut for the most recently used profile.
- **Profile Export/Import** — Export a service's profiles as JSON. Share with teammates for consistent setup.
- **Branch-Aware Activation** — Bind a profile to a git branch pattern (e.g., `feature/payments-*` ⇒ `staging-payments` profile). When the user checks out a matching branch, RunHQ offers — never auto-applies — to switch the running service to that profile. Stops the "I edited prod DB by accident on a feature branch" class of incident at the source.

### Why

Services behave differently across contexts. In dev, you want hot reload and verbose logging. In debugging, you want debug symbols and trace-level logs. For a demo, you might want production-like config (minification, no dev tools). Profiles make it trivial to switch between these contexts without editing config files or remembering which flags to pass.

---

## 18. Activity Timeline & Standup Generator

**Priority:** High | **Effort:** Low-Medium | **Status:** Proposed

The portfolio cockpit answers _where_ ("which projects need me?") brilliantly, but not _what did I do_. The `timeline.db` already collects the raw events — this feature surfaces them as a usable narrative.

### Scope

- **Hourly Activity Heatmap** — Per-project (and global) calendar-style heatmap of activity hours: commits, branch switches, terminal commands, file changes, service start/stop, log volume bursts. Tooltip on each cell reveals the actual events.
- **"What did I work on?" range query** — Pick a date range ("last Friday", "this week", "since the Monday standup") and get a per-project breakdown: commits authored, branches touched, services run, time-on-project estimate (active terminal + dirty file edits).
- **AI Standup Polish** — One-click "Draft standup" on the range view. Pulls the breakdown, redacts secrets, generates a 3-bullet "Yesterday / Today / Blockers" markdown ready to paste into Slack or a daily channel. Reuses the AI plumbing from #10.
- **Focus Sessions** — Optional Pomodoro-style timer per project. When active, RunHQ tags every event in that window as "focused work on X" so the heatmap and standup output can distinguish deliberate work from drive-by `git fetch`es.
- **Privacy** — All data stays in `timeline.db`. No telemetry, no cloud sync. Exportable to JSON for self-tracking nerds.

### Technical Notes

- The existing `timeline.db` schema already stores events with timestamp, project_id, kind, payload. Add an aggregator query layer rather than new persistence.
- Heatmap renders client-side (Canvas or `uplot`), no chart library bloat.

### Why

The portfolio dashboard tells you _what's broken_; the activity timeline tells you _what you did_. Together they cover the two questions developers Google their own machines for daily: "what needs me?" and "what did I just do?". Standup polish is the AI-generated answer to the most universally hated daily ceremony.

---

## 19. Per-Project Notes & Runbook Generator

**Priority:** High | **Effort:** Low | **Status:** Proposed

Every repo has tribal knowledge that doesn't fit in a `README.md` (yet) but the developer keeps re-discovering: _"why does this need `--legacy-peer-deps`?"_, _"the seed command nobody documented"_, _"that one env var the CI sets but local doesn't"_. Today this lives in scratch files, Notion pages, and Slack DMs.

### Scope

- **Inline Markdown Notebook** — Each project gets a `~/.runhq/notes/<project-slug>.md`. A "Notes" tab in the project drawer renders it with live edit, syntax highlighting for fenced code blocks, and `cmd+enter` save. Pinned notes float to the top.
- **AI-Searchable** — Notes are auto-injected as context into the project's AI Q&A (#10). Asking _"how do I seed the db?"_ in chat hits the note first, before the LLM falls back to inferring from `package.json` scripts.
- **Snippet Linking** — `runhq://project/svc-x/note#seed` URLs render in markdown; pasted into a teammate's RunHQ they jump to the right note. Useful in Slack: paste-and-go.
- **Onboarding Runbook Generator** — One-click "Generate runbook" reads the project's `package.json` scripts / `Makefile` targets / `docker-compose.yml` services / detected README headings, plus existing notes, and produces a `docs/RUNBOOK.md` (or `notes/runbook.md`) draft with: _Prerequisites / First-time setup / Daily commands / Troubleshooting_ sections. The user reviews; nothing is committed automatically.
- **Per-Note Metadata** — Tags, "last verified" date (with a stale-warning chip after 90 days, mirroring the CVE freshness pattern from 0.7.0), author (just `git config user.name`).

### Why

The single biggest cost of returning to a dormant project is _remembering how it works_. RunHQ already knows enough to bootstrap that knowledge, and where the developer fills in the gaps, those notes become the single best context source for the AI assistant — collapsing two roadmap items (notes + runbook) into one feature surface.

---

## 20. Deadline & Calendar Awareness

**Priority:** Medium | **Effort:** Low | **Status:** Proposed

The hero state today says _"Workspace Idle"_ on quiet Mondays. That's accurate but not _useful_ — the hero should also know that the client demo is Friday and project X has 3 unpatched critical CVEs.

### Scope

- **Per-Project Deadlines** — Optional deadline field per project: `due: 2026-05-15 | "Client X demo"`. Stored in `~/.runhq/config.json`.
- **iCal / Google Calendar Import** — Subscribe to a calendar feed (read-only, no auth required for public iCal URLs). Map calendar events to projects by tag or by name regex. Events become deadline annotations.
- **Deadline-Aware Hero** — Hero priority order: critical CVEs > deadline-pressure projects with risk > running services > idle. Example: _"Client demo in 2 days — 3 critical CVEs in checkout-service"_ takes precedence over a generic "Workspace idle".
- **Worst-Offenders Override** — When a project has both a near deadline and high CVE count, it pins to the top of the worst-offenders band regardless of raw severity rank.
- **Native Notifications (opt-in)** — At a configurable lead time ("2 days before any deadline with open CVEs"), surface an OS notification.

### Why

The cockpit tells you what's broken everywhere; deadline awareness tells you _which broken thing matters most this week_. It's the difference between a maintenance dashboard and a triage dashboard.

---

## 21. Embedded HTTP / API Client

**Priority:** Medium-High | **Effort:** Medium | **Status:** Proposed

Internal Browser (#3) embeds the user-facing surface; this embeds the developer-facing one. The "alt-tab into Postman / Insomnia / Bruno" loop disappears.

### Scope

- **Spec Auto-Discovery** — Detect `openapi.{yaml,json}` / `swagger.{yaml,json}` / `*.http` / `*.rest` / `*.bru` files in the project. Parse into a sidebar list of endpoints grouped by tag.
- **One-Click Request** — Click an endpoint and the request fills with the project's running service base URL (auto-detected from active port) and any `.env`-resolved auth headers. Hit Send.
- **Cross-Project Endpoint Search** — Cmd+K palette extends to endpoints: "search across every project's API spec". _"Where is `POST /api/refunds` defined?"_
- **Environment Switcher** — Per-request environment dropdown reusing #17 Run Profiles. The same `staging` / `prod` / `local` profile that controls the running service controls the request endpoint and auth.
- **Request History** — Per-project history with star/save and folder organisation. Stored alongside project config — works offline, never syncs.
- **Response Tools** — JSON viewer with collapsible nodes, schema diff against the OpenAPI response model (red-highlight unexpected fields), copy as cURL / fetch / Python.

### Technical Notes

- Reuse the AI redaction pipeline (#10) for the "Copy as cURL" output so users never paste real bearer tokens into bug reports.
- Reuse the Cmd+K palette infrastructure already in place for endpoint search.

### Why

Postman became 2 GB, requires login, and the free tier started syncing collections to their cloud. Bruno is fine but project-scoped, not portfolio-scoped. RunHQ already knows your services, your environments, and your auth — it's the right surface for the request runner.

---

## 22. Database & Cache Inspector

**Priority:** Medium | **Effort:** Medium-High | **Status:** Proposed

Sanity-checking the dev database is a daily action that today requires TablePlus / RedisInsight / Mongo Compass to be open in parallel. RunHQ already has `DATABASE_URL` from the env file — it can do the read-only 90% case in-place.

### Scope

- **URL-Driven Connection** — When `DATABASE_URL`, `REDIS_URL`, `MONGO_URL`, or detected SQLite paths are present in the project's resolved env, surface a "Data" tab in the drawer.
- **Postgres / MySQL / SQLite** — Schema browser, table preview (paginated, default LIMIT 100, no `SELECT *` on huge tables), free-form read-only SQL editor with `EXPLAIN` view. Writes blocked by default; toggle behind a typed-keyword confirm like the scan-cache reset pattern.
- **Redis** — Key tree browser (split by `:` namespaces), TYPE-aware viewer (string / hash / list / set / zset / stream), TTL display, key search with cursor-based `SCAN`.
- **MongoDB** — Database / collection / document browser, JSON viewer, free-form `find` / `aggregate` editor.
- **Schema Diff** — Pin the current schema as a snapshot. After a migration, view the diff. _"Did the migration actually add the column?"_ in one click.
- **AI Plumbing** — Right-click any table / collection → "Explain this row" / "Generate seed for this table". Reuses #10.

### Technical Notes

- Use `sqlx` (Postgres / MySQL / SQLite), `redis-rs`, `mongodb` crates from `runhq-core`. Connection pool per service with a hard idle timeout (60s) — no zombie connections.
- All write paths gated by an explicit `read_only: bool` per connection that defaults true. Toggle requires a typed-keyword confirm.

### Why

The "is the migration applied?" / "is the queue draining?" / "is the cache populated?" loop happens dozens of times during a debugging session. A built-in inspector closes the loop without context-switching to a third app, while RunHQ's existing security boundary (per-project AI off, secret redaction) extends naturally to it.

---

## 23. Test Runner Panel

**Priority:** Medium-High | **Effort:** Medium | **Status:** Proposed

Tests are the second-most frequent thing developers run after the dev server. RunHQ supervises the dev server but ignores tests — leaving the test loop to the terminal.

### Scope

- **Runner Auto-Detection** — `vitest`, `jest`, `mocha`, `playwright`, `cypress`, `pytest`, `cargo test`, `cargo nextest`, `go test`, `phpunit`, `rspec`. Detect from `package.json` / `Cargo.toml` / `pytest.ini` / etc.
- **Structured Output Panel** — Parse runner output (most have machine-readable formats: vitest's JSON reporter, `cargo test --format=json`, `go test -json`) into a tree view: file → describe → test, pass/fail/skip counts, per-test duration, stderr inlined per failing test.
- **Failed-Only Re-Run** — Re-run only the tests that failed in the last run. One click. Saves the 30-second full-suite re-run loop.
- **Flaky Detection** — Track per-test pass/fail history in `~/.runhq/test_history.db`. Surface a "flaky" chip on tests that flipped state in the last N runs. Sort by flake rate.
- **Coverage Delta** — When the runner emits coverage (lcov / cobertura), show line/branch coverage per file plus the delta vs. the last run. Highlight new uncovered code from the current branch's diff.
- **AI on Failure** — Right-click a failed test → "Explain failure". Sends the assertion diff, stack trace, and the relevant source hunk to the AI; result drops into the chat hub with file:line links.
- **Affected-Tests Mode** — Combined with #25 (workspace topology): only run tests whose source files transitively depend on files changed in the current branch's diff. Massive speedup on monorepos.

### Why

The edit-save-test loop is faster than edit-save-restart in any modern test runner, but only if the runner integrates into the developer's surface. Today that surface is split across the IDE's test panel and a terminal — RunHQ already owns the latter and can give the former a portfolio-aware twist (cross-project flake dashboard, affected-tests mode).

---

## 24. Tunnel & Public Share

**Priority:** Low-Medium | **Effort:** Low | **Status:** Proposed

Showing a local service to a teammate / client / mobile device today means alt-tabbing to ngrok or installing Cloudflare's `cloudflared` and remembering the right command.

### Scope

- **One-Click Tunnel** — On any service with a registered port, "Share" button opens a tunnel and copies a public URL to clipboard. Backends: Cloudflare Tunnel (default, no signup), `bore`, `localhost.run`, ngrok (BYO token).
- **Auto-Revoke** — Tunnel auto-closes when the service stops, the app quits, or after a configurable inactivity timeout (default: 1 hour). No "I shared my local DB to the public internet last Tuesday and forgot" incidents.
- **Tunnel Indicator** — Persistent banner on the project card while a tunnel is open. Tray icon goes amber. Activity log per tunnel: requests in, bytes transferred, geographic source.
- **Per-Service Allowlist** — Some services should _never_ be tunnelable (DBs, internal admin panels). A `tunnel: forbid` flag in the service config blocks the Share button entirely.
- **QR Code** — Public URL rendered as a QR for fast mobile testing.

### Why

A tiny, focused feature — but one of the highest day-to-day value-per-line-of-code wins on the roadmap. The mobile-testing flow alone justifies it.

---

## 25. Monorepo & Workspace Topology

**Priority:** High | **Effort:** Medium-High | **Status:** Proposed

RunHQ today assumes "one repo = one project = one card". Modern enterprise repos are pnpm/yarn/Nx/Turborepo/Cargo/Gradle workspaces with 10–200 internal packages. Without first-class topology, those repos either overflow the dashboard or get lumped into a single misleading card.

### Scope

- **Workspace Detection** — Recognise `pnpm-workspace.yaml`, `yarn workspaces`, `nx.json`, `turbo.json`, `Cargo.toml [workspace]`, `settings.gradle`, `lerna.json`. Build the package graph on scan.
- **Hierarchical Card** — Workspace appears as a single expandable card with a child list of internal packages. Resource / CVE / outdated chips aggregate up; per-package detail is one click away.
- **Affected-Packages Highlighting** — Compute the set of packages transitively affected by the current branch's diff (vs. its base branch). Highlight them in the package list. Drives the "affected-tests" mode in #23 and the "affected services to restart" hint in #14 (Hot Reload).
- **Internal Dependency Graph** — Visual graph of which workspace package depends on which. Click a node to filter the card to that package's neighbours. Read-only — this is observability, not refactoring.
- **Per-Package Run Profiles** — Inherit from the workspace-level profile, override per package. _"In dev, only build the 5 packages I'm touching."_
- **Hybrid Workspaces** — Docker Compose services (#11) appear in the same hierarchical view alongside JS/Cargo packages. Heterogeneous workspaces (compose + pnpm + Cargo) collapse into one card.

### Technical Notes

- Existing `runhq-core::scanner` already handles per-runtime detection; extend it with a `Workspace` variant whose members are sub-projects rather than peer projects.
- The package graph is small (typically < 500 nodes); render in the frontend with a lightweight force-directed layout (`d3-force` or `cytoscape`).

### Why

Monorepo support is the difference between RunHQ being "useful for my side projects" and "useful at work". The tools that own this space today (Nx Cloud, Turbo Remote Cache) are CI/CD-focused; a local-first cockpit with topology awareness is an open lane.

---

## 26. Build Cache & Disk Hygiene

**Priority:** Medium-High | **Effort:** Low-Medium | **Status:** Proposed

The portfolio metaphor extends to disk: the user has 30 repos and probably 30 GB of `node_modules`, `target/`, `__pycache__`, `.gradle`, `.turbo`, `dist/`, `.next/` they haven't touched in months.

### Scope

- **Cache Directory Inventory** — Per project, scan and size the well-known build/cache dirs (`node_modules`, `target`, `.gradle`, `.next`, `dist`, `build`, `__pycache__`, `.venv`, `vendor` in PHP, `bin`/`obj` in .NET, `.turbo`, `.nx`). Persist to a local SQLite store; refresh on demand and on a weekly schedule.
- **Last-Accessed Heuristic** — Use `atime` (where supported) plus the project's last activity timestamp from #18. Flag dirs whose owning project has been dormant > 90 days.
- **Bulk Prune** — A "Disk" tab on the dashboard ranks projects by reclaimable bytes. Multi-select, dry-run preview ("would free 23.4 GB across 11 projects"), then delete. Like the AI agentic flow: nothing runs without confirmation.
- **Lockfile Drift Detector** — Track a hash of `package.json` / `Cargo.toml` and the corresponding lockfile. When the lockfile changes but the manifest doesn't, surface a "lockfile drift" chip with the diff: which transitive dependency moved, license changes if any, new CVE flags. Often catches dependency confusion attacks and accidental `npm install`s on someone else's machine.
- **Tray Notification on Threshold** — Optional: when total reclaimable bytes cross a configurable threshold (default 50 GB), surface a passive tray dot, not a modal.

### Why

Two reasons. First, demoable wow-factor — _"RunHQ just freed 27 GB I didn't know I had"_ is a perfect launch-week tweet. Second, lockfile drift is one of the cheapest supply-chain attack surfaces to monitor and almost no tool surfaces it locally; this slots straight under the existing CVE / Dependency Hygiene narrative.

---

## 27. Supply Chain: License Compliance & SBOM

**Priority:** Medium | **Effort:** Medium | **Status:** Proposed

Current dependency hygiene catches CVEs and outdated bumps. The other two legs of the supply-chain stool — license compliance and provenance — are missing, and matter the moment a user ships commercial software.

### Scope

- **License Inventory** — Per project, walk the dependency tree and aggregate the SPDX license of every direct + transitive package. Show the rollup: "MIT (243), Apache-2.0 (51), BSD-3 (17), ISC (12), GPL-3.0 (1) ⚠".
- **Contamination Warnings** — Flag combinations the user opted into avoiding (configurable per project): GPL/AGPL pulled into a project marked "proprietary", "no-commercial" CC licenses in a commercial codebase, missing license fields ("UNLICENSED" / unknown).
- **Attribution Generator** — One-click `THIRD-PARTY-NOTICES.md` (or `LICENSES.txt`) with proper SPDX identifiers and full license texts where required by the upstream license. Re-runs on dependency change so the file stays accurate.
- **SBOM Export** — One-click CycloneDX (`bom.json`) or SPDX (`bom.spdx.json`) export per project. Includes versions, hashes, license, and (when known) provenance attestations.
- **Provenance Awareness** — When a package is signed (npm provenance, Sigstore), show a green "verified" chip and the source repo / build URL. Unsigned popular packages get a quieter "unverified" chip — informational, not noisy.

### Why

Enterprise procurement asks for an SBOM the day before contract signing. License contamination kills acquisitions. Today both are answered by ad-hoc one-shot tools (`license-checker`, `cargo-deny`, `cyclonedx-cli`); RunHQ's persistent portfolio store is the right place to make them ambient.

---

## 28. Secrets Manager Integration

**Priority:** Medium-High | **Effort:** Medium | **Status:** Proposed

The Quick `.env` Editor (#4) handles plaintext `.env` files. The serious step up — and the make-or-break for fintech / regulated / multi-developer setups — is pulling secrets at runtime from a central store and never writing them to disk.

### Scope

- **Provider Adapters** — Doppler, 1Password CLI, HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Bitwarden Secrets Manager. Adapter trait in `runhq-core`; user picks one per project.
- **Runtime Injection** — On `start service`, RunHQ fetches the requested secret bundle and injects it into the spawned process's environment. The fetched values never persist to `~/.runhq/` or to the project's `.env`. Cleared from memory on stop.
- **Per-Project Provider Override** — `runhq.team.json` (see #32) can declare _"this project's secrets come from the team's Doppler project XYZ"_. New contributors clone, log in once with `op signin` / `doppler login`, and the cockpit handles the rest.
- **Drift Detector** — A `.env.example` lists the variables the project needs; the secrets provider lists the variables it has. Show the diff: missing keys, extra keys. Catches "I added a flag but forgot to set it in staging" before runtime.
- **Audit Trail** — Per-fetch log entry (`who / when / which keys / which provider`) in `~/.runhq/audit.db`. Local-only, exportable for compliance reviews.
- **Redaction** — Fetched values are passed through the AI redaction pipeline (#10) automatically. The values exist as concrete strings only inside the spawned child process's environment — never in any RunHQ-rendered surface.

### Technical Notes

- All adapters speak via subprocess to the user's pre-installed CLI (`op`, `doppler`, `vault`, `aws`) rather than re-implementing auth flows. Keeps the attack surface small.
- For Vault and AWS, credential refresh (short-lived tokens) is wrapped in a per-service background renewer that respects the spawned process's lifecycle.

### Why

`.env` files in git history is the most common secret-leak vector in startup post-mortems. A first-class secrets-manager bridge — local-first, no cloud account required, BYO provider — is the same pattern as the BYO AI integration (#10) and resolves the regulated-customer objection that today blocks RunHQ from many enterprise teams.

---

## 29. Crash Postmortem Generator

**Priority:** Medium | **Effort:** Low-Medium | **Status:** Proposed

When a service crash-loops at 2 a.m., the developer wants the _bundle_ of context, not to scrape it themselves. RunHQ already has the bundle; it just doesn't assemble it.

### Scope

- **Crash Detection** — A service exiting non-zero ≥ N times within M minutes (default: 3 in 10 min) is flagged as crash-looping. The existing supervisor lifecycle already exposes the events.
- **Auto-Bundle** — On crash-loop trigger: capture the last 200 lines of merged stdout/stderr, the last 5 commits with author/time/message, the env keys (values redacted via #10's pipeline), the runtime version, the exit code(s), the resource-sample ring buffer (30 minutes back), and any open ports.
- **AI Postmortem Draft** — Sent to the configured AI provider (or skipped if AI is disabled — bundle is still saved). Output: a Markdown incident draft with sections _Summary / Timeline / Likely cause / Quick mitigations / Suggested next steps_.
- **One-Click GitHub / GitLab Issue** — Opens the platform's "new issue" page pre-filled with the draft, attached as a code-fenced block. Repository auto-detected from the project's `git remote -v`.
- **Local Archive** — Every postmortem stored in `~/.runhq/incidents/<project>/<timestamp>/` with the raw bundle JSON + the rendered Markdown. Searchable.
- **Replay Mode** — Click a past postmortem → drawer opens at the exact log lines, port state, and resource graph at the moment of the crash. Time-machine debugging.

### Why

The 80%-of-the-time path to filing a useful bug report is mechanical: gather logs, gather state, write a summary. Mechanical work is exactly what a cockpit with all the data should automate. Once it exists, the ROI compounds — the team's bug reports become uniformly debuggable.

---

## 30. Plugin / Extension System

**Priority:** Medium | **Effort:** High | **Status:** Proposed

RunHQ aims to cover 10 runtimes natively. The long tail (Elixir/Mix, Crystal, Zig, Nim, Deno + Fresh, R, Julia, niche frameworks) will never end. A plugin system turns "feature requests we can't ship" into "features the community can ship for themselves".

### Scope

- **Three Extension Points** — (1) **Runtime providers**: detect a project, infer commands, emit health signals. (2) **Dashboard widgets**: a third-party panel slot on the dashboard or the project drawer. (3) **AI surfaces**: register a new menu item ("Explain Crystal stack trace") that routes through the AI hub with custom prompts.
- **Sandbox** — Plugins ship as WebAssembly modules (preferred, sandboxed) or as signed native extensions (escape hatch for plugins that need filesystem / network beyond what the WASM sandbox allows). WASM plugins get a capability-scoped API: read project metadata, emit chips, request the user to run a command (always confirmed).
- **Manifest** — `runhq.plugin.json`: name, version, author, requested capabilities, signing key. Capabilities are explicit ("read git status", "run shell command on user confirm") — no implicit network or disk access.
- **Discovery** — `~/.runhq/plugins/` directory + a curated registry (`registry.runhq.dev`) of community plugins. Installation is `runhq plugin install <name>` or drop-the-file. No silent auto-update.
- **UI Surface** — Settings → Plugins lists installed extensions, their granted capabilities, last-used time, and a "disable" toggle. Disabling a plugin must be one click and instant.

### Technical Notes

- WASM runtime: `wasmtime` (already battle-tested in the Rust ecosystem). Capability-scoped via the WASI Preview 2 component model.
- The plugin's lifecycle is fully synchronous from RunHQ's perspective: a plugin call has a hard wall-time budget (default 1s for chips, 30s for a one-shot scan), enforced by the runtime.

### Why

Roadmap items like Web UI (#12), Remote SSH (#13), and AI Q&A (#10) all benefit from a healthy ecosystem of integrations RunHQ doesn't have to maintain. A clean plugin boundary turns RunHQ from "an app" into "a platform" — the same step VS Code took at version 0.10 and never looked back.

---

## 31. Mobile Companion (Read-Only)

**Priority:** Low-Medium | **Effort:** High | **Status:** Proposed

The desktop cockpit is for active work. The mobile app is for the 30 seconds between meetings when the developer wants to know _"is everything OK?"_ without opening a laptop.

### Scope

- **Read-Only Dashboard Mirror** — Service status, health checks (#7), CVE summary, last build outcome, log tail (last 100 lines per service). No process control — that requires the desktop or CLI.
- **Push Notifications** — Configurable per project: build broke, health check failed, new critical CVE, deadline approaching (#20). Pluggable transport: APNs / FCM via a self-hosted relay, or use email / Pushover / ntfy.sh as transports for users who don't want any push service at all.
- **Pairing** — Desktop generates a QR code; phone scans it. Pairing creates a per-device token; revocable from desktop Settings. No account, no cloud sync.
- **Transport** — When on the same LAN, direct connection. Off-LAN: optional relay (self-hostable; same `runhq serve` binary from #12 with a `--relay` mode), or only-LAN-by-default for users who don't want any internet exposure.
- **Tauri Mobile** — Reuses the React frontend behind a stripped, mobile-first layout. No native rewrite.

### Why

The cockpit metaphor extends to "ambient awareness" — the same way you glance at a smartwatch for a notification. A read-only mobile mirror turns RunHQ from a window-on-demand into an always-on telemetry surface, without inheriting the maintenance burden of a full mobile editor.

---

## 32. Team Mode & Shared Workspace Config

**Priority:** Medium-High | **Effort:** Medium | **Status:** Proposed

Today RunHQ is a single-developer tool. The same `~/.runhq/config.json` that lives privately on each laptop holds repeatable bootstrap value if it can be split into _"private to me"_ and _"shared with my team"_.

### Scope

- **`runhq.team.json`** — A second config file, committed to the repo. Contains: project name, runtime, commands, ports, default profiles (#17), required env keys (without values), required secret-manager binding (#28), AI redaction extras, recommended health checks (#7).
- **`~/.runhq/config.json`** — Stays as today: per-machine overrides, paths, secrets, layout, history. Never committed.
- **Merge & Override** — When both exist, team config provides the floor; user config layers on top. UI clearly tags which fields come from where, with a "revert to team default" affordance.
- **`runhq import`** — On a fresh clone, `runhq import` (CLI from #8) reads the team config, prompts for any missing path overrides ("where on your machine is the staging Postgres?"), wires up secrets bindings, and registers the project. From clone to running services in under a minute.
- **Templates Reuse** — Service Templates (#16) are the bootstrap; team config is the steady state. A team can ship a template _and_ a team config — the template scaffolds, the team config codifies.
- **Validation in CI** — A `runhq validate` command checks the repo's `runhq.team.json` against the workspace it lives in (do the commands exist? do the ports clash? are the env keys covered?). Plug into pre-commit / CI to keep team config from rotting.

### Why

The single biggest source of "it works on my machine" is undocumented local setup. A team-shared, version-controlled cockpit config codifies that setup at the same level the team already trusts version control to codify code. It's the difference between RunHQ being "my private tool" and "our team's onboarding tool".

---

## Implementation Order

The suggested implementation sequence, balancing impact and dependencies:

| Phase        | Features                                                                                               | Rationale                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1**  | ~~Cross-Project Dashboard~~ (shipped), Bulk Operations                                                 | Highest impact, lowest friction. Transform RunHQ from per-service to cross-project awareness.                                                                                                                       |
| **Phase 2**  | Quick .env Editor, Service Templates                                                                   | High daily value, relatively self-contained. Templates reduce setup friction on day one.                                                                                                                            |
| **Phase 3**  | Internal Browser, ~~Git Diff Viewer~~ (shipped)                                                        | Rich UI features that require new embedded components.                                                                                                                                                              |
| **Phase 4**  | Service Health Checks, Log Persistence, Docker Compose                                                 | Infrastructure improvements that other features can build on. Docker Compose closes the biggest gap in service coverage.                                                                                            |
| **Phase 5**  | Hot Reload / Watch Mode, Service Run Profiles                                                          | Developer velocity — automate the edit-restart loop and make context switching effortless.                                                                                                                          |
| **Phase 6**  | Historical Performance Charts, Workspace Snapshots                                                     | Diagnostics and convenience — turn RunHQ from a snapshot tool into a time-machine for your dev environment.                                                                                                         |
| **Phase 7**  | AI Integration — Foundations + Commit Messages                                                         | Provider plumbing, secure keychain, redaction, streaming, and the smallest viable surface (commit message generator) so the rest can land iteratively without re-platforming.                                       |
| **Phase 8**  | AI Integration — Diff & Log Triage, PR Drafting                                                        | Context-aware surfaces that ride on top of features already shipped (#5, #9). Reuses the foundations from Phase 7.                                                                                                  |
| **Phase 9**  | AI Integration — Project & Cross-Project Q&A                                                           | The hardest surface (context assembly, retrieval) and the one that benefits most from the dashboard data already available (#1).                                                                                    |
| **Phase 10** | Web UI Mode (`runhq serve`), CLI Interface                                                             | Reach — desktop app, browser, and terminal from the same codebase. Unlocks CI/CD, remote dev boxes, and headless environments.                                                                                      |
| **Phase 11** | Remote Machine Management (SSH)                                                                        | The most ambitious — a universal control plane for all machines. Deferred to allow core and web infrastructure to stabilise first.                                                                                  |
| **Phase 12** | Activity Timeline & Standup (#18), Per-Project Notes & Runbook (#19), Build Cache & Disk Hygiene (#26) | Quick-win phase. All three ride on infrastructure already shipped (`timeline.db`, scanner, AI hub) and unlock visible day-one value: "what did I do?", "how does this project work?", and "RunHQ just freed 27 GB". |
| **Phase 13** | Embedded HTTP / API Client (#21), Tunnel & Public Share (#24), Deadline Awareness (#20)                | Surface coverage phase — closes the "alt-tab into Postman / ngrok / calendar" loop. Each item is small and self-contained; can ship in any order.                                                                   |
| **Phase 14** | Monorepo & Workspace Topology (#25), Test Runner Panel (#23)                                           | Enterprise-fit phase. Monorepos and tests dominate professional workflows; the test runner's "affected mode" depends on topology, so they ship together.                                                            |
| **Phase 15** | Secrets Manager (#28), Team Mode & Shared Config (#32), Supply Chain (#27)                             | Multi-developer & regulated-customer phase. Together these unlock fintech / medical / enterprise adoption that today bounces off the single-developer assumption.                                                   |
| **Phase 16** | Database & Cache Inspector (#22), Crash Postmortem Generator (#29)                                     | Diagnostic-depth phase. Rides on #7 (health checks), #9 (log persistence), and the AI plumbing from Phases 7–9.                                                                                                     |
| **Phase 17** | Plugin / Extension System (#30)                                                                        | Platform phase. Once the core surfaces are stable, opening them up to community extensions is the leverage move.                                                                                                    |
| **Phase 18** | Mobile Companion (#31)                                                                                 | Reach phase. Builds on `runhq serve` (#12) for the optional relay; final step in the "cockpit is everywhere you are" arc.                                                                                           |

---

## Contributing

Want to work on one of these? Open an issue referencing the feature and let's discuss the design before jumping into code. RunHQ's architecture (headless core + thin Tauri shell) makes most of these additions clean and modular.
