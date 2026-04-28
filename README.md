<p align="center">
  <img src="docs/icon.png" alt="RunHQ" width="128" height="128" />
</p>

<h1 align="center">RunHQ</h1>
<p align="center">
  <b>The cockpit for your local dev portfolio.</b><br />
  One window over every project on your disk — health, CVEs, deps, ports, processes,<br />
  git, AI. Auto-indexed across Node, Go, .NET, Python, Java, Rust, Ruby, PHP, Docker.
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
    <img src="docs/dashboard.png" alt="RunHQ dashboard — every project on your machine, one cockpit" width="100%" />
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

You don't have a service problem. You have a **portfolio problem**.

Your `~/code` (or `~/projects`, `~/work`, `~/Developer`) folder has 30+ repos. Half are dormant client work. Three are the side project you'll definitely finish next quarter. Two are the actual money-makers. And one — you can't remember which — has a critical CVE in `lodash` you've been meaning to patch for three weeks.

Today you find them by `cd ~/code/<tab-tab-tab>`, squinting at directory names, hoping the right thing surfaced in your IDE's "recent projects", re-running `npm outdated` per-repo every couple of months, and re-reading the `README.md` of a project you forgot how to boot. Repeat per repo, per week.

RunHQ replaces that scavenger hunt with a **persistent portfolio cockpit**: every local project, indexed once, surfaced forever. Health and CVE state at a glance. One click into your editor. One keystroke to run that weird build command nobody documented. AI that reasons across all your projects together, not one at a time.

- **Your portfolio, indexed.** RunHQ scans your dev folders and parks every project on a dashboard — running or not, scanned or not. Auto-discovers 10 runtimes (Node, Bun, Deno, .NET, Java with Maven & Gradle, Go, Rust, Python, Ruby, PHP, Docker) and persists the registry to `~/.runhq/config.json`. The dashboard paints from a local SQLite cache on cold start — no 30-second "loading…" before you see your own machine.
- **Health at a glance.** Per-project chips for critical/high CVEs, outdated packages, stale scans (>7 days), dirty git, ports listening, CPU/RAM. The hero answers _"what needs me this week?"_ with a single state-aware headline ("2 critical CVEs", "3 services running", or just "Workspace idle"). A unified filter bar slices the roster by attention bucket or git state.
- **Drop in, ship out.** One click opens the project in any of 8 editors (VS Code, Cursor, Windsurf, Zed, Sublime, WebStorm, IDEA, Neovim). One keystroke runs any of its registered commands — `pnpm dev`, `cargo run`, `make migrate`, your custom shell script. Cmd+K palette fuzzy-searches across every project and command in your portfolio; Cmd+Shift+K opens the same palette as a floating window without leaving your editor. Embedded PTY terminal if you'd rather stay native.
- **AI across the portfolio, not in it.** "Analyze workspace" generates a cross-project report in seconds — _"these 3 haven't been touched in 90 days, this one has a critical CVE in `axios`, that one has 12 outdated packages including a React major"_. Per-surface AI (log triage, diff explain, commit message, CVE deep-dive, standup polish) all feed into the same multi-tab chat with persistent SQLite history. BYO OpenAI-compatible endpoint — Ollama, LM Studio, llama.cpp, vLLM locally; OpenAI, Azure, Together, OpenRouter, Groq, DeepSeek in the cloud.
- **Local-first, private, offline.** Point the AI at a model on your laptop and nothing — no code, no diffs, no logs, no project names — ever leaves your machine. No telemetry, no cloud sync, no account. < 100 MB RAM idle. The whole app runs natively in a 15 MB Tauri shell, not a 200 MB Electron one.
- **Process supervision when you need it.** Yes, RunHQ can also start/stop services with graceful shutdown (SIGTERM → grace → SIGKILL), kill the rogue process holding port `:3000`, and tail unified logs across every running service. That's one sub-feature of the cockpit, not the headline. If all you wanted was to replace your Procfile, Foreman is fine. RunHQ exists for the day you have 30 of them.

## Comparison

RunHQ doesn't have a clean head-to-head competitor — most tools own one column of the cockpit. Below is the closest "I already use X for that" map, plus what RunHQ adds on top.

|                                                           | **RunHQ**                                                             | **Foreman / Overmind / PM2** | **Docker Desktop**    | **JetBrains "Recent projects"** | **`tmux` + `~/.zshrc` aliases** |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------- | --------------------- | ------------------------------- | ------------------------------- |
| **Indexes every project on disk**                         | Yes — auto-scan + persistent registry                                 | No (one Procfile per repo)   | No                    | Recents only, IDE-bound         | No                              |
| **Cross-project health (CVE / outdated / stale / dirty)** | Yes — persisted SQLite, paint instant on cold start                   | No                           | No (image scans only) | No                              | No                              |
| **Cross-project AI report**                               | Yes — "Analyze workspace" across the whole portfolio                  | No                           | No                    | No                              | No                              |
| **Per-project process supervision**                       | Yes — SIGTERM → grace → SIGKILL, multi-command                        | Yes (their main feature)     | Yes (containers only) | No                              | No                              |
| **Port watchdog + one-click kill**                        | Yes — live TCP list                                                   | No                           | Partial               | No                              | No                              |
| **Open in editor**                                        | 8 editors detected per project                                        | No                           | No                    | Self only                       | No                              |
| **Command palette across the portfolio**                  | Cmd+K + Cmd+Shift+K global hotkey                                     | No                           | No                    | Per-IDE only                    | No                              |
| **Runtimes**                                              | 10 (Node, Bun, Deno, .NET, Java, Go, Rust, Python, Ruby, PHP, Docker) | Procfile only                | Docker only           | IDE-bound                       | Whatever you write              |
| **RAM idle**                                              | < 100 MB                                                              | ~0 (CLI)                     | 1–4 GB                | 700 MB+                         | ~0                              |
| **Native, not containerised**                             | Yes                                                                   | Yes                          | No (containers only)  | Yes                             | Yes                             |
| **Local-first AI (no cloud required)**                    | Yes — Ollama / LM Studio / llama.cpp                                  | No                           | No                    | Cloud-only assistants           | No                              |
| **Telemetry**                                             | None                                                                  | None                         | Yes                   | Yes (opt-out)                   | None                            |
| **License**                                               | MIT                                                                   | MIT / AGPL-3.0               | Proprietary           | Proprietary                     | OSS                             |

> RunHQ doesn't replace Docker, Foreman, or your IDE — it's the surface that **knows about all of them at once**, so your portfolio doesn't live in your head. Use it alongside containers, alongside `tmux`, alongside JetBrains. The cockpit is the thing that's missing today.

## Features

### Portfolio cockpit (the headline)

- **Auto-discovery across 10 runtimes** — Node, Bun, Deno, .NET, Java (Maven & Gradle), Go, Rust, Python, Ruby, PHP, Docker. Walks your dev folders, infers each project's runtime + start commands, persists the registry to `~/.runhq/config.json`. Custom commands (Makefile targets, migrations, seeds, shell scripts) get tagged onto the project once and live there forever.
- **State-aware dashboard hero** — single headline surfaces the most-pressing portfolio state ("2 critical CVEs", "3 services running", or "Workspace idle") in a tone-matched colour. The ambient gradient mirrors the same state so the page feels calm when calm and alert when not.
- **Unified filter bar** — slice the project roster by attention bucket (Stale / Risk / Outdated) and git state (Dirty / Clean / Ahead / Behind / No upstream) in one row, with explicit "All" reset and a "Clear filters" link the moment anything is active.
- **Cross-project search and launch** — Cmd+K palette fuzzy-finds across every project and every registered command in your portfolio. Cmd+Shift+K opens the same palette as a floating window so you can jump from your editor without alt-tabbing into RunHQ.
- **Open in 8 editors** — VS Code, Cursor, Windsurf, Zed, Sublime, WebStorm, IDEA, Neovim. Detected per project; one click drops you in.
- **Stacks and sections** — group related projects into named stacks (start/stop them together) or pin them to custom sections (Active / Archive / "client X").
- **Worst-offenders band** — auto-surfaces the projects with the highest critical+high CVE count or the most outdated packages right under the hero, so the answer to _"what should I patch next?"_ never requires scrolling.

### Health, deps, CVEs (Dependency Hygiene · 0.7.0)

`npm outdated` / `cargo audit` / `pip audit` results across every project, persisted to a local SQLite store (`dependency_scans.db`) so the dashboard paints chips instantly on cold start instead of flashing empty for 30 seconds.

- **Per-card freshness chip** — "Last scanned 3h ago", color-coded amber after 24h, red after 7 days. Click to rescan **just that project** — no more re-running 30 scans to verify one `lodash` advisory.
- **Scan delta badges** — after a rescan, audit and outdated chips show "+3" / "−1" badges when counts changed since the previous scan. Hidden in steady state — the badge only appears when something actually moved.
- **Stale-rescan pill** in the hero identity line — "N stale" in amber when at least one project's last scan is >7 days old; click to sequentially rescan only those, skipping cache lookups for the fresh ones.
- **GUI-launched binary recovery** — RunHQ probes your login shell PATH and merges Homebrew / cargo / nvm / fnm / volta / asdf / pyenv shim dirs on startup, so `npm outdated` and `cargo audit` actually find their binaries even when the app is launched from Finder/Dock instead of a terminal.
- **Settings → Reset scan cache** — surfaces the cached row count up front, gates the destructive confirm behind a typed `reset` keyword. Removed services drop their scan rows automatically.

### AI Assistant (0.7.0)

A unified right-rail chat hub backed by **any OpenAI-compatible endpoint** — point it at the cloud (OpenAI, Azure, Together, OpenRouter, Groq, DeepSeek) or run it fully offline against a local server (Ollama, LM Studio, llama.cpp, vLLM, text-generation-webui). 8 GB of RAM is enough to drive small open models (Llama 3.2 3B, Qwen2.5-Coder 7B, DeepSeek-Coder-V2 Lite, Phi-4 Mini). Configure as many providers as you like, switch per turn, pick a reply language from a flag-and-search dropdown.

- **Cross-portfolio reasoning** — "Analyze workspace" builds a single report across every project, status, CVE, and outdated bump in one pass. The model gets a snapshot of the whole portfolio so its answer to _"which projects need me this week?"_ is grounded in real data, not guesses.
- **AI on every surface** — Project · Why?, log right-click triage, diff explain, commit message generation, standup polish, dashboard "Analyze workspace" report, and per-CVE deep analysis all route into the same chat hub. Per-turn action hooks ("Use as commit message", "Insert into standup") let the model write _into_ your flow.
- **Multi-tab chat** — up to 5 simultaneous conversations with per-tab streaming indicators, persisted in a local SQLite store (`conversations.db`). Switch projects, reboot, come back tomorrow — your "why is this slow?" thread is still there. History drawer supports favorites (star), search across titles + message content, and pin/archive.
- **Model picker, in place** — multi-provider setups pop a dropdown directly under the AI button you clicked; single-provider setups dispatch immediately. No modal, no mode switch.
- **Live token meter** — `tiktoken-rs` powered, accurate per-model context-window readouts (gpt-4o, claude-3.5, glm-4.5, qwen-2.5, llama-3.1, …) instead of `chars / 4` guesswork.
- **Streaming reliability** — content-progress-based idle timeouts, auto-continue on stalled streams, "answer hidden in reasoning" nudge, partial-turn Continue banner, and a UTF-8 panic fix that turned local-model output from a flaky beta into something you can leave running overnight.

### Process supervision (one column, not the headline)

- **Process supervisor** with multi-command support and graceful shutdown (SIGTERM → grace → SIGKILL). Survives editor crashes, sidebar reloads, and stops cleanly on app quit.
- **Unified log stream** with bounded ring buffers (10 k lines) and virtualized rendering — tail every running service's output in one place, search inline, right-click any line into AI for triage.
- **Real-time port watchdog** — list all TCP listeners, search, one-click **Kill port**. The "wait, what's holding `:3000`?" loop, gone.
- **Embedded terminal** — full PTY via xterm.js with Nerd Font support and theme-aware rendering, opens to the project's directory by default.
- **Quick Action floating window** — press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> on Windows / Linux) to start/stop services without bringing the full app forward.

### Quality-of-life

- **Atomic, human-readable JSON config** at `~/.runhq/config.json` — diffable, version-controllable, hand-editable.
- **Auto-update** — in-app update banner with one-click "Update & Restart".
- **System tray** — close hides to tray; quit from tray menu.
- **Theme-aware** — dark / light / follow-system, with a coherent semantic palette across status, severity, and tone.

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
