<p align="center">
  <img src="docs/icon.png" alt="RunHQ" width="128" height="128" />
</p>

<h1 align="center">RunHQ</h1>
<p align="center">
  <b>The universal local service orchestrator.</b><br />
  One window to start, stop, monitor, and debug every local dev service —<br />
  Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker — without containers.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="https://runhq.dev"><img alt="website" src="https://img.shields.io/badge/runhq.dev-live-orange" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" />
  <img alt="ram" src="https://img.shields.io/badge/RAM-%3C100MB-green" />
  <img alt="telemetry" src="https://img.shields.io/badge/telemetry-zero-brightgreen" />
</p>

<p align="center">
  <a href="https://runhq.dev/">
    <img src="docs/dashboard.png" alt="RunHQ dashboard — one window for every local service" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://runhq.dev/#install"><strong>Install →</strong></a>
  &nbsp;·&nbsp;
  <a href="https://runhq.dev">Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/erdembas/runhq/issues">Issues</a>
  &nbsp;·&nbsp;
  <a href="./ROADMAP.md">Roadmap</a>
</p>

---

## Why RunHQ?

Terminal tabs are a mess. Containers are heavy. You open a terminal for the web app, another for the API, a third for the worker, a fourth for the database container, then you `lsof -i :3000` because something is still holding the port. RunHQ replaces that ritual with a single always-open control panel — without forcing your code into Docker.

Every project also has its own ritual: `pnpm dev` here, `go run ./cmd/api` there, `uv run train.py` somewhere else, plus migrations, seeds, Makefile targets, custom shell scripts. RunHQ turns all of that into a project cockpit — register each command once, then run it, open the project in your editor, or drop into an embedded terminal with one click or one keystroke. No more digging through a dozen READMEs to remember how to boot a repo.

- **Native, not containerized.** Your project runs exactly the way you already run it.
- **Every project, every command, one window.** Custom commands per service, open-in-editor across 8 editors, embedded PTY terminal, Cmd+K palette, Cmd+Shift+K global hotkey.
- **Local, private, offline.** No telemetry, no cloud sync, no account.
- **One window to rule them.** Start / stop / restart, kill ports, search logs, in one place.
- **AI assistant on every surface — local _or_ cloud, your call.** A right-rail chat hub backed by any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, OpenAI, Azure, Together, OpenRouter, Groq, DeepSeek). Project · Why?, log triage, diff explain, commit message generation, standup polish, workspace report and per-CVE analysis all flow into the same multi-tab chat with persistent SQLite history. Point it at a local model on your laptop and nothing about your code, diffs, or logs ever leaves your machine.

## Comparison

|                        | **RunHQ**                                                       | **Foreman / Honcho** | **PM2**               | **Docker Desktop**    | **Overmind**    |
| ---------------------- | --------------------------------------------------------------- | -------------------- | --------------------- | --------------------- | --------------- |
| **UI**                 | Native desktop (Tauri)                                          | CLI only             | CLI + web dashboard   | Electron GUI          | Terminal (tmux) |
| **Runtimes**           | 10 (Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker, Bun) | Procfile only        | Node.js-first         | Docker only           | Procfile only   |
| **RAM idle**           | < 100 MB                                                        | ~0 (CLI)             | ~60 MB                | 1–4 GB                | ~0 (tmux)       |
| **Auto-discovery**     | Yes — scans project dirs                                        | No                   | No                    | No                    | No              |
| **Port watchdog**      | Yes — live TCP list, one-click kill                             | No                   | No                    | Partial               | No              |
| **Embedded terminal**  | Yes (full PTY)                                                  | No                   | No                    | Yes (limited)         | Yes (tmux)      |
| **Command palette**    | Yes (Cmd+K, global hotkey)                                      | No                   | No                    | No                    | No              |
| **Editor integration** | 8 editors (VS Code, Cursor, Zed, …)                             | No                   | No                    | No                    | No              |
| **AI assistant**       | Yes — BYO endpoint, local or cloud                              | No                   | No                    | No                    | No              |
| **Dependency audit**   | Yes — npm / cargo / pip, persisted, deltas                      | No                   | No                    | No (image scan only)  | No              |
| **Cross-platform**     | macOS, Linux, Windows                                           | macOS, Linux         | macOS, Linux, Windows | macOS, Linux, Windows | macOS, Linux    |
| **Container required** | No                                                              | No                   | No                    | Yes                   | No              |
| **Telemetry**          | None                                                            | None                 | Optional              | Yes                   | None            |
| **License**            | MIT                                                             | MIT                  | AGPL-3.0              | Proprietary           | MIT             |

> RunHQ is not a replacement for Docker — it's the thing you reach for when Docker is overkill. Use it alongside containers or without them.

## Features

### Core

- **Smart project auto-discovery** with 10 runtime providers: Node / Bun / Deno, .NET, Java (Maven & Gradle), Go, Rust, Python, Ruby, PHP, Docker.
- **Process supervisor** with multi-command support and graceful shutdown (SIGTERM → grace → SIGKILL).
- **Unified log stream** with bounded ring buffers (10 k lines) and virtualized rendering.
- **Real-time port watchdog** — list all TCP listeners, search, one-click **Kill port**.
- **Atomic, human-readable JSON config** at `~/.runhq/config.json`.

### Desktop UI

- **Dashboard** with system health bar, service cards, and category grouping (frontend / backend / database / infra / worker / tooling).
- **Embedded terminal** — full PTY via xterm.js with Nerd Font support and theme-aware rendering.
- **Quick Action floating window** — press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> on Windows / Linux) to start/stop services without leaving your editor.
- **Command palette** (<kbd>Cmd</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd>) with fuzzy search, drill-down into service commands, and favorites.
- **Editor integration** — detect and open projects in VS Code, Cursor, Windsurf, Zed, Sublime, WebStorm, IDEA, Neovim.
- **Category & runtime filters** — narrow the service list by category or runtime at a glance.
- **Auto-update** — in-app update banner with one-click "Update & Restart".
- **System tray** — close hides to tray; quit from tray menu.

### AI Assistant (0.7.0)

A unified right-rail chat hub backed by **any OpenAI-compatible endpoint** — point it at the cloud (OpenAI, Azure, Together, OpenRouter, Groq, DeepSeek) or run it fully offline against a local server (Ollama, LM Studio, llama.cpp, vLLM, text-generation-webui). 8 GB of RAM is enough to drive small open models (Llama 3.2 3B, Qwen2.5-Coder 7B, DeepSeek-Coder-V2 Lite, Phi-4 Mini). Configure as many providers as you like, switch per turn, pick a reply language from a flag-and-search dropdown.

- **Multi-tab chat** — up to 5 simultaneous conversations with per-tab streaming indicators, persisted in a local SQLite store (`conversations.db`). Switch projects, reboot, come back tomorrow — your "why is this slow?" thread is still there.
- **AI on every surface** — Project · Why?, log right-click triage, diff explain, commit message generation, standup polish, dashboard "Analyze workspace" report, and per-CVE deep analysis all route into the same chat hub. Per-turn action hooks ("Use as commit message", "Insert into standup") let the model write _into_ your flow.
- **Model picker, in place** — multi-provider setups pop a dropdown directly under the AI button you clicked; single-provider setups dispatch immediately. No modal, no mode switch.
- **Live token meter** — `tiktoken-rs` powered, accurate per-model context-window readouts (gpt-4o, claude-3.5, glm-4.5, qwen-2.5, llama-3.1, …) instead of `chars / 4` guesswork.
- **Streaming reliability** — content-progress-based idle timeouts, auto-continue on stalled streams, "answer hidden in reasoning" nudge, partial-turn Continue banner, and a UTF-8 panic fix that turned local-model output from a flaky beta into something you can leave running overnight.

### Dependency Hygiene (0.7.0)

`npm outdated` / `cargo audit` / `pip audit` results across every project, persisted to a local SQLite store (`dependency_scans.db`) so the dashboard paints chips instantly on cold start instead of flashing empty for 30 seconds.

- **Per-card freshness chip** — "Last scanned 3h ago", color-coded amber after 24h, red after 7 days. Click to rescan **just that project** — no more re-running 30 scans to verify one `lodash` advisory.
- **Scan delta badges** — after a rescan, audit and outdated chips show "+3" / "−1" badges when counts changed since the previous scan. Hidden in steady state — the badge only appears when something actually moved.
- **Stale-alert pill** next to the "Rescan deps" header button — shows "N stale" in amber when at least one project's last scan is >7 days old, click it to sequentially rescan only those (skipping cache lookups for the fresh ones). Sibling **"Discover projects"** button (renamed from "Scan Projects") handles filesystem discovery — no more three buttons containing the word "scan" in the same row.
- **Settings → Reset scan cache** — surfaces the cached row count up front, gates the destructive confirm behind a typed `reset` keyword. Removed services drop their scan rows automatically.

## Install

### Homebrew (macOS) — recommended

```bash
brew tap erdembas/tap
brew install --cask runhq
```

Upgrade later by `brew upgrade --cask runhq`. The cask clears macOS's quarantine attribute automatically on install, so RunHQ opens on first launch with no warnings or terminal tricks.

### winget (Windows)

```powershell
winget install erdembas.RunHQ
```

### Download from GitHub Releases

Grab a pre-built binary for your platform from the [latest release](https://github.com/erdembas/runhq/releases/latest):

- **macOS** — `RunHQ_<version>_aarch64.dmg` (Apple Silicon) or `RunHQ_<version>_x64.dmg` (Intel)
- **Linux** — `runhq_<version>_amd64.deb` or `runhq_<version>_amd64.AppImage`
- **Windows** — `RunHQ_<version>_x64-setup.exe` (installer) or `RunHQ_<version>_x64_en-US.msi`

The app auto-updates in place — you only need to download manually once.

> **macOS direct-DMG first launch:** because RunHQ is ad-hoc signed rather than notarized with an
> Apple Developer ID, double-clicking the app will show _"RunHQ can't be opened because it is
> from an unidentified developer"_. Either right-click → **Open** once, or run this one-liner to
> skip the Gatekeeper check entirely:
>
> ```bash
> xattr -cr /Applications/RunHQ.app
> ```
>
> `brew install --cask runhq` does this for you — recommended if you prefer zero friction.

### Build from source

See the [Development](#development) section below.

## Repository layout

```
runhq/
├── apps/
│   └── desktop/              # React UI + Tauri shell
│       ├── src/              # Frontend (React + Vite + Tailwind + xterm.js)
│       ├── src-tauri/        # Tauri wiring: IPC commands, PTY manager, tray
│       ├── tsconfig.json
│       └── vite.config.ts
├── crates/
│   └── runhq-core/       # Headless Rust core (no Tauri dep)
│       ├── src/              # Domain: supervisor, logs, ports, scanner, editors, state
│       └── tests/            # Integration tests
├── docs/
├── scripts/                  # Distribution helpers (Homebrew cask, winget, icons)
├── Cargo.toml                # Rust workspace
├── pnpm-workspace.yaml       # pnpm workspace
└── package.json              # Workspace root
```

The core crate knows nothing about Tauri. It will eventually power a `RunHQ` CLI too.

## Development

### Prerequisites

Core toolchain (all platforms):

| Tool                | Version                              | How to get it                                                                                                    |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Node.js**         | ≥ 22                                 | [nodejs.org](https://nodejs.org/) or [nvm](https://github.com/nvm-sh/nvm) / [fnm](https://github.com/Schniz/fnm) |
| **pnpm**            | 9.14.4 (pinned via `packageManager`) | `corepack enable && corepack prepare pnpm@9.14.4 --activate`                                                     |
| **Rust**            | stable (latest)                      | [rustup.rs](https://rustup.rs/)                                                                                  |
| **Rust components** | `rustfmt`, `clippy`                  | `rustup component add rustfmt clippy`                                                                            |
| **Git**             | ≥ 2.30                               | system package manager                                                                                           |

Platform-specific build dependencies (needed by the Tauri shell):

#### macOS

Xcode Command Line Tools is enough:

```bash
xcode-select --install
```

#### Linux (Debian / Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  build-essential curl wget file pkg-config libssl-dev
```

For other distros see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).

#### Windows

- **Microsoft Visual Studio C++ Build Tools** — install the "Desktop development with C++" workload from the [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
- **WebView2 Runtime** — pre-installed on Windows 10+; older systems can grab the [Evergreen installer](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### First-time setup

```bash
git clone https://github.com/erdembas/runhq.git
cd runhq
pnpm install          # installs JS deps + activates Husky git hooks
```

The `pnpm install` step also compiles the workspace's TypeScript config and registers Husky hooks that format/lint staged files on every `git commit` (see [Git hooks](#git-hooks) below).

### Common tasks

```bash
pnpm tauri:dev                        # run the desktop app (hot reload)
pnpm tauri:build                      # bundle release binary for your OS

pnpm lint                             # ESLint
pnpm typecheck                        # TypeScript (all packages)
pnpm format                           # Prettier: write
pnpm format:check                     # Prettier: verify only

cargo test -p runhq-core              # core unit/integration tests
cargo clippy --all-targets -- -D warnings
cargo fmt --all
```

### Git hooks

Husky runs on every commit, enforced locally:

- **`pre-commit`** → `lint-staged`: Prettier + ESLint (`--fix`) on staged JS/TS, Prettier on staged JSON/MD/CSS/HTML, `rustfmt` on staged `.rs` files. Only staged files are touched, so it stays fast.
- **`commit-msg`** → `commitlint`: enforces [Conventional Commits](https://www.conventionalcommits.org/) so release automation can version the project correctly.

If you ever need to bypass (use sparingly), prepend `--no-verify`:

```bash
git commit --no-verify -m "wip: noodling"
```

CI still runs the full quality gate, so skipped hooks won't land broken code on `main`.

### State directory

RunHQ keeps all state under `~/.runhq/`:

```
~/.runhq/
├── config.json             # services, preferences — atomic JSON writes
├── conversations.db        # AI chat history (SQLite) — 0.7.0+
├── dependency_scans.db     # persisted npm outdated / cargo audit results — 0.7.0+
└── timeline.db             # activity timeline — 0.6.0+
```

The two databases are independent and can be deleted any time. AI chat history goes through the in-app History drawer; dependency scans can be cleared via Settings → Keyboard Shortcuts → "Reset scan cache".

Override the location with the `RUNHQ_HOME` environment variable (e.g. for tests).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The most impactful contribution is a new runtime provider — see `crates/runhq-core/src/scanner.rs`.

## License

MIT © [Erdem Baş](https://github.com/erdembas). See [LICENSE](./LICENSE).
