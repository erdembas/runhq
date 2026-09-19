# RunHQ Roadmap

Updated: 2026-09-18

## Product Direction

RunHQ's primary value is **centralized management of coding agents across projects and providers**.
One workspace should answer: what is each agent doing, which decisions need me, what changed, and
which results are ready to use?

The core workflow is **assign → supervise → review → validate → integrate**. Services, terminals,
Git, logs and project documentation supply the environment and evidence for that workflow. New
investment should help a developer manage more agent work with less context switching and greater
confidence in the result.

This roadmap describes the current repository and proposed next work. **Implemented** means the
capability exists in the codebase; it does not imply every provider/platform combination has been
verified live or included in a published release. **Partial** identifies an existing foundation with
specific gaps. **Planned** is prioritized work; **Later** has no delivery commitment. Phase order
expresses dependencies rather than release dates.

A1-A9 below are implemented in the repository. They are covered by unit/integration tests and a
fixture-driven UI walkthrough of the shared Agents surfaces; live runs against every provider and
platform are a separate, ongoing verification effort.

The previous 40-item roadmap is preserved in the [historical product backlog](docs/ROADMAP_BACKLOG.md).
Its feature numbers remain available for older discussions; this document supersedes its priorities
and status labels.

## Existing Agent Foundation

| Area                | Current implementation                                                                                                                        | Boundary to extend                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers and tools | Codex, OpenCode, Claude, Cursor/ACP and custom tool configuration; executable detection, connection checks and discovered model/mode controls | Capabilities vary by provider and installed version. Terminal connections retain their CLI UI without normalized task events.                        |
| Project workspace   | Global and per-project Agents views; projects can be added without a service command                                                          | Improve the first successful task flow and navigation at larger task counts.                                                                         |
| Mission Control     | Needs attention, Working, Ready and Completed lanes; filters, unread results and task templates                                               | The decision inbox and verified task outcomes exist; first-run guidance at large task counts is still open.                                          |
| Conversations       | SQLite history, native session IDs, questions, permissions, interruption, archive/delete and provider-dependent resume                        | Queues and drafts now persist and recover; background execution after Quit remains out of scope.                                                     |
| Plans and Canvas    | Inspect/edit plans, build a plan in the same conversation, preview/edit/export HTML, SVG and Markdown artifacts                               | Canvas is RunHQ's local artifact view; external hosted canvases are not imported.                                                                    |
| Message queue       | Ordered follow-up turns, reorder/remove, retry identity and pause after errors or Stop                                                        | Pending work survives restart; automatic progression stays bounded and opt-in.                                                                       |
| Parallel work       | Local checkout or isolated Git worktree; one active turn per checkout root and up to eight across separate roots                              | Setup, integration and worktree lifecycle are implemented. Native subagent events still do not create RunHQ child tasks.                             |
| Review and usage    | Workspace tracked diff, terminal/editor access and provider-reported usage                                                                    | Reviewed workflows separate pre-existing changes and usage is summarized; per-turn elapsed time is still not recorded and integration is apply-only. |

Current behavior and integration limits are documented in [Agent workspace](docs/AGENT_WORKSPACE.md)
and [Agent tools](docs/AGENT_TOOLS.md). Their verification notes distinguish fixture coverage from
live provider checks. Checkout locks coordinate RunHQ tasks; external editors and CLI sessions are
outside those locks.

## Priorities

| ID  | Investment                                  | Priority | Status      | Outcome                                                                            |
| --- | ------------------------------------------- | -------- | ----------- | ---------------------------------------------------------------------------------- |
| A1  | Durable queues and task recovery            | P0       | Implemented | Leave and return without losing pending work.                                      |
| A2  | Central decision inbox                      | P0       | Implemented | Handle the decisions blocking agents from one place.                               |
| A3  | Worktree setup and lifecycle                | P1       | Implemented | Start isolated work quickly and retain control of its files and branches.          |
| A4  | Review and verified task outcomes           | P1       | Implemented | See the change, its checks and the next integration action together.               |
| A5  | Explicit context and attachments            | P1       | Implemented | Give an agent the right files, images, logs and decisions with visible provenance. |
| A6  | Agent handoffs and dependent tasks          | P1       | Implemented | Coordinate implementation, review and follow-up across providers.                  |
| A7  | Reusable task recipes                       | P2       | Implemented | Repeat a known workflow with saved settings and validation steps.                  |
| A8  | Usage and execution capacity                | P2       | Implemented | Understand reported usage and why work is waiting.                                 |
| A9  | Searchable agent history and project memory | P2       | Implemented | Reuse prior decisions and results across conversations.                            |
| A10 | Provider accounts and limit-aware routing   | P1       | Partial     | Run more work by spreading it over the accounts you already pay for.               |
| A11 | Composable multi-provider workflows         | P1       | Planned     | Assign each step of a task to the agent and model that suit it.                    |

### A1. Durable Queues and Task Recovery

**Baseline (2026-09-17):** conversation history survives restart; unsent queues and drafts do not.
Closing a conversation view leaves its task running, while quitting RunHQ interrupts it.

- Persist queued messages, order, drafts, request IDs and the model/effort/mode/profile selected for
  each queued turn.
- On restart, reconcile stored state with the runtime and show what finished, was interrupted or
  still needs a decision. Offer explicit resume, retry and discard actions.
- Preserve pause-after-error and Stop behavior. Expired provider requests must be refreshed before
  accepting a response; a saved approval must not be replayed against a different request.
- Recover without duplicate messages or duplicate worktrees. Preserve visible failure details when
  a provider cannot resume its native session.

**Delivered:** queued turns, drafts, request IDs and the model/effort/mode chosen for each turn
persist across restarts; recovery reconciles stored state with the runtime and offers resume, retry
and discard. A stored answer is revalidated against the live request before it is accepted, so a
closed or replaced permission cannot be answered from stale state, and recovered sends are not
duplicated.

**Acceptance:** queue several follow-ups, interrupt or restart the app, and recover the same order
and settings without silently rerunning an uncertain turn. Background execution after Quit is a
separate, later capability.

### A2. Central Decision Inbox

**Baseline (2026-09-17):** Mission Control already groups tasks needing attention, and conversations
already render questions and permissions.

- Collect pending questions, command/file permissions, plan decisions and actionable failures across
  projects in one inbox. Show the project, task, provider, requested action and waiting duration.
- Answer in place with enough surrounding context, or jump to the exact conversation item. Keep
  each provider's permission choices and scope intact.
- Add keyboard navigation and filters for decision type, project and provider. Resolve stale or
  already-answered items through the runtime before updating the UI.
- Provide configurable OS notifications for blocked work, failure and completion, linked to the
  relevant task. Group duplicates and support per-project muting.

**Delivered:** one inbox collects permissions, questions and forms across projects with project and
request-type filters, keyboard navigation and waiting duration. Answers are given in place against
the revalidated live request or the exact conversation item is opened; OS notifications are
configurable with per-project muting.

**Acceptance:** supervise several projects and resolve blocking decisions without hunting through
conversations; each answer reaches the correct pending request exactly once.

### A3. Worktree Setup and Lifecycle

**Baseline (2026-09-17):** isolated tasks use a new branch from committed HEAD. Dependencies, local
edits and `.env` files are not copied; worktrees remain after conversation archival or deletion.

- Select an existing base branch/commit and show the starting point before task creation.
- Save project setup recipes: dependency installation, selected environment configuration and the
  services required to reproduce or preview the task. Surface setup output and retry failed steps.
- Make transferred local files explicit, including any selected environment files. Record the setup
  and starting revision alongside the task so later review has a reliable baseline.
- Add a worktree inventory linked to tasks, with dirty state, branch, active use and disk usage.
  Offer cleanup after showing retained changes and checking whether work is still active.

**Delivered:** workflows record their base revision, run saved setup commands with visible output,
and make transferred local files and selected environment files explicit - environment content is
fingerprinted and copied without entering the patch or the database. The worktree inventory lists
branch, dirty state, active use and disk usage, and cleanup is refused while work is still in use.

**Acceptance:** create a task in an isolated environment, reproduce its setup, reopen it later and
clean up a finished workspace without losing unreviewed changes. Change integration belongs to A4.

### A4. Review and Verified Task Outcomes

**Baseline (2026-09-17):** Changes shows the current workspace's tracked diff. Completed means the
provider turn ended; it does not prove the requested work passed checks or was accepted.

- Define acceptance criteria and project checks when assigning a task. Add an outcome view combining
  the request, result summary, changed files, review findings and validation evidence.
- Include new/untracked files and distinguish pre-existing workspace changes. Track execution
  separately from review and validation: turn completed, awaiting review, checks passed/failed/not
  run, and accepted.
- Run selected project checks and store the command, working directory, exit status, output and
  tested revision or workspace fingerprint. Mark results stale after subsequent changes.
- Offer a read-only review task with the same change baseline, optionally through another provider.
  Keep findings attached to the reviewed revision.
- Connect reviewed work to existing Git actions and add explicit apply/cherry-pick/merge or draft-PR
  flows. Show the destination, conflicts and resulting diff before integration.

**Delivered:** acceptance criteria and check commands belong to the workflow; each check stores its
command, working directory, exit status, output and the tested fingerprint, and results are marked
stale when sources change afterwards. Independent read-only review runs on the same baseline,
optionally through another provider, and integration previews conflicts and new files before an
explicit apply. Cherry-pick, merge and draft-PR destinations are not implemented; integration
applies to the configured target.

**Delivered since:** an ordinary task records the commit its checkout was on when it was created and
the tracked files that were already modified at that moment. **Changes** names the starting revision
and lists those files instead of claiming the whole working tree as the agent's work. A directory
that is not a repository reports no starting revision rather than an empty one.

**Next:**

- Carry reviewed work to a branch, commit or draft pull request through the existing Git surfaces,
  instead of stopping at an applied patch in the destination checkout.

**Acceptance:** a user can tell what changed, which checks actually ran, whether their results still
apply, and what will be integrated. An agent's statement that tests passed is not a recorded check.

### A5. Explicit Context and Attachments

**Baseline (2026-09-17):** project-bound sessions and AI actions from logs, diffs and advisory
surfaces already exist. The agent composer has no general file/image attachment workflow.

- Attach selected files or ranges, images, log excerpts, diffs, project notes and prior task results
  through the composer and existing product surfaces.
- Show a context tray containing source project/path, captured revision or timestamp, size and
  whether content is a snapshot or a live reference. Let the user inspect and remove each item.
- Bind context to its originating task/project when navigating elsewhere. Support explicit
  cross-project context for work spanning repositories.
- Expose provider/model-supported attachment types and limits. Display unsupported types and
  truncation before sending rather than dropping context silently.

**Delivered:** a composer context tray carries workspace files, log excerpts and notes, images and
saved project decisions, each showing its source project and capture time and each removable before
sending. Image support is gated by provider capability with explicit type, count and size limits
that are reported instead of dropping context silently.

**Acceptance:** reproduce a UI bug from an attached screenshot and selected logs, with the exact
submitted context visible and a clear capability message for providers that cannot consume it.

### A6. Agent Handoffs and Dependent Tasks

**Baseline (2026-09-17):** independent tasks can run in separate worktrees, and follow-up turns can
be queued in one conversation. Parent/child task coordination and cross-provider handoffs are new
work.

- Start with an explicit **Hand off** action: choose a target agent and inspect a package containing
  the objective, completed work, open questions, selected artifacts and validation results.
- Create a linked new task and preserve its source task and change baseline. Provider-native
  session state and permission grants remain with the original provider.
- Add parent/child tasks and dependencies, such as implement → review → revise → validate. Show
  blocked, runnable and failed steps with retry/cancel controls.
- Define each step's checkout/worktree and its input revision. Review a stable revision; carry the
  predecessor's intended changes into dependent work explicitly.
- Add bounded automatic progression only after durable task state and validation exist. Respect
  checkout locks, configured concurrency and pause conditions; propagate cancellation visibly.

**Delivered:** Hand off creates a linked task from a source session and preserves the objective and
change baseline, while provider-native state stays with the original provider. Implement,
independent review and revision run as explicit steps over defined checkouts, with bounded opt-in
automatic progression and protection that keeps a shared worktree from being cleaned up mid-handoff.

**Delivered since:** a provider's own fan-out is reported as structure. A subagent notification
becomes its own transcript item showing the subagent's description, type, model and reported
duration under the task that owns it, instead of a generic tool event carrying a JSON blob. The item
says the subagent ran inside the provider, because RunHQ reports it and does not schedule or route
it; a payload RunHQ cannot read degrades to what the provider sent rather than disappearing.

**Acceptance:** one agent implements a change and another reviews that exact change, with a visible
handoff and resumable dependencies. Cross-provider handoff starts a new session with selected
context; it does not promise a lossless transfer of hidden provider state.

### A7. Reusable Task Recipes

**Baseline (2026-09-17):** built-in Plan, Fix, Review and Canvas templates already populate a draft.

- Save editable, named recipes with prompt parameters, project scope, preferred provider/model,
  supported effort/mode, context selection, worktree setup and validation commands.
- Offer recipes for recurring work such as bug reproduction, implementation followed by independent
  review, dependency updates and release preparation.
- Preview resolved settings before launch; identify unavailable tools or unsupported capabilities.
  Version recipes so editing one does not change a task already in progress.
- Export/import recipes with portable project references, excluding credentials and private history.

**Delivered:** recipes are named, editable and versioned, carrying prompt parameters, project scope,
preferred provider/model and worktree setup, and they launch either a prefilled draft task or a
workflow. Built-in recipes cover bug reproduction, implementation with independent review,
dependency updates and release preparation, and recipes can be exported and imported.

**Next:**

- Add scheduled and triggered recipe runs. The durable queue, recovery, capacity limits and recorded
  checks that this originally waited on now exist, so the remaining work is the schedule itself and
  its notification and pause policy.

**Acceptance:** repeat a workflow in another project with visible parameter substitutions and the
same intended setup/checks. Multi-step recipes build on A6; scheduled execution is later work.

### A8. Usage and Execution Capacity

**Baseline (2026-09-17):** provider-reported usage is stored and exposed as raw JSON; execution
already has checkout and global concurrency limits.

- Present reported tokens, cost, elapsed time and model per turn/task where available, with project
  and provider summaries. Label estimates and unavailable fields explicitly.
- Separate provider-reported cost from locally estimated cost. Subscription quotas and account-wide
  usage appear only when a supported source supplies them.
- Show active slots and why a task is waiting: checkout contention, configured capacity, provider
  failure or a reported limit. Add global and per-provider concurrency preferences.
- Add configurable usage notifications and admission limits for queued work. Explain when limits
  can only be evaluated after a turn because the provider reports usage at completion.

**Delivered:** capacity and usage are shown together: global and per-provider concurrency, slots in
use and why a task is waiting, plus reported token and cost summaries that label unavailable
provider data rather than showing zero. Warning and pause thresholds for queued follow-ups are
configurable per provider.

**Delivered since:** turn timing is recorded locally — when the active turn started, how long the
last completed turn took, and the total across completed turns — and the task table shows it under a
heading that says the measurement is RunHQ's own. A turn interrupted by a crash is discarded rather
than guessed from the last activity timestamp, so a measurement never stands in for an unknown. The
decision inbox already showed how long each request has been waiting.

**Acceptance:** understand a busy workspace's reported usage and waiting work without reading JSON
or interpreting missing provider data as zero. Automatic cross-provider fallback requires an
explicit handoff policy from A6.

### A9. Searchable Agent History and Project Memory

**Baseline (2026-09-17):** task metadata can be filtered/searched and conversation history is
persisted. Search across transcript content and reusable project memory need additional work.

- Search prompts, responses, decisions and artifact metadata across projects, with provider, date,
  status and project filters. Open the matching conversation item directly.
- Pin selected outcomes as project decisions/runbook entries with links to their source tasks and
  revisions. Allow editing, superseding and removing stale entries.
- Reuse selected entries as visible context through A5. Keep project memory scoped to the intended
  projects and preserve existing redaction in indexes and exports.
- Add history export/import and backup with retention controls; distinguish archived transcripts
  from provider-native state required to resume execution.

**Delivered:** search covers prompt, answer and decision content across projects with provider,
status, date and project filters and opens the matching conversation item. Results can be pinned as
project decisions that keep a link to their source task and can be edited or removed, reused as task
context through A5, exported and imported as archived transcripts, and removed through a retention
preview that shows what deletion would take.

**Acceptance:** find a previous fix or decision, inspect its evidence and deliberately reuse it in a
new task without copying an entire conversation.

### A10. Provider Accounts and Limit-Aware Routing

**Baseline (2026-09-18):** a tool connection is a single identity. `AgentTool` carries an id, name,
adapter, executable and args; it has no environment or configuration home, arguments are rejected
for the `codex`, `opencode` and `claude` adapters, and turn processes inherit the ambient
environment apart from `PATH`. Two accounts for the same product are therefore only possible through
wrapper scripts that RunHQ cannot reason about. Everything downstream is already identity-shaped:
execution slots and concurrency limits are counted per tool id, reported-usage thresholds are stored
per tool id, and a session records its tool and its adapter separately.

- Make a provider account a first-class connection: adapter, executable, arguments and an explicit
  environment or configuration home, with a label the user recognizes. RunHQ never creates, copies
  or stores credentials; each account points at a configuration home the user authenticates
  themselves.
- Group interchangeable accounts into a pool and let a task, a queued turn or a workflow step target
  either a specific account or its pool. Record the account that actually ran each turn in the
  transcript and in reported usage.
- Separate the routing signals rather than treating them as one policy. Capability fit is declared
  and deterministic: an account's adapter decides whether it accepts images, steering or a given
  plan mode, so a step that needs one can only go to an account that has it. Load is already
  measured: prefer an account with a free execution slot over one at its configured limit. Observed
  spend is local: compare RunHQ's own recorded tokens and cost against that account's thresholds.
- Treat a quota as an event, not a forecast. These CLIs do not publish a remaining allowance, so the
  only reliable quota signal is a reported rate or limit failure. Put that account on a visible
  cool-down, move queued work elsewhere, and never present an inferred remaining allowance as a
  reported one. Predicting when an account will run out is out of scope.
- Keep an account sticky for the life of a session, because provider-native resume belongs to the
  account that created it. Failover after a limit therefore starts a new session through the A6
  handoff rather than silently switching identity mid-conversation.
- Show per-account usage, waiting causes and cool-downs in A8's capacity view, and surface why a
  task chose the account it did.

**Delivered:** a connection carries an account environment, so the same product can be defined twice
and authenticate as two accounts. The variables reach every process RunHQ starts for that connection,
including model discovery and the installation probe. `PATH` and `RUNHQ_` names are rejected because
RunHQ owns them, the environment is bounded, and a rejected edit leaves the stored connection
untouched. A session snapshots the account it was created with, so repointing a connection never
moves a running conversation onto another identity. Slots, concurrency limits and usage thresholds
were already counted per connection and therefore apply per account without further work. Pools,
routing and cool-downs are the remaining scope.

**Acceptance:** register two accounts for the same provider, watch queued work move to the second
when the first reports a limit, and see for every turn which account ran it and why. Checkout locks
still serialize work that targets the same worktree.

### A11. Composable Multi-Provider Workflows

**Baseline (2026-09-18):** a workflow has exactly two agent roles. `AgentWorkflow` stores one
`implementation_session_id` plus a `review_session_id` with its own `reviewer_backend` and
`reviewer_model`, and the stage machine advances through a fixed setup → implement → review → checks
→ integrate sequence. Cross-provider role assignment already works for review; it is the shape, not
the capability, that is fixed. Provider-native subagents remain internal to the provider and do not
become RunHQ steps.

- Generalize the workflow into an ordered list of steps. Each step declares its role, the account or
  pool that runs it, the model, effort and mode to use, its checkout, and which revision it takes as
  input.
- Support plan, implement, review, revise and validate roles, so a plan can be produced by one model
  and implemented by another without leaving the workflow or copying context by hand.
- Store multi-step definitions as A7 recipes so a proven division of labor can be repeated across
  projects, with unavailable accounts or unsupported capabilities reported before launch.
- Keep progression explicit by default and bounded when enabled, preserving the existing stale-check
  and integration-preview rules for every step that produces changes.
- Surface provider-native subagent activity within the step that owns it, without implying RunHQ can
  schedule or route those subagents individually.

**Acceptance:** run one workflow whose plan, implementation and review are performed by different
providers and models, see each step's account and input revision, and repeat the same division of
labor in another project from a saved recipe.

## Delivery Sequence

| Phase                                | Focus                  | Completion signal                                                                                           |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1 — Reliable supervision             | A1 and A2              | Pending work survives restart; blocking decisions are visible and actionable centrally.                     |
| 2 — Reproducible, reviewable results | A3, A4 and A5          | An isolated task receives inspectable context and produces a reviewable change with current check results.  |
| 3 — Coordinated agent workflows      | A6, then multi-step A7 | Implementation, independent review and revision form a recoverable chain with explicit workspace ownership. |
| 4 — Manage a larger portfolio        | A8 and A9; extend A7   | Usage, waiting work, history and repeatable recipes remain understandable across many projects.             |
| 5 — Spend capacity deliberately      | A10, then A11          | Work spreads over the accounts a user already has, and each step of a task runs on the agent that suits it. |

All four phases are implemented in the repository as of 2026-09-18; the per-item gaps above are the
remaining work rather than whole phases. Provider compatibility and performance checks belong to
every phase.

## Quality and Product Validation

Existing CI runs frontend/runtime tests, lint, type checks and builds, plus Rust checks across macOS,
Linux and Windows. Extend that foundation around the agent workflows being delivered:

- Exercise interruption during a permission request, restart with queued turns, failed sends,
  duplicate events, expired requests and two tasks targeting the same checkout.
- Cover the actual UI journey from task creation through a decision to review, validation and
  recovery. Include long transcripts and many simultaneous task updates in responsiveness checks.
- Record provider/CLI version and whether a scenario was fixture-tested or verified live. Update
  the capability matrix when a provider adds or removes support.
- Make first use goal-oriented: detect/connect a tool, choose a project, finish one small task and
  inspect its result. Explain setup failures at the relevant step.
- Evaluate with realistic user sessions: time to first useful result, time spent finding blocked
  tasks, recovered work and effort to review/integrate a change. Use local measurements and voluntary
  feedback; this roadmap does not add a telemetry requirement.

## Supporting Product Areas

These capabilities already support agent work: project/service discovery and stacks; terminals,
logs and ports; Git status/diffs/commit flows; dependency/security views; AI assistance; activity
timeline, notes and project documentation. Their presence supersedes the old backlog's blanket
Planned/Proposed labels, without claiming every subfeature in those proposals is complete.

Prioritize further work here when it directly improves an agent task:

- Service readiness and setup diagnostics for reproducible worktrees and validation.
- Retained run logs and focused previews as evidence for debugging and review.
- Configuration backup and path remapping alongside agent history and workspace recovery.
- Existing Git, notes and docs surfaces as destinations for accepted results and reusable context.

## Later Opportunities

Revisit these after local supervision, recovery and review are dependable:

- **Scheduled/triggered agent jobs and a background runner:** explicit lifecycle and notification
  policies, reconnect after Quit, durable scheduling and visible pause/stop controls.
- **Remote agent hosts:** host identity, connection recovery, per-host execution capacity and access
  to the correct files and review artifacts.
- **External session import and native forks:** support only where providers expose reliable
  interfaces; imported transcripts alone do not establish a resumable native session.
- **Shared team supervision:** task ownership, shared review and scoped project access.

General database/API clients, calendars, mobile companion apps, a broad plugin platform and a full
embedded browser remain in the historical backlog. Promote them when a concrete agent workflow
justifies the added surface and maintenance cost.

## Contributing

Reference an A1–A9 item with the current behavior, intended user outcome, affected providers and a
concrete verification scenario. Use the historical backlog's original numbers only for those older
proposals, and check current implementation before treating an item as missing.
