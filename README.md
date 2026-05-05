<p align="center">
  <img src="docs/icon.png" alt="RunHQ" width="128" height="128" />
</p>

<h1 align="center">RunHQ</h1>

<p align="center">
  <b>Replace terminal-tab chaos with one local dev cockpit.</b><br />
  Run every project, service, log, port, git state, CVE, and AI triage flow from one window.
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
    <img src="docs/dashboard.png" alt="RunHQ dashboard showing local projects, health chips, and service actions" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://runhq.dev/#install"><strong>Install</strong></a>
  &nbsp;·&nbsp;
  <a href="https://runhq.dev">Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/erdembas/runhq/issues">Issues</a>
  &nbsp;·&nbsp;
  <a href="./ROADMAP.md">Roadmap</a>
</p>

---

## The Moment

Open RunHQ and it should answer the question your terminal tabs usually hide:

> What is on this machine, what is running, and what needs my attention?

RunHQ discovers your local projects, groups services into stacks, starts commands, opens terminal-grade log tabs, watches ports, tracks workspace health, and gives AI the whole local context when you ask for a triage plan.

## Why

Your editor is excellent at one repo. Your local dev life is not one repo.

Every terminal tab is a task you are carrying in your head: frontend, API, worker, database, logs, `lsof -i :3000`, a forgotten README, a stale dependency scan. RunHQ turns that daily ritual into a persistent local workspace.

It does not replace your IDE, Docker, tmux, or terminal. It sits above them so your project portfolio stops living in your head.

## What It Does

- **Discovers local projects** across Node, Bun, Deno, Go, Rust, .NET, Python, Java, Ruby, PHP, and Docker Compose.
- **Runs services and stacks** with multi-command support, graceful shutdown, command log tabs, and terminal-grade output.
- **Shows workspace health** with CVE, outdated dependency, stale scan, dirty git, process, and port signals.
- **Opens the right tool fast** with editor launch, project actions, global quick actions, and a cross-project command palette.
- **Keeps logs usable** with terminal-grade ANSI rendering, search, follow mode, copy, and AI triage.
- **Lets AI reason across the workspace** through your own OpenAI-compatible endpoint, local or cloud.

## Install

### macOS

```bash
brew tap erdembas/tap
brew install --cask runhq
```

Upgrade later with:

```bash
brew upgrade --cask runhq
```

### Direct Downloads

Download the latest installer from [GitHub Releases](https://github.com/erdembas/runhq/releases/latest).

- **macOS:** `.dmg` for Apple Silicon or Intel
- **Linux:** `.deb`, `.rpm`, or `.AppImage`
- **Windows:** `.exe` or `.msi`

RunHQ auto-updates after the first install.

## Local-First

- No account.
- No telemetry.
- State lives under `~/.runhq/`.
- AI can run fully local through Ollama, LM Studio, vLLM, llama.cpp, or any OpenAI-compatible endpoint.
- Config is stored as human-readable JSON.
- Chat, scan, and timeline data are stored in local SQLite databases.

## How It Fits

| Need                   | Typical tool                 | RunHQ adds                                                         |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------ |
| Start one repo         | Foreman, Overmind, PM2       | Multi-project dashboard, stacks, logs, ports, git, health, AI      |
| Run containers         | Docker Desktop               | Non-container services, repo context, command logs, editor actions |
| Jump into code         | IDE recent projects          | Every project on disk, regardless of IDE                           |
| Remember project state | Notes, shell aliases, memory | Persistent local registry and health snapshot                      |

## Development

Requirements:

- Node.js 22+
- pnpm 9.14.4 via Corepack
- Rust stable with `rustfmt` and `clippy`
- Platform dependencies required by Tauri

```bash
git clone https://github.com/erdembas/runhq.git
cd runhq
pnpm install
pnpm tauri:dev
```

Common checks:

```bash
pnpm lint
pnpm typecheck
cargo test -p runhq-core
cargo clippy --all-targets -- -D warnings
cargo fmt --all
```

### Repo layout

This is a pnpm workspace with two apps and two shared packages:

```
runner-hq/
├── apps/
│   ├── desktop/         # Tauri + React desktop app (the product)
│   └── site/            # Next.js marketing site (runhq.dev)
└── packages/
    ├── cockpit-ui/      # Presentational React layer — single source
    │                    # of truth for every visual primitive in
    │                    # both apps. See packages/cockpit-ui/README.md
    └── cockpit-types/   # Shared TypeScript definitions for IPC,
                         # services, scans, resources.
```

**Single source of truth rule:** every component used by both the
desktop app and the marketing site lives in `@runhq/cockpit-ui`. The
desktop app composes those primitives with Zustand + Tauri IPC
wrappers; the marketing site composes them with mock fixtures from
`apps/site/src/lib/fixtures/`. Edit cockpit-ui once, both surfaces
re-render — no copy-paste, no version drift, no separate build step
(pnpm `workspace:*` symlinks the package directly).

If you're touching anything visual, start with
[`packages/cockpit-ui/README.md`](./packages/cockpit-ui/README.md).

### Marketing site (`runhq.dev`)

The runhq.dev landing page lives in `apps/site/` (Next.js 15, App
Router, static export). It mounts real `@runhq/cockpit-ui` React
components — the same primitives the desktop app ships — fed mock
workspace fixtures, so the demos are not screenshots but live
renders. Cutover from the legacy `docs/index.html` to this build is
documented in [`docs/CUTOVER.md`](./docs/CUTOVER.md).

```bash
pnpm site:dev          # Next dev server on http://localhost:4318
pnpm site:build        # static export to apps/site/out/ + carry-over assets
pnpm site:preview      # serve the production export locally
```

Cloudflare Pages build settings after cutover:

- Build command: `pnpm install --frozen-lockfile && pnpm site:build`
- Build output: `apps/site/out`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The most useful contributions are runtime providers, scanner improvements, platform-specific fixes, and focused UX refinements.

## License

MIT © [Erdem Baş](https://github.com/erdembas). See [LICENSE](./LICENSE).
