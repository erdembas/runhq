# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.7.0](https://github.com/erdembas/runhq/compare/v0.6.0...v0.7.0) (2026-04-27)

This release is the **AI assistant** chapter — RunHQ stops being a
purely deterministic project manager and grows a model-agnostic chat
substrate that every existing AI affordance now plugs into. You bring
the endpoint (anything OpenAI-compatible: OpenAI, Azure, Together,
OpenRouter, vLLM, Ollama, LiteLLM, …), and every surface in the app
that used to launch a one-shot popover now feeds into the same
persistent right-rail conversation. There is no proprietary inference
running anywhere; your code stays where you sent it.

Three flagship pieces land together:

1. **AI Chat Hub** — a unified right-rail panel with multi-tab
   conversations (up to 5), SQLite-persisted history, per-turn model
   switching, language picker with country flags, and a live token
   meter against the active model's context window.
2. **AI on every surface** — Project · Why?, Log Triage, Diff Explain,
   Commit Message generation, Standup Polish, Workspace global
   analysis (new!), and Per-CVE deep analysis (new!) all route into
   the same chat hub. Per-turn action hooks let the model write *into*
   your flow ("Use as commit message", "Insert into standup").
3. **Streaming reliability overhaul** — local / reasoning-heavy models
   no longer cut out mid-sentence, hide the answer in `<thinking>`
   blocks, or silently die on a non-ASCII byte.

### AI Chat Hub

A bring-your-own-LLM chat panel — RunHQ never proxies your requests
through a hosted service, the connection goes straight from the
desktop app to whichever OpenAI-compatible endpoint you configure.

- **ai-settings:** new Settings → AI dialog with multi-provider
  storage. Each provider is `{ name, base_url, api_key?, model }`;
  API key is optional (vLLM, Ollama, internal LiteLLM gateways
  routinely run without one). Switch providers from the chat
  composer's model pill — every turn records which provider × model
  produced it, so when one model stalls and another finishes you can
  see *which* in the turn metadata instead of guessing.
- **ai-settings:** language picker upgraded from a native `<select>`
  to a custom `LanguagePicker` with country flags, type-ahead search,
  and full keyboard navigation. The native dropdown couldn't render
  emoji flags reliably across macOS / Windows / Linux webviews and
  trying to find your locale by scrolling 100+ rows was the kind of
  micro-friction that compounds over a day. Default is "Auto"
  (matches the OS), explicit selection wins for users mixing English
  documentation with Turkish / Spanish / Arabic stand-ups.
- **chat:** persistent SQLite-backed conversation store
  (`runhq-core::conversations`) — schema, CRUD, and aggregation
  queries live in `~/Library/Application Support/runhq/conversations.db`
  (or platform equivalent). Conversations survive restarts and
  crashes; switching projects, coming back tomorrow, or rebooting
  the machine never loses the chat thread you were reasoning through.
  History is exposed via a drawer that mirrors VSCode's "Recent" list
  — pick from the past, the active conversation rehydrates with full
  turn-by-turn provenance (model, finish reason, partial flag,
  reasoning trace, action hooks).
- **chat:** Cursor-style multi-tab strip. Up to 5 conversations open
  simultaneously with streaming indicators per tab, and a FIFO
  eviction policy that explicitly *never* closes the active or
  in-flight tab — so a long-running deep-analysis can't be killed by
  someone clicking "+New" five times. Tab titles are lazy-loaded
  from the conversation table, cached locally, and normalised to
  strip surface prefixes (e.g. "Why · belgehub-backend" becomes
  "belgehub-backend") so the strip stays scannable.
- **chat:** per-turn token meter (`tiktoken-rs` powered) ticks live as
  you type, showing `input + history vs context window` and tinting
  amber → red as you approach the model's documented limit. `gpt-4o`,
  `claude-3.5`, `glm-4.5`, `qwen-2.5`, `llama-3.1`, and the local
  variants of each are mapped to the right encoder so the count is
  accurate, not just a `chars / 4` approximation. The component
  surfaces a "Compact context?" hint when the budget's almost gone
  rather than letting the model truncate silently from the head.
- **chat:** auto-resizing composer textarea. Shift+Enter inserts a
  newline, height tracks `scrollHeight` clamped at 180px, then
  scroll — same shape as ChatGPT / Claude. Replaces the previous
  fixed 3-line box that forced you to either crank the panel wider
  or accept hidden text bleeding off the bottom.

### AI on Every Surface

Every existing AI affordance — and a couple of new ones — now feeds
the same persistent chat. No more popovers that vanish when you
click outside, no more one-shot answers you can't follow up on.

- **ai-hub:** every AI surface now goes through one bridge —
  `useAppStore.openAiChat({ history, draft, autoSend?, actionHook? })`.
  The store either rehydrates an existing conversation or seeds a
  draft turn the user can edit before send; the right-rail panel
  picks up the draft, the conversation is persisted on send, and
  per-turn hooks render contextual buttons under the answer ("Use as
  commit message", "Insert into standup") that mutate the surface
  the request originated from.
- **ai-hub:** Project · Why? popover — replaced by an `openAiChat`
  call that pre-loads project context (recent runs, dirty file count,
  outdated deps, advisory severity histogram) and asks the model for
  a "what's going on with this project?" report. Saves into chat
  history so you can refer back two days later when the report ages.
- **ai-hub:** Log right-click triage — popover deleted in favour of a
  context-menu item that captures the surrounding 50 lines of stderr
  / stdout and asks the model to triage the error. The chat hub
  retains the surrounding lines as conversation context, so
  follow-ups like "why does that null pointer happen on a fresh
  install?" don't have to re-paste anything.
- **ai-hub:** Diff Explain — the inline DiffPane "Explain" button
  now opens the chat hub with the unified diff and a tuned prompt
  ("explain *what changed*, not what each line does"). Works in
  both per-service DiffViewer and the Cross-Project Changes view.
- **ai-hub:** Commit Message generator — Generate button on the
  Commit panel now seeds a chat with the staged diff and an
  explicit `actionHook: 'use_as_commit'`, so the model's reply gets
  a "Use as commit message" button that drops the message straight
  into the commit textarea. No more copy-paste round-trips.
- **ai-hub:** Standup Polish — Activity Timeline's Polish dialog is
  retired. The standup chip now seeds a chat with the day's events
  and a `actionHook: 'insert_standup'`; the polished output drops
  into the timeline standup composer with one click, but you can
  also keep iterating ("make it shorter", "drop the Linux items")
  without losing the previous draft.
- **ai-hub:** Dashboard "Analyze workspace" button — new global
  surface that snapshots every project (running services, dirty
  state, outdated dep majors, unresolved CVEs by severity) into a
  single workspace report. Designed for end-of-week review and
  "what should I tackle Monday?" triage; the report is plain
  markdown so you can paste it into Linear / Slack / Confluence.
- **ai-hub:** Per-CVE Deep Analysis (new). Clicking the sparkles
  icon next to any advisory in the project drawer launches a
  chat with a strict five-section prompt: TL;DR · Where it bites ·
  Worst case · Am I likely affected? · Fix. The prompt explicitly
  forbids the model from inventing symbols that aren't in the
  passed-in package metadata, so it can't hallucinate vulnerable
  call sites. Distinct from the bulk Triage flow, which buckets
  many advisories at once — this is the "tell me about *this one*"
  affordance you reach for when the GHSA write-up is too generic to
  act on.

### Streaming Reliability

The headline bug class for the entire AI surface, mostly hit by
local / reasoning-heavy models (GLM, Qwen, Llama variants) where
the model emits a long `<thinking>` trace and then either truncates
the actual answer, hangs mid-token, or — until this release — crashed
the Tokio worker on a non-ASCII byte and silently terminated the
stream with no `done` event.

- **ai:** **UTF-8 panic fix**. `safe_emit_len` was performing
  byte-indexed string slicing on the SSE buffer to detect partial
  closing tags, but the slice point wasn't snapped to a UTF-8
  character boundary. A single em-dash (`—`, three bytes) inside
  the streamed answer was enough to panic the parser with `start
  byte index 2 is not a char boundary; it is inside '—'`, killing
  the worker before it could emit the `done` event. The user-facing
  symptom was "the response just stopped, no error, no end-of-stream
  marker, no way to continue". Fix snaps the split index back to
  the nearest `is_char_boundary == true` byte; regression tests
  cover multi-byte boundaries and emoji prefixes.
- **ai:** content-progress-based idle timeout. Previously a flat 60s
  ceiling closed the stream regardless of whether the model was
  actively writing reasoning tokens. Long-form deep analyses on
  reasoning-heavy models routinely exceed 60s of pure CoT before
  the answer body starts. Now the timer resets every time we
  receive *any* visible content (delta or reasoning), so streams
  only abort when actually stalled.
- **ai:** auto-retry / auto-continue on stalled streams. When a
  stall is detected, the frontend automatically issues a
  continuation request with the partial body as context — the user
  doesn't have to manually click Continue unless the auto-retry
  also fails.
- **ai:** "answer hidden in reasoning" heuristic. Detects the
  pathological case where the model finished cleanly (`finish_reason
  = "stop"`) but the answer body is suspiciously short (~ < 200
  chars) while the reasoning trace is rich (multi-paragraph). In
  that case we issue an automatic append-only continuation with a
  prompt nudging the model to print the actual answer rather than
  thinking it silently. Works for the GLM and Qwen reasoning
  variants that occasionally treat the thinking buffer as the only
  required output.
- **ai:** `partial: boolean` flag on `Turn`. Surfaces an
  "Answer looks incomplete" banner on any partial turn not already
  covered by a `length` or `timeout` finish reason, with a
  one-click Continue button that resumes the same conversation
  with append-only context. Eliminates the "is this done? do I
  click again?" ambiguity.
- **ai:** Cursor-style reasoning pill. The model's chain-of-thought
  is now collapsed into a calm, dimmed, fixed-height (120px),
  auto-scrolling pill underneath the answer body, default-open
  while streaming and click-to-collapse afterwards. Replaces the
  previous mode where reasoning rendered as if it *were* the
  answer, which made every response read three times longer than
  it needed to. Pill is theme-aware (dim foreground in light, even
  dimmer in dark) and never accidentally renders as if it's the
  primary content.
- **ai:** unlimited `max_output_tokens` by default. The previous
  1500-token cap made sense for a single-turn assistant but
  routinely truncated multi-project workspace reports and large
  diff explainers on million-token-context models. Default is now
  uncapped (let the model finish); per-provider overrides still
  available in Settings → AI for users who want to bound spend.
- **ai:** stream lifecycle tracing. Every stream gets a stable
  `stream_id`, with `tracing::debug` / `warn` / `trace` events at
  begin / first reasoning / first delta / done / abort / timeout
  boundaries. Surfaced in the frontend through a
  `localStorage.runhq_debug_ai = '1'` flag that flips on console
  logging in `AiChatPanel`, mirrored to the Rust side via
  `RUST_LOG=runhq_core::ai=debug`. Made the UTF-8 panic above
  diagnosable in the first place.

### Quality of Life

- **dashboard:** loading skeleton. The dashboard previously rendered
  empty state for ~ 200ms while the cross-project poll completed,
  which read as "RunHQ has no projects" until the cards finally
  hydrated. New `DashboardSkeleton` paints placeholder cards so the
  first-paint feels instant; the real cards swap in once data
  arrives. Same trick applied to `WorstOffenders` and the resource
  heatmap.
- **layout:** right-side rail tone now matches the left sidebar
  exactly. The previous 3-stop opacity wash on the right made the
  AI panel read as a different surface tier from the rest of the
  app; now both rails inherit `--surface-raised` and the visual
  weight balances around the editor canvas in the middle.
- **ui:** auto-resizing chat composer (Shift+Enter inserts newline,
  height tracks content up to 180px), redesigned chat shell with a
  single outer border, and a model pill in the composer that opens
  a real dropdown instead of cycling through providers on click.

### Bug Fixes

- **ai:** UTF-8 panic in SSE buffer slicing — see "Streaming
  Reliability → UTF-8 panic fix" above. Worker no longer dies
  silently on em-dashes, smart quotes, emoji, or any non-ASCII
  payload byte.
- **ai:** model picker dropdown didn't open on click in the chat
  composer (the trigger was registering as both the popover toggle
  and an outside-click dismissal). Fixed by routing the popover
  through a portal with a stable anchor ref.
- **ai:** chat panel scroll position no longer jumps to top when a
  new chunk arrives during reasoning. The body is now followed only
  if the user is already pinned to the bottom — same heuristic
  every chat client uses, prevents losing your read position on
  long-form responses.

### Removed

- **ai-popovers:** `ProjectExplainPopover`, `LogTriagePopover`, and
  the inline diff Explain dropdown — superseded by the unified chat
  hub. Surfaces that used to vanish on outside-click now keep their
  conversation around for follow-ups.
- **ai:** `AiStandupDialog` — replaced by an `openAiChat` call with
  the `insert_standup` action hook.

## [0.6.0](https://github.com/erdembas/runhq/compare/v0.5.1...v0.6.0) (2026-04-25)


### Features

* **git-diff:** add git diff viewer with file-level and branch comparison ([#37](https://github.com/erdembas/runhq/issues/37)) ([a5db650](https://github.com/erdembas/runhq/commit/a5db650f5509e8476a2c4f39420bfb180d368af4))
* **git-diff:** rebuild Source Control window for VSCode parity ([24a775a](https://github.com/erdembas/runhq/commit/24a775aa9a018e7b33495a5a6bb2850cec9a088a))
* **git:** integrate Git status and operations into the LogPanel ([4e21c42](https://github.com/erdembas/runhq/commit/4e21c4250ba299a1bba31d56138680db82d33788))
* **overview:** add cross-project dashboard with git status matrix and resource overview ([#32](https://github.com/erdembas/runhq/issues/32)) ([ade6953](https://github.com/erdembas/runhq/commit/ade6953ac5fd1e3c58d038fe75632c618e34ca62))
* **overview:** complete cross-project dashboard with all roadmap features ([b0bcacc](https://github.com/erdembas/runhq/commit/b0bcacc3ada377a1fc50aa559b4727f09c94a00b))
* **overview:** Cross-Project Dashboard (closes [#32](https://github.com/erdembas/runhq/issues/32)) ([ee37235](https://github.com/erdembas/runhq/commit/ee372350705777c75fbbe3f85db78e331548fab8))
* **overview:** ship cross-project dashboard with triage cockpit ([bb3c872](https://github.com/erdembas/runhq/commit/bb3c872c445ff749556098a1a7d4ef40ca74417b))
* **overview:** wire ProjectDashboard into UI as right drawer with Eye button ([4806483](https://github.com/erdembas/runhq/commit/48064831c00cfce7365b2d88131a7ace5353f0bf))
* **release-notes:** implement Release Notes feature and integrate into UI ([ee01bef](https://github.com/erdembas/runhq/commit/ee01bef856b0db77e83b84a90f7d1e1baa35df64))
* **styles:** introduce semantic tone colors for severity indicators ([d1b2aa0](https://github.com/erdembas/runhq/commit/d1b2aa0782db382726b3a8b5a28dd67963597c9e))
* **timeline:** add activity timeline with SQLite persistence and standup export ([#34](https://github.com/erdembas/runhq/issues/34)) ([45aa13e](https://github.com/erdembas/runhq/commit/45aa13ed4e4bc913dfd7b6c2034f3ae3dbf9cc99))
* **timeline:** add ActivityTimeline frontend component with daily summary and standup export ([c94ee30](https://github.com/erdembas/runhq/commit/c94ee30566e9b06b7a789d054abe2ce0e7affbd7))
* **timeline:** add Timeline button to sidebar with clock icon ([e88bf4e](https://github.com/erdembas/runhq/commit/e88bf4e1042d4a083c36631819971af7a66d7da2))
* **timeline:** add weekly summary, project/time filters, file change tracking ([714ca3e](https://github.com/erdembas/runhq/commit/714ca3e282cf204bfdf17b04009185dd14d78e76))
* **timeline:** hook status and log events to auto-record timeline entries ([9f2cdac](https://github.com/erdembas/runhq/commit/9f2cdac9d750d360f5aca3fb20e14207f9712301))
* **timeline:** integrate clipboard manager and enhance git event tracking ([c1e81ca](https://github.com/erdembas/runhq/commit/c1e81ca6bb3c69727bafda7807ef2bef3e1dd24b))
* **timeline:** merge Activity Timeline feature ([#34](https://github.com/erdembas/runhq/issues/34)) ([718ebe4](https://github.com/erdembas/runhq/commit/718ebe416f4c1a2a25565c08833340089a8c8fa0))
* **timeline:** redesign as right drawer with node graph, 640px width ([79b3e12](https://github.com/erdembas/runhq/commit/79b3e127efb6a4877ec3aadcf7074950f66e42c6))
* **ui:** UI zoom shortcuts ([#49](https://github.com/erdembas/runhq/issues/49)) ([77cc042](https://github.com/erdembas/runhq/commit/77cc04282ab861c290d750c9a964967c0dc4cf56))
* **whatsnew:** in-app release-highlights modal, kicking off with 0.6.0 ([9d13e99](https://github.com/erdembas/runhq/commit/9d13e99f2566c3b17f0d65642e6f73272f1ddeb3))


### Bug Fixes

* **ipc:** drop useless AppError::from conversions ([20c2ed9](https://github.com/erdembas/runhq/commit/20c2ed90cd91402dd212406a77472c195b2665de))
* **overview:** satisfy clippy -D warnings in CI ([5634bd8](https://github.com/erdembas/runhq/commit/5634bd8dd532f5fb8f3ac9f466424d63ac5b1b25))
* **overview:** use instance-specific TTL for ScanCache to improve test reliability ([1f7a553](https://github.com/erdembas/runhq/commit/1f7a5535316afa7f66a83c64ee674928ae31433b))
* **sidebar:** hide stack-member services from flat list ([35386ac](https://github.com/erdembas/runhq/commit/35386ace2dd859d5898bdbce4abb70e716803bb0))
* **timeline:** add chrono dependency to desktop crate for NaiveDate parsing ([8ba4e24](https://github.com/erdembas/runhq/commit/8ba4e24bd0cfb571c573e784e9ad30e2d63f14c2))


### Performance Improvements

* **overview:** async gather with parallel outdated/audit ([d88e3d7](https://github.com/erdembas/runhq/commit/d88e3d771b63952a48c4d8e8237110fd824c8b11))


### Code Refactoring

* **overview:** switch ProjectDashboard from drawer to modal ([70d50d6](https://github.com/erdembas/runhq/commit/70d50d660625e6e3f2468b67993663b019246c27))


### Documentation

* **changelog:** add bug fix for sidebar service duplication ([171bbaa](https://github.com/erdembas/runhq/commit/171bbaa178c5c8a2a83b50831a73f9bad48f2696))
* **changelog:** add Unreleased entry for cross-project dashboard ([68397ab](https://github.com/erdembas/runhq/commit/68397ab7388943ad7122534faee6e46d2e20269b))
* **changelog:** document UI zoom shortcuts and ScanCache TTL fix in 0.6.0 ([482871c](https://github.com/erdembas/runhq/commit/482871cdcd8eef7765c8cae9092f2fdd5ee07e8f))
* **changelog:** update for v0.6.0 release with new features ([7b34b42](https://github.com/erdembas/runhq/commit/7b34b4270bf6515b3a0ee72a97941235f9b0e1b1))
* **roadmap:** plan OpenAI-compatible AI integration (Phase 6–8) ([1a4dfb3](https://github.com/erdembas/runhq/commit/1a4dfb3a99e7e5a281b8ece397133489b24c5a0f))
* **whatsnew:** broaden 0.6.0 highlights to cover the full v0.5.1..v0.6.0 surface ([895c05e](https://github.com/erdembas/runhq/commit/895c05e2c87752d603d9a500b293c51593acf241))

Three flagship pieces land together:

1. **AI Chat Hub** — a unified right-rail panel with multi-tab
   conversations (up to 5), SQLite-persisted history, per-turn model
   switching, language picker with country flags, and a live token
   meter against the active model's context window.
2. **AI on every surface** — Project · Why?, Log Triage, Diff Explain,
   Commit Message generation, Standup Polish, Workspace global
   analysis (new!), and Per-CVE deep analysis (new!) all route into
   the same chat hub. Per-turn action hooks let the model write *into*
   your flow ("Use as commit message", "Insert into standup").
3. **Streaming reliability overhaul** — local / reasoning-heavy models
   no longer cut out mid-sentence, hide the answer in `<thinking>`
   blocks, or silently die on a non-ASCII byte.

### AI Chat Hub

A bring-your-own-LLM chat panel — RunHQ never proxies your requests
through a hosted service, the connection goes straight from the
desktop app to whichever OpenAI-compatible endpoint you configure.

- **ai-settings:** new Settings → AI dialog with multi-provider
  storage. Each provider is `{ name, base_url, api_key?, model }`;
  API key is optional (vLLM, Ollama, internal LiteLLM gateways
  routinely run without one). Switch providers from the chat
  composer's model pill — every turn records which provider × model
  produced it, so when one model stalls and another finishes you can
  see *which* in the turn metadata instead of guessing.
- **ai-settings:** language picker upgraded from a native `<select>`
  to a custom `LanguagePicker` with country flags, type-ahead search,
  and full keyboard navigation. The native dropdown couldn't render
  emoji flags reliably across macOS / Windows / Linux webviews and
  trying to find your locale by scrolling 100+ rows was the kind of
  micro-friction that compounds over a day. Default is "Auto"
  (matches the OS), explicit selection wins for users mixing English
  documentation with Turkish / Spanish / Arabic stand-ups.
- **chat:** persistent SQLite-backed conversation store
  (`runhq-core::conversations`) — schema, CRUD, and aggregation
  queries live in `~/Library/Application Support/runhq/conversations.db`
  (or platform equivalent). Conversations survive restarts and
  crashes; switching projects, coming back tomorrow, or rebooting
  the machine never loses the chat thread you were reasoning through.
  History is exposed via a drawer that mirrors VSCode's "Recent" list
  — pick from the past, the active conversation rehydrates with full
  turn-by-turn provenance (model, finish reason, partial flag,
  reasoning trace, action hooks).
- **chat:** Cursor-style multi-tab strip. Up to 5 conversations open
  simultaneously with streaming indicators per tab, and a FIFO
  eviction policy that explicitly *never* closes the active or
  in-flight tab — so a long-running deep-analysis can't be killed by
  someone clicking "+New" five times. Tab titles are lazy-loaded
  from the conversation table, cached locally, and normalised to
  strip surface prefixes (e.g. "Why · belgehub-backend" becomes
  "belgehub-backend") so the strip stays scannable.
- **chat:** per-turn token meter (`tiktoken-rs` powered) ticks live as
  you type, showing `input + history vs context window` and tinting
  amber → red as you approach the model's documented limit. `gpt-4o`,
  `claude-3.5`, `glm-4.5`, `qwen-2.5`, `llama-3.1`, and the local
  variants of each are mapped to the right encoder so the count is
  accurate, not just a `chars / 4` approximation. The component
  surfaces a "Compact context?" hint when the budget's almost gone
  rather than letting the model truncate silently from the head.
- **chat:** auto-resizing composer textarea. Shift+Enter inserts a
  newline, height tracks `scrollHeight` clamped at 180px, then
  scroll — same shape as ChatGPT / Claude. Replaces the previous
  fixed 3-line box that forced you to either crank the panel wider
  or accept hidden text bleeding off the bottom.

### AI on Every Surface

Every existing AI affordance — and a couple of new ones — now feeds
the same persistent chat. No more popovers that vanish when you
click outside, no more one-shot answers you can't follow up on.

- **ai-hub:** every AI surface now goes through one bridge —
  `useAppStore.openAiChat({ history, draft, autoSend?, actionHook? })`.
  The store either rehydrates an existing conversation or seeds a
  draft turn the user can edit before send; the right-rail panel
  picks up the draft, the conversation is persisted on send, and
  per-turn hooks render contextual buttons under the answer ("Use as
  commit message", "Insert into standup") that mutate the surface
  the request originated from.
- **ai-hub:** Project · Why? popover — replaced by an `openAiChat`
  call that pre-loads project context (recent runs, dirty file count,
  outdated deps, advisory severity histogram) and asks the model for
  a "what's going on with this project?" report. Saves into chat
  history so you can refer back two days later when the report ages.
- **ai-hub:** Log right-click triage — popover deleted in favour of a
  context-menu item that captures the surrounding 50 lines of stderr
  / stdout and asks the model to triage the error. The chat hub
  retains the surrounding lines as conversation context, so
  follow-ups like "why does that null pointer happen on a fresh
  install?" don't have to re-paste anything.
- **ai-hub:** Diff Explain — the inline DiffPane "Explain" button
  now opens the chat hub with the unified diff and a tuned prompt
  ("explain *what changed*, not what each line does"). Works in
  both per-service DiffViewer and the Cross-Project Changes view.
- **ai-hub:** Commit Message generator — Generate button on the
  Commit panel now seeds a chat with the staged diff and an
  explicit `actionHook: 'use_as_commit'`, so the model's reply gets
  a "Use as commit message" button that drops the message straight
  into the commit textarea. No more copy-paste round-trips.
- **ai-hub:** Standup Polish — Activity Timeline's Polish dialog is
  retired. The standup chip now seeds a chat with the day's events
  and a `actionHook: 'insert_standup'`; the polished output drops
  into the timeline standup composer with one click, but you can
  also keep iterating ("make it shorter", "drop the Linux items")
  without losing the previous draft.
- **ai-hub:** Dashboard "Analyze workspace" button — new global
  surface that snapshots every project (running services, dirty
  state, outdated dep majors, unresolved CVEs by severity) into a
  single workspace report. Designed for end-of-week review and
  "what should I tackle Monday?" triage; the report is plain
  markdown so you can paste it into Linear / Slack / Confluence.
- **ai-hub:** Per-CVE Deep Analysis (new). Clicking the sparkles
  icon next to any advisory in the project drawer launches a
  chat with a strict five-section prompt: TL;DR · Where it bites ·
  Worst case · Am I likely affected? · Fix. The prompt explicitly
  forbids the model from inventing symbols that aren't in the
  passed-in package metadata, so it can't hallucinate vulnerable
  call sites. Distinct from the bulk Triage flow, which buckets
  many advisories at once — this is the "tell me about *this one*"
  affordance you reach for when the GHSA write-up is too generic to
  act on.

### Streaming Reliability

The headline bug class for the entire AI surface, mostly hit by
local / reasoning-heavy models (GLM, Qwen, Llama variants) where
the model emits a long `<thinking>` trace and then either truncates
the actual answer, hangs mid-token, or — until this release — crashed
the Tokio worker on a non-ASCII byte and silently terminated the
stream with no `done` event.

- **ai:** **UTF-8 panic fix**. `safe_emit_len` was performing
  byte-indexed string slicing on the SSE buffer to detect partial
  closing tags, but the slice point wasn't snapped to a UTF-8
  character boundary. A single em-dash (`—`, three bytes) inside
  the streamed answer was enough to panic the parser with `start
  byte index 2 is not a char boundary; it is inside '—'`, killing
  the worker before it could emit the `done` event. The user-facing
  symptom was "the response just stopped, no error, no end-of-stream
  marker, no way to continue". Fix snaps the split index back to
  the nearest `is_char_boundary == true` byte; regression tests
  cover multi-byte boundaries and emoji prefixes.
- **ai:** content-progress-based idle timeout. Previously a flat 60s
  ceiling closed the stream regardless of whether the model was
  actively writing reasoning tokens. Long-form deep analyses on
  reasoning-heavy models routinely exceed 60s of pure CoT before
  the answer body starts. Now the timer resets every time we
  receive *any* visible content (delta or reasoning), so streams
  only abort when actually stalled.
- **ai:** auto-retry / auto-continue on stalled streams. When a
  stall is detected, the frontend automatically issues a
  continuation request with the partial body as context — the user
  doesn't have to manually click Continue unless the auto-retry
  also fails.
- **ai:** "answer hidden in reasoning" heuristic. Detects the
  pathological case where the model finished cleanly (`finish_reason
  = "stop"`) but the answer body is suspiciously short (~ < 200
  chars) while the reasoning trace is rich (multi-paragraph). In
  that case we issue an automatic append-only continuation with a
  prompt nudging the model to print the actual answer rather than
  thinking it silently. Works for the GLM and Qwen reasoning
  variants that occasionally treat the thinking buffer as the only
  required output.
- **ai:** `partial: boolean` flag on `Turn`. Surfaces an
  "Answer looks incomplete" banner on any partial turn not already
  covered by a `length` or `timeout` finish reason, with a
  one-click Continue button that resumes the same conversation
  with append-only context. Eliminates the "is this done? do I
  click again?" ambiguity.
- **ai:** Cursor-style reasoning pill. The model's chain-of-thought
  is now collapsed into a calm, dimmed, fixed-height (120px),
  auto-scrolling pill underneath the answer body, default-open
  while streaming and click-to-collapse afterwards. Replaces the
  previous mode where reasoning rendered as if it *were* the
  answer, which made every response read three times longer than
  it needed to. Pill is theme-aware (dim foreground in light, even
  dimmer in dark) and never accidentally renders as if it's the
  primary content.
- **ai:** unlimited `max_output_tokens` by default. The previous
  1500-token cap made sense for a single-turn assistant but
  routinely truncated multi-project workspace reports and large
  diff explainers on million-token-context models. Default is now
  uncapped (let the model finish); per-provider overrides still
  available in Settings → AI for users who want to bound spend.
- **ai:** stream lifecycle tracing. Every stream gets a stable
  `stream_id`, with `tracing::debug` / `warn` / `trace` events at
  begin / first reasoning / first delta / done / abort / timeout
  boundaries. Surfaced in the frontend through a
  `localStorage.runhq_debug_ai = '1'` flag that flips on console
  logging in `AiChatPanel`, mirrored to the Rust side via
  `RUST_LOG=runhq_core::ai=debug`. Made the UTF-8 panic above
  diagnosable in the first place.

### Quality of Life

- **dashboard:** loading skeleton. The dashboard previously rendered
  empty state for ~ 200ms while the cross-project poll completed,
  which read as "RunHQ has no projects" until the cards finally
  hydrated. New `DashboardSkeleton` paints placeholder cards so the
  first-paint feels instant; the real cards swap in once data
  arrives. Same trick applied to `WorstOffenders` and the resource
  heatmap.
- **layout:** right-side rail tone now matches the left sidebar
  exactly. The previous 3-stop opacity wash on the right made the
  AI panel read as a different surface tier from the rest of the
  app; now both rails inherit `--surface-raised` and the visual
  weight balances around the editor canvas in the middle.
- **ui:** auto-resizing chat composer (Shift+Enter inserts newline,
  height tracks content up to 180px), redesigned chat shell with a
  single outer border, and a model pill in the composer that opens
  a real dropdown instead of cycling through providers on click.

### Bug Fixes

- **ai:** UTF-8 panic in SSE buffer slicing — see "Streaming
  Reliability → UTF-8 panic fix" above. Worker no longer dies
  silently on em-dashes, smart quotes, emoji, or any non-ASCII
  payload byte.
- **ai:** model picker dropdown didn't open on click in the chat
  composer (the trigger was registering as both the popover toggle
  and an outside-click dismissal). Fixed by routing the popover
  through a portal with a stable anchor ref.
- **ai:** chat panel scroll position no longer jumps to top when a
  new chunk arrives during reasoning. The body is now followed only
  if the user is already pinned to the bottom — same heuristic
  every chat client uses, prevents losing your read position on
  long-form responses.

### Removed

- **ai-popovers:** `ProjectExplainPopover`, `LogTriagePopover`, and
  the inline diff Explain dropdown — superseded by the unified chat
  hub. Surfaces that used to vanish on outside-click now keep their
  conversation around for follow-ups.
- **ai:** `AiStandupDialog` — replaced by an `openAiChat` call with
  the `insert_standup` action hook.

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

### Quality of Life

- **ui:** keyboard-driven UI zoom — `Cmd/Ctrl + 0` zooms in,
  `Cmd/Ctrl + -` zooms out, and `Cmd/Ctrl + Shift + 0` resets to
  100%. Scale is clamped to the `0.85x – 1.4x` range in `0.05`
  steps, persisted to `localStorage` under `runhq.ui-scale`, and
  applied via `document.documentElement.style.zoom` so Tailwind
  arbitrary px sizes reflow correctly (a `transform: scale`
  approach would have broken the window's bounding box, hit-test,
  and scroll machinery). The zero row is bound by `e.code` /
  `Digit0` rather than `e.key === '='` because macOS bypasses
  layout processing while Cmd is held — on Turkish Q/F (and other
  non-US) keyboards `Shift+0` never arrives as `=`, so the US-only
  `Cmd+=` shortcut would have been unreachable. `Cmd+=` / `Cmd++`
  still work where the layout produces them.
  ([#49](https://github.com/erdembas/runhq/pull/49), thanks
  [@bedirhansay](https://github.com/bedirhansay))

### Bug Fixes

- **overview:** `ScanCache` TTL is now an instance field instead
  of being read from the global `SCAN_CACHE_TTL` constant inside
  the read paths. The previous test exercised expiry by
  back-dating an entry's `Instant` (`Instant::now() -
  SCAN_CACHE_TTL - 1s`) which underflowed and panicked on fresh
  Windows CI runners where `Instant::now()` was smaller than
  `SCAN_CACHE_TTL`. Tests now construct the cache with a tiny
  TTL (`20ms`) and a real `sleep` to drive expiry, while
  production still gets `SCAN_CACHE_TTL` via `new_global()` — no
  behavior change in the running app, just a stable CI signal.
  ([#49](https://github.com/erdembas/runhq/pull/49), thanks
  [@bedirhansay](https://github.com/bedirhansay))
- **sidebar:** stack-member services no longer double up in the flat
  list. Services assigned to a stack were rendering twice in the
  sidebar — once inside the stack's detail view, and again as
  standalone entries under _Unassigned_ / their section — so a
  4-service stack added 4 phantom rows to the top level. `SidebarRail`
  now computes the set of service IDs belonging to any stack and
  skips them in `filteredServices`; the result is a clean nested
  hierarchy where each service appears exactly once, surfaced through
  its stack row. The "Showing N · M hidden" filter banner is
  recalculated to subtract stack members so it stays a pure
  _filter_ counter and doesn't misreport nesting as hiding. Removing
  a service from a stack puts it back into the flat list
  automatically. Collapsed (narrow) sidebar mode keeps showing every
  service in the icon grid — stacks aren't navigable there, so the
  trade-off is intentional.
  ([#48](https://github.com/erdembas/runhq/pull/48), thanks
  [@bedirhansay](https://github.com/bedirhansay))

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
