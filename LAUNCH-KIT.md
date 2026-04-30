# RunHQ Launch Kit — All Content

# Copy-paste each section to the relevant platform. Do NOT commit this file.

---

## ═══════════════════════════════════════════

## 10. SHOW HN POST

## ═══════════════════════════════════════════

Title: Show HN: RunHQ – One window for every local dev service (no Docker required)

Body:

I got tired of managing 15+ terminal tabs across multiple projects — one for the web app, one for the API, one for the worker, one for the database, plus `lsof -i :3000` every time something holds a port.

RunHQ is a native desktop app (Tauri + Rust) that replaces that ritual with a single control panel:

- Auto-discovers projects across 10 runtimes (Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker, Bun)
- Starts/stops/restarts services with one click or Cmd+K
- Embedded PTY terminal per service
- Real-time port watchdog with one-click kill
- Unified log stream with search
- Global hotkey (Cmd+Shift+K) to control services from any app
- <100MB RAM, zero telemetry, MIT license

It's not a Docker replacement — it's what you reach for when Docker is overkill. Your code runs exactly the way you already run it.

Install: `brew tap erdembas/tap && brew install --cask runhq` (macOS) or download from releases (Linux/Windows).

https://github.com/erdembas/runhq

---

## ═══════════════════════════════════════════

## 11. REDDIT POSTS

## ═══════════════════════════════════════════

### r/MacApps

Title: RunHQ — A native macOS app that replaces all your dev terminal tabs with one window

Body:

If you work on multiple projects or polyglot stacks, you know the pain: 10+ terminal tabs, `lsof -i :3000` to find what's holding a port, and no unified view of what's running.

RunHQ is a free, open-source (MIT) macOS app built with Tauri + Rust that gives you a single window to:

- Auto-discover and manage projects (Node, Go, Python, Rust, .NET, Java, Ruby, PHP, Docker)
- Start/stop/restart services with one click
- Kill ports instantly with the port watchdog
- View all logs in a unified stream
- Use Cmd+K command palette or Cmd+Shift+K global hotkey

It uses <100MB RAM, has zero telemetry, and works fully offline. No Docker required — your code runs natively.

Install: `brew tap erdembas/tap && brew install --cask runhq`

GitHub: https://github.com/erdembas/runhq
Website: https://runhq.dev

---

### r/rust

Title: RunHQ — A Tauri + Rust desktop app for local dev service orchestration (zero telemetry, <100MB RAM)

Body:

Built RunHQ as a local service orchestrator using Tauri v2 with a headless Rust core (`runhq-core` crate). The core knows nothing about Tauri — it uses a trait-based `EventSink` pattern so the same logic will power a future CLI.

Architecture:

- `crates/runhq-core/` — pure Rust domain: process supervisor, port scanner, runtime auto-discovery (10 providers via `RuntimeProvider` trait), log ring buffers, editor detection
- `apps/desktop/src-tauri/` — thin Tauri shell: IPC commands, PTY manager, system tray
- `apps/desktop/src/` — React + Vite + Tailwind + xterm.js

The `RuntimeProvider` trait is ~50 lines to implement — makes adding new language support (Swift, Elixir, etc.) a clean, self-contained PR. We have 4 good-first-issues open for new providers.

The process supervisor does SIGTERM → configurable grace → SIGKILL. Port watchdog reads `/proc/net/tcp` (Linux) and `lsof` (macOS) to list all TCP listeners in real-time.

MIT licensed, zero telemetry, cross-platform. Would love feedback from the Rust community.

https://github.com/erdembas/runhq

---

### r/selfhosted

Title: RunHQ — Self-hosted local dev orchestrator (no cloud, no account, no telemetry)

Body:

RunHQ is a fully local, open-source (MIT) desktop app that orchestrates your dev services without any cloud dependency:

- No account required
- No telemetry or analytics
- No network calls (fully offline capable)
- Config stored locally at `~/.runhq/config.json`
- Auto-discovers your projects and their run commands
- Manages processes, monitors ports, streams logs — all locally

Built with Rust + Tauri for <100MB RAM. Works on macOS, Linux, Windows.

The headless Rust core is designed to eventually power a CLI, making it useful for headless servers and CI too.

https://github.com/erdembas/runhq

---

## ═══════════════════════════════════════════

## 12. PRODUCT HUNT LISTING

## ═══════════════════════════════════════════

Name: RunHQ

Tagline: The local dev cockpit — run, watch, and debug every service in one window

Description:
RunHQ is the universal local service orchestrator. One native desktop app to start, stop, monitor, and debug every local dev service — Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker — without containers.

✅ Auto-discovers your projects and their run commands
✅ One-click start/stop/restart with Cmd+K command palette
✅ Real-time port watchdog with instant kill
✅ Unified log stream with search
✅ Embedded terminal per service
✅ Global hotkey (Cmd+Shift+K) — control services from any app
✅ <100MB RAM, zero telemetry, MIT open source
✅ macOS, Linux, Windows

Topics: Developer Tools, Open Source, Productivity, Rust

First comment (as maker):
Hey everyone! I built RunHQ because I was tired of managing 15+ terminal tabs across multiple projects every day. Every project has its own ritual — `pnpm dev` here, `go run ./cmd/api` there, `docker compose up` somewhere else — and I kept losing track of what was running on which port.

RunHQ replaces all of that with a single window. It auto-discovers your projects, suggests run commands, and gives you a unified control panel with logs, terminals, and a port watchdog.

It's fully local — no cloud, no account, no telemetry. Your code runs exactly the way you already run it. Built with Rust + Tauri for a native feel at <100MB RAM.

Would love to hear what you think! Happy to answer any questions.

---

## ═══════════════════════════════════════════

## 13. X/TWITTER THREAD 1: The Problem

## ═══════════════════════════════════════════

I got tired of 15+ terminal tabs. So I built RunHQ — one window for every local dev service.

Here's why and how 🧵

1/7

Every morning I open the same ritual:

- Terminal 1: pnpm dev (web)
- Terminal 2: go run ./cmd/api
- Terminal 3: docker compose up db
- Terminal 4: python worker.py
- Terminal 5: lsof -i :3000 (something's holding the port again)

2/7

Then I switch projects and do it all over again. Different commands. Different READMEs. Different port conflicts.

I asked: why isn't there ONE window that knows my projects and how to run them?

3/7

So I built RunHQ. It auto-discovers your projects — Node, Go, Python, Rust, .NET, Java, Ruby, PHP, Docker — and suggests the right run commands.

Register once. Run forever.

4/7

It's not another Docker wrapper. Your code runs exactly the way you already run it. Native. No containers. No overhead.

5/7

Key features:
✅ Cmd+K command palette
✅ Global hotkey (Cmd+Shift+K) — works from ANY app
✅ Port watchdog with one-click kill
✅ Unified logs with search
✅ Embedded terminal per service
✅ <100MB RAM, zero telemetry

6/7

Built with Rust + Tauri. The core is headless — same logic will power a CLI soon. MIT licensed. macOS, Linux, Windows.

7/7

Try it: brew tap erdembas/tap && brew install --cask runhq

GitHub: github.com/erdembas/runhq
Website: runhq.dev

Star ⭐ if you believe devs deserve better than 15 terminal tabs.

---

## ═══════════════════════════════════════════

## 13. X/TWITTER THREAD 2: Technical Deep Dive

## ═══════════════════════════════════════════

How does RunHQ auto-discover your projects? A technical thread on the RuntimeProvider trait 🦀🧵

1/5

Every language in RunHQ is a pluggable provider — not a hardcoded branch. The trait is simple:

```rust
pub trait RuntimeProvider: Sync + Send {
    fn label(&self) -> &'static str;
    fn detect(&self, dir: &Path) -> Option<ProjectCandidate>;
}
```

2/5

Each provider checks for its manifest file (go.mod, package.json, Cargo.toml, etc.), extracts the project name, and suggests run commands. If the manifest doesn't exist → return None. Clean.

3/5

We walk the project tree up to 4 levels deep, skipping node_modules, target, .git, etc. Each directory is tested against all 10 providers. First match wins — so package.json + docker-compose.yml in the same dir picks the higher-priority provider.

4/5

Adding a new runtime is ~50 lines of Rust. Implement the trait, register it, add a test. That's it.

We have 4 good-first-issues open for Swift, Elixir, Bun, and Helm providers. PRs welcome!

5/5

The core crate (`runhq-core`) has zero UI dependencies. It uses a trait-based EventSink — the Tauri shell just implements the sink. This means the same core will power a CLI without any refactoring.

github.com/erdembas/runhq

---

## ═══════════════════════════════════════════

## 13. X/TWITTER THREAD 3: Comparison

## ═══════════════════════════════════════════

RunHQ vs Foreman vs PM2 vs Docker Desktop — why another process manager? 🧵

1/4

Foreman/Honcho: Procfile-only, CLI, no UI, no auto-discovery. Great for Rails apps in 2014. Not great for polyglot stacks in 2025.

PM2: Node.js-first. Has a web dashboard but it's Node all the way down. Doesn't know about go.mod or Cargo.toml.

2/4

Docker Desktop: 1-4GB RAM, requires containerization, has telemetry. It's the right tool when you need containers. Overkill when you don't.

Overmind: Procfile + tmux. Terminal-only. macOS/Linux.

3/4

RunHQ:

- 10 runtimes (not just Node or Procfile)
- Native desktop UI with auto-discovery
- <100MB RAM
- Port watchdog, command palette, embedded terminal
- Zero telemetry, MIT license
- Cross-platform (macOS, Linux, Windows)

4/4

RunHQ isn't a Docker replacement. It's what you reach for when Docker is overkill. Use it alongside containers or without them.

brew tap erdembas/tap && brew install --cask runhq
github.com/erdembas/runhq

---

## ═══════════════════════════════════════════

## 13. X/TWITTER THREAD 4: Roadmap & Community

## ═══════════════════════════════════════════

RunHQ v0.5.1 is out. Here's what's next — and how you can help 🧵

1/3

Roadmap highlights:
🔹 Cross-project dashboard (git status, resource heatmap, stale projects)
🔹 Bulk operations (git pull all, bulk start/stop)
🔹 Activity timeline (standup summaries!)
🔹 Internal browser (preview web services in-app)
🔹 CLI interface (headless core is ready)
🔹 Workspace snapshots (save/restore your exact dev state)

2/3

The architecture makes most of these clean additions:

- Headless Rust core + thin Tauri shell
- RuntimeProvider trait for new language support
- EventSink trait for event abstraction

We have good-first-issues open for Swift, Elixir, Bun, and Helm providers. Each is ~50 lines of Rust.

3/3

MIT licensed. Zero telemetry. Built by devs who got tired of 15 terminal tabs.

Star ⭐ the repo, try it, and let us know what's missing:
github.com/erdembas/runhq

---

## ═══════════════════════════════════════════

## 14. DEV.TO ARTICLE 1: Personal Story

## ═══════════════════════════════════════════

Title: How I Replaced 15 Terminal Tabs with One Rust App

Body:

# How I Replaced 15 Terminal Tabs with One Rust App

Every morning, I open the same ritual. Terminal tab 1 for the web app (`pnpm dev`). Tab 2 for the API (`go run ./cmd/api`). Tab 3 for the worker (`dotnet run`). Tab 4 for the database (`docker compose up db`). Tab 5 for `lsof -i :3000` because something is _still_ holding that port.

Then I switch projects and do it all over again. Different commands. Different READMEs. Different port conflicts.

After months of this, I asked: **why isn't there one window that knows my projects and how to run them?**

## The Problem

Modern developers work across multiple projects and multiple languages. Your typical day involves:

- Remembering how to boot each project (was it `npm run dev` or `pnpm dev`? `go run main.go` or `go run ./cmd/api`?)
- Managing 10+ terminal tabs
- Finding what's holding port 3000 (again)
- Switching between editor, terminal, and browser constantly
- Losing context when you restart your machine

Existing tools solve fragments of this:

- **Foreman/Honcho** manage Procfiles but are CLI-only and require a Procfile
- **PM2** is great for Node.js but doesn't know about Go or Rust
- **Docker Desktop** works but uses 1-4GB RAM and forces containerization
- **tmux** is powerful but requires memorizing keybindings and doesn't auto-discover anything

None of them give you a **unified, auto-discovered, GUI-driven** experience across all your projects.

## Enter RunHQ

I built [RunHQ](https://runhq.dev) — a native desktop app that replaces all of that with a single window.

RunHQ auto-discovers your projects by scanning for manifest files (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `.csproj`, `pom.xml`, `Gemfile`, `composer.json`, `compose.yaml`). It suggests the right run commands. You register each service once, then control everything from one place.

### What it does

- **Auto-discovery**: Drop a project directory into RunHQ and it figures out the runtime and suggests commands
- **One-click start/stop/restart**: No more hunting for the right terminal tab
- **Port watchdog**: Live list of all TCP listeners with one-click kill
- **Unified logs**: All service logs in one stream with search and filtering
- **Embedded terminal**: Full PTY terminal per service (xterm.js with Nerd Font support)
- **Command palette**: Cmd+K to fuzzy-search services and actions
- **Global hotkey**: Cmd+Shift+K brings RunHQ to the front from _any_ application
- **Editor integration**: Open projects in VS Code, Cursor, Zed, WebStorm, or 4 other editors

### What it doesn't do

- **No telemetry**: Zero network calls, fully offline
- **No Docker required**: Your code runs natively, exactly the way you already run it
- **No account**: No sign-up, no cloud sync, no SaaS
- **No Electron**: Built with Tauri + Rust for <100MB RAM

## The Architecture

RunHQ is built with a clean separation:

```
crates/runhq-core/     # Pure Rust domain logic (no UI deps)
apps/desktop/src-tauri/ # Thin Tauri shell: IPC + event sink
apps/desktop/src/       # React + Vite + Tailwind + xterm.js
```

The core crate uses a trait-based `EventSink` pattern. The Tauri shell just implements the sink. This means the **same core will power a CLI** without any refactoring — a `runhq start api` or `runhq logs web --follow` is coming soon.

Runtime support is also trait-based. Adding a new language (e.g., Swift, Elixir) is ~50 lines of Rust:

```rust
impl RuntimeProvider for SwiftProvider {
    fn label(&self) -> &'static str { "swift" }
    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        if dir.join("Package.swift").exists() {
            // return suggestions
        }
        None
    }
}
```

## Try It

```bash
# macOS (recommended)
brew tap erdembas/tap
brew install --cask runhq

# Linux  — download .deb, .rpm, or AppImage from releases
# Windows — download .exe (NSIS) or .msi from releases
```

Or [download from GitHub Releases](https://github.com/erdembas/runhq/releases/latest) for any platform.

RunHQ is MIT licensed, open source, and actively developed. Check out the [roadmap](https://github.com/erdembas/runhq/blob/main/ROADMAP.md) for what's coming next — cross-project dashboards, bulk git operations, activity timelines, and more.

If you're tired of terminal tab chaos, give it a try. And if you want to add support for your favorite language, there are [good first issues](https://github.com/erdembas/runhq/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) waiting.

---

## ═══════════════════════════════════════════

## 14. DEV.TO ARTICLE 2: Practical Guide

## ═══════════════════════════════════════════

Title: Local Dev Orchestration Without Docker: A Practical Guide with RunHQ

Body:

# Local Dev Orchestration Without Docker: A Practical Guide with RunHQ

Docker is powerful. But for local development, it's often overkill.

You don't need containers to run `pnpm dev`. You don't need Docker Compose to start a Go API. You _especially_ don't need 2GB of RAM sitting idle in Docker Desktop when you're just iterating on a frontend.

Yet most developers reach for Docker because the alternative — managing a dozen terminal tabs — is worse.

**There's a middle ground.** Run your services natively, but with proper orchestration: auto-discovery, unified logs, port management, and a single control panel.

## The Setup

Let's say you have a typical full-stack project:

```
my-platform/
├── web/          # Next.js frontend (pnpm dev → :3000)
├── api/          # Go API (go run ./cmd/api → :8080)
├── worker/       # Python worker (uv run worker.py)
└── docker-compose.yml  # Postgres + Redis
```

### Without RunHQ

You open 5+ terminals:

```bash
# Terminal 1
cd web && pnpm dev

# Terminal 2
cd api && go run ./cmd/api

# Terminal 3
cd worker && uv run worker.py

# Terminal 4
docker compose up db redis

# Terminal 5
lsof -i :3000  # something's holding the port again
```

Every time you restart your machine, you repeat this. Every time you switch projects, you repeat this.

### With RunHQ

1. Open RunHQ
2. Add the `my-platform` directory
3. RunHQ auto-discovers all 4 services and suggests commands
4. Click "Start All" — done

All logs stream into one view. Port conflicts are visible instantly. You can kill a port with one click. And when you come back tomorrow, everything is still configured.

## Key Workflows

### Port Watchdog

Something is holding port 3000 and you don't know what. In RunHQ:

1. Open the Port Watchdog tab
2. See every TCP listener on your machine
3. Find `:3000` — it's that old Node process from yesterday
4. Click "Kill" — done

No more `lsof -i :3000` → `kill -9 <pid>`.

### Command Palette

Press Cmd+K (or Ctrl+K on Linux/Windows):

- Fuzzy-search any service, stack, or action
- Start, stop, restart without touching the mouse
- Jump to a service's logs or terminal

### Global Hotkey

Press Cmd+Shift+K from _any_ application — even when RunHQ is hidden in the system tray. The Quick Action window pops up, you start/stop a service, and you're back in your editor. Zero context switch.

### Editor Integration

RunHQ detects which editors you have installed (VS Code, Cursor, Zed, WebStorm, etc.) and lets you open any project directly. One click from the dashboard → your editor opens in the right directory.

## When You _Do_ Need Docker

RunHQ doesn't replace Docker — it works alongside it. Use Docker Compose for infrastructure (databases, caches, message queues) and RunHQ for application services. Or use RunHQ to manage `docker compose up` as just another service alongside your native processes.

## Install

```bash
# macOS
brew tap erdembas/tap
brew install --cask runhq

# Linux & Windows — download from releases
```

Or download from [GitHub Releases](https://github.com/erdembas/runhq/releases/latest) for any platform.

RunHQ is MIT licensed, open source, and uses <100MB RAM at idle. No telemetry, no account, no cloud.

[GitHub](https://github.com/erdembas/runhq) · [Website](https://runhq.dev)

---

## ═══════════════════════════════════════════

## 14. DEV.TO ARTICLE 3: Technical Architecture

## ═══════════════════════════════════════════

Title: Building a Tauri App with a Headless Rust Core: Lessons from RunHQ

Body:

# Building a Tauri App with a Headless Rust Core: Lessons from RunHQ

When I started building [RunHQ](https://runhq.dev), I knew I wanted two things:

1. A native desktop app with a great UI
2. The same core logic to eventually power a CLI

The answer: a **headless Rust core** with a thin Tauri shell. Here's how it works and what I learned.

## The Architecture

```
runhq/
├── crates/runhq-core/       # Pure Rust — no Tauri, no UI
│   └── src/
│       ├── supervisor.rs    # Process lifecycle management
│       ├── scanner.rs       # Project auto-discovery
│       ├── ports.rs         # Port watchdog
│       ├── logs.rs          # Ring buffer log storage
│       ├── editors.rs       # Editor detection
│       └── state.rs         # Application state
├── apps/desktop/
│   ├── src-tauri/           # Tauri shell: IPC commands, PTY, tray
│   └── src/                 # React + Vite + Tailwind + xterm.js
```

The rule is simple: **if it's business logic, it lives in `runhq-core`**. The Tauri crate is only allowed to do IPC wiring, platform-specific things (PTY, system tray), and implement the `EventSink` trait.

## The EventSink Pattern

The core crate doesn't know about Tauri's event system. Instead, it defines a trait:

```rust
pub trait EventSink: Send + Sync {
    fn emit(&self, event: AppEvent);
}
```

The Tauri shell implements this trait using Tauri's `app.emit()`:

```rust
struct TauriSink { app: AppHandle }

impl EventSink for TauriSink {
    fn emit(&self, event: AppEvent) {
        self.app.emit("runhq-event", &event).ok();
    }
}
```

For tests, we use `NullSink` (discards all events) or `VecSink` (collects events for assertions). For the future CLI, we'll implement a `StdioSink` that prints to stdout.

This pattern means **zero refactoring** when we add the CLI. The core already works without a GUI.

## The RuntimeProvider Trait

Auto-discovery is powered by a trait:

```rust
pub trait RuntimeProvider: Sync + Send {
    fn label(&self) -> &'static str;
    fn detect(&self, dir: &Path) -> Option<ProjectCandidate>;
}
```

Each provider is a self-contained unit that checks for its manifest file and returns suggestions. Adding a new runtime is ~50 lines of Rust — implement the trait, register it, add a test.

This has been great for open-source contributions. New contributors can add a provider without understanding the rest of the codebase.

## Process Supervision

The supervisor manages child processes with a clear lifecycle:

1. **Start**: Spawn the process with the configured command and environment
2. **Monitor**: Track PID, sample CPU/RAM every 2s
3. **Stop**: Send SIGTERM, wait for a configurable grace period, then SIGKILL
4. **Cleanup**: Kill the entire process group (not just the direct child) to prevent zombie orphans

On Unix, we use `kill(-pgid, signal)` to hit the process group. On Windows, we use `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.

## Ring Buffer Logs

Each service gets a bounded ring buffer (10,000 lines). Logs are stored in memory with atomic writes — no disk I/O on every log line. The UI uses virtualized rendering (only visible rows are in the DOM) so 10k lines scroll smoothly.

## Lessons Learned

### 1. Keep the core headless from day one

Even if you don't plan a CLI, the discipline of keeping business logic out of the UI layer pays off. Tests are easier to write, refactoring is safer, and the architecture is cleaner.

### 2. Traits over enums for extensibility

I could have used an enum for runtime providers. But the trait approach means new providers can be added in a single PR without touching existing code. It's the open/closed principle in practice.

### 3. Tauri's IPC is fast enough

I was worried about the overhead of Tauri's IPC (Rust ↔ JavaScript). In practice, for a dev tool that updates at most every 100ms, it's negligible. The bottleneck is never IPC — it's the PTY or the process spawning.

### 4. Ring buffers > unbounded vectors

Unbounded log storage is a footgun. Ring buffers give you predictable memory usage and the UI never needs to handle "too many logs" edge cases.

## Try It

```bash
brew tap erdembas/tap
brew install --cask runhq
```

[GitHub](https://github.com/erdembas/runhq) · [Website](https://runhq.dev)

---

## ═══════════════════════════════════════════

## 15. INFLUENCER DM TEMPLATES

## ═══════════════════════════════════════════

### Tauri Discord / Tauri team

Hey! I built RunHQ with Tauri v2 — it's a local dev service orchestrator (auto-discovers Node/Go/Python/Rust/etc. projects, manages processes, port watchdog, embedded terminal). The core is a headless Rust crate with EventSink trait, Tauri shell just implements the sink.

Would love to share it in the #showcase channel if that's appropriate. Also happy to contribute a Tauri example if the team finds the architecture useful.

GitHub: https://github.com/erdembas/runhq
Website: https://runhq.dev

---

### Rust YouTuber (e.g., Logology, Let's Get Rusty)

Hey! I'm a fan of your Rust content. I recently open-sourced RunHQ — a local dev orchestrator built with Tauri + Rust. The architecture has some patterns your audience might find interesting: headless Rust core with EventSink trait, RuntimeProvider trait for extensibility, process supervision with SIGTERM→SIGKILL, ring buffer logs.

It's MIT licensed, <100MB RAM, zero telemetry. Would you be interested in taking a look? No pressure at all — just thought it might be up your alley.

https://github.com/erdembas/runhq

---

### Dev tools YouTuber (e.g., ThePrimeagen, TJ DeVries)

Hey! I built RunHQ — a native desktop app that replaces all your dev terminal tabs with one window. Auto-discovers projects (Node, Go, Python, Rust, etc.), manages processes, has a port watchdog, embedded terminal, and Cmd+K command palette.

Built with Rust + Tauri, <100MB RAM, zero telemetry. Free + MIT.

Thought it might be interesting for your workflow/terminal content. Would love a look if you have time — no pressure.

https://github.com/erdembas/runhq

---

### Newsletter: This Week in Rust

Submit URL: https://this-week-in-rust.org/submit/

Title: RunHQ — Universal local service orchestrator (Tauri + Rust)

Description: RunHQ is a native desktop app that auto-discovers and manages local dev services across 10 runtimes. Built with a headless Rust core (runhq-core crate) and thin Tauri shell. Features process supervision, port watchdog, unified logs, and command palette. MIT licensed, zero telemetry.

---

### Newsletter: Changelog

Submit URL: https://changelog.com/submit/

Title: RunHQ — The universal local service orchestrator

Description: A native desktop app (Tauri + Rust) that replaces 15+ terminal tabs with one window. Auto-discovers projects across 10 runtimes, manages processes, monitors ports, streams logs. No Docker required, no telemetry, MIT licensed.

---

## ═══════════════════════════════════════════

## 9. AWESOME LIST PR CONTENT

## ═══════════════════════════════════════════

### awesome-tauri (https://github.com/tauri-apps/awesome-tauri)

PR Title: Add RunHQ to the list

PR Body:

## RunHQ

- **Name**: RunHQ
- **Description**: The universal local service orchestrator — one window for every local dev service
- **Category**: Productivity / Developer Tools
- **GitHub**: https://github.com/erdembas/runhq
- **Website**: https://runhq.dev
- **License**: MIT
- **Platforms**: macOS, Linux, Windows

RunHQ auto-discovers projects across 10 runtimes (Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker, Bun), manages processes with graceful shutdown, provides a port watchdog, unified logs, embedded terminal, and command palette. Built with Tauri v2 + Rust core.

Entry to add:

```markdown
- [RunHQ](https://github.com/erdembas/runhq) — The universal local service orchestrator. One window for every local dev service.
```

---

### awesome-rust (https://github.com/rust-unofficial/awesome-rust)

PR Title: Add RunHQ — local service orchestrator

PR Body:

## RunHQ

- **Repo**: https://github.com/erdembas/runhq
- **Description**: The universal local service orchestrator — auto-discovers and manages local dev services across 10 runtimes from a native desktop UI
- **Category**: Applications / Developer Tools
- **License**: MIT

RunHQ is built with a headless Rust core (`runhq-core` crate) and Tauri v2 shell. The core uses trait-based `RuntimeProvider` for extensibility and `EventSink` for event abstraction, designed to also power a future CLI.

Entry to add (under Applications > Developer Tools):

```markdown
- [RunHQ](https://github.com/erdembas/runhq) - Local service orchestrator with auto-discovery, port watchdog, and unified logs. [![Build](https://img.shields.io/github/actions/workflow/status/erdembas/runhq/ci.yml?style=flat-square)](https://github.com/erdembas/runhq/actions)
```

---

### awesome-devtools (https://github.com/neoclide/awesome-devtools) or similar

PR Title: Add RunHQ — local dev service orchestrator

PR Body:

## RunHQ

- **Website**: https://runhq.dev
- **GitHub**: https://github.com/erdembas/runhq
- **Description**: A native desktop app that replaces all your dev terminal tabs with one window. Auto-discovers projects (Node, Go, Python, Rust, .NET, Java, Ruby, PHP, Docker), manages processes, monitors ports, streams logs. No Docker required, zero telemetry, MIT licensed.

Entry to add:

```markdown
- [RunHQ](https://runhq.dev) - One window for every local dev service. Auto-discovers, runs, and monitors across 10 runtimes.
```
