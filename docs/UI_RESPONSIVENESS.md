# UI responsiveness

## Changes

| Area                 | Avoided work                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell            | Dialog state is isolated from workspace chrome. A main-tab switch updates the previous and next panel rather than every mounted panel.                                                              |
| Agents               | Session refresh publishes one batch and preserves unchanged records. Concurrent reads share requests; saves still force a fresh read. Hidden tools/workspaces stop subscribing.                     |
| Transcript           | Unchanged messages retain their references so streaming one message does not reparse every Markdown message. Warm model catalogs render immediately.                                                |
| Logs                 | Only visible command bodies consume their own log buffer. Catch-up yields after at most 128 entries, about 64 KiB of source text, or 4 ms of formatting, then waits for xterm to drain.             |
| Dashboard and stacks | Cards select their own status/logs. Hidden views pause subscriptions and timers. Stack previews inspect only the last 200 entries per command.                                                      |
| Side panels          | Width changes apply once per toggle, avoiding repeated layout and PTY resizes during an animation. Common modal backdrops use dimming without full-window blur.                                     |
| Activity             | Hidden panels stop polling and listening to service events. Concurrent refreshes coalesce; stale results and late subscription completion cannot revive a hidden panel.                             |
| Native commands      | Blocking Git, filesystem, SQLite, tokenization and PTY resize work runs off the window/async executor threads. Git reads have a concurrency limit; mutations retain repository-level serialization. |

Tabs, drafts, scroll positions and terminal sessions stay mounted when hidden.
Visibility pauses presentation work, not the underlying running service or agent.

## Validation

```sh
node --test apps/desktop/tests/*.test.mjs
pnpm agent:test
pnpm --filter @runhq/desktop lint
pnpm --filter @runhq/desktop typecheck
pnpm --filter @runhq/cockpit-ui typecheck
pnpm build
cargo test -p runhq-core --offline
cargo check -p runhq-desktop --offline
```

Regression coverage includes single-publication refresh of 1,000 sessions,
no-change refreshes, preservation of 499 out of 500 streamed transcript items,
bounded/cancelled log replay, marker correctness after retention/filter changes,
bounded stack previews, and cancellation-safe native command serialization.
OpenCode adapter tests need permission to bind a local loopback test server.

## Native smoke checks

Use a newly built desktop binary: frontend hot reload does not activate Rust
changes in an already running binary.

- Switch between several project tabs while services produce logs.
- Open/close Agent tools while an agent streams; return to the same draft/session.
- Switch away from a large log backlog, then back; verify search, selection and
  context menus still target the displayed entry.
- Toggle both side panels and verify terminal geometry and draft preservation.
- Hide Activity during a refresh, reopen it, and switch filters during a request.

These changes are validated through behavioral tests and builds. They are not a
measured before/after frame-time benchmark on the user's native workload.
