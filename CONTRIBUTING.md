# Contributing to RunHQ

First — thank you. RunHQ is a small, opinionated tool. The fastest way to help is to try it on your own projects and file an issue when it breaks or feels awkward.

## Ground rules

- **Local & private.** No telemetry, no network calls added without an explicit opt-in and a discussion issue.
- **Lean dependencies.** Every new crate or npm package should earn its place. "We only need it in one function" is usually a signal to inline it.
- **Typed contracts.** Every Tauri IPC command has a mirror in `apps/desktop/src/lib/ipc.ts`. Keep both in sync in the same PR.
- **Domain in the core.** Business logic lives in `crates/runhq-core`. The desktop crate is a _shell_ around it — if a command in `apps/desktop/src-tauri/src/ipc.rs` grows real logic, push that logic into the core crate where it is unit-testable.

## Repository layout

```
apps/desktop/src/              # React UI (TypeScript + Tailwind)
apps/desktop/src-tauri/        # Tauri shell: IPC + event sink impl
crates/runhq-core/         # Pure Rust domain logic (no Tauri)
```

See [`README.md`](./README.md#repository-layout) for the full tree.

## Workflow

```bash
pnpm install
pnpm dev               # macOS: local app with the installed data and UI profile
pnpm dev:hot           # hot reload; macOS uses a separate UI profile

pnpm lint && pnpm typecheck && pnpm format:check
cargo test -p runhq-core
cargo clippy --all-targets -- -D warnings
cargo fmt --all
```

Quit any running RunHQ before starting development so it can open the agent
database. On macOS, `pnpm dev` rebuilds a local bundle that shares the installed
app's database **and** WebKit storage, including project groups and layouts.
Restart with `pnpm dev` after editing. `pnpm dev:hot` shares the backend database
by default but uses a separate UI profile; `RUNHQ_HOME` can isolate its backend
data for QA. Use `pnpm dev:ui` only for the frontend server without native APIs.

Keep commits small and focused. Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scanner): detect Go modules via go.mod
fix(process): kill entire process group on Unix
docs(readme): clarify state directory location
```

## Adding a runtime provider

Each language/tool RunHQ supports is a provider — _not_ a hardcoded branch. To add e.g. Go:

1. Implement [`RuntimeProvider`](./crates/runhq-core/src/scanner.rs) for `GoProvider`. Return suggestions based on `go.mod`, `main.go`, Makefile entries, etc.
2. Register it in the `scan()` providers list.
3. Add unit tests in `crates/runhq-core/tests/scanner.rs`.
4. Provide at least one end-to-end test fixture (a tiny real-world project in tests).

Keep providers idempotent and side-effect-free: detect, never mutate.

## Filing bugs

Please include:

- OS + version.
- RunHQ version (top-left corner of the app).
- A minimal reproduction — ideally the `package.json` / `go.mod` / command that triggers it.
- Contents of `~/.runhq/config.json` (redact anything sensitive).

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
