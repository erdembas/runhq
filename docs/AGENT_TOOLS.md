# Agent tools

RunHQ’s **Agents → Agent tools** screen manages installed tools and custom connections. Tool configuration is stored in the agent SQLite database; application restart preserves enabled state, executable paths and argument arrays. Codex, OpenCode, Claude and Cursor are included as enabled presets. Existing saved configurations are preserved; newly introduced presets appear automatically.

## Connection types

| Connection                       | Experience                                                                                            | Scope                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Native Codex / OpenCode / Claude | Unified task composer, transcripts and provider-specific interactions                                 | Existing native adapters; custom paths can reuse an adapter  |
| Cursor                           | Native Agent / Plan / Ask modes, plan approval, structured questions and progress                     | Cursor CLI via its official ACP connection (`agent acp`)     |
| ACP                              | Unified conversation, streamed reasoning/tools/plans, permission choices, advertised models and modes | ACP v1 over newline-delimited JSON-RPC on stdio              |
| Terminal                         | Embedded interactive CLI, including its own login, models, questions and permissions                  | Any locally executable interactive CLI compatible with a PTY |

**Add tool** accepts a name, executable, connection type and an optional account environment. For ACP or terminal connections, each arguments-field line is passed as one argument, including embedded spaces. No shell parsing, command substitution, package installation or credential copying occurs. There are no hardcoded claims about third-party model availability.

## Multiple accounts for one tool

A connection is an identity, so running the same product under two accounts means defining it twice. **Add account** on an installed tool opens a prefilled copy; give it its own name and an account environment of `KEY=value` lines, typically the provider's configuration home (for example `CODEX_HOME`). The variables are applied to every process RunHQ starts for that connection — turns, model discovery and the installation probe — so each connection authenticates as its own account.

RunHQ never creates, copies or stores credentials. Log in to each configuration home yourself using the tool's own CLI; RunHQ only selects which home a connection uses. `PATH` is rejected because RunHQ resolves executables itself — set the executable on the connection instead — and `RUNHQ_` names are reserved by the bridge. A connection carries at most 32 variables.

Because each connection is a separate identity, execution slots, concurrency limits and reported-usage thresholds already apply per account. A session records the account it was created with and keeps it: repointing the connection at another configuration home does not move a conversation that is already running, since provider-native resume belongs to the account that opened it.

Use **Test connection** with a selected project to discover an integrated tool’s capabilities. Discovery initializes a temporary agent session but sends no model prompt. It may still require the tool’s normal authentication. Tools without an installed executable remain configurable and report **Missing**. Native adapters are probed with `--version`; the Cursor preset checks its ACP subcommand help. Arbitrary custom programs are not executed during path detection.

## Automatic detection

Detection checks executable files in PATH, then standard user/package-manager locations, Node version-manager installations and supported macOS app bundles. Cursor's `cursor-agent` alias is also recognized. An explicit executable path is respected and never silently replaced. Detection, model discovery, task creation and tool terminals use the same resolver. Required Node binaries are added only to the child process's PATH; RunHQ does not modify your shell configuration.

**Installed**, **Needs setup** and **Missing** are separate states. A CLI that exists but fails its version, runtime or protocol check keeps its resolved path and reports the actual problem. Expand **Executable & detection details** to see the path, version and discovery source. Checks close stdin, bound output and time out; they never send a model prompt.

New tasks automatically select an enabled, available conversation agent. Manual selections and executable overrides stay unchanged during rechecks. The connection row then loads the selected agent's models and modes for the project. Authentication/model failures offer a retry; an invalid pinned model can be cleared with **Use agent default**. A successful connection is required before creating a new task. No placeholder model menu is shown for an unconnected agent.

**Recheck** scans installations and refreshes the selected connection. **Re-scan** refreshes the tools panel; returning to a visible agent view also rechecks when the last scan is at least 30 seconds old. Concurrent views share scans and model requests. Successful model discovery is cached for five minutes and invalidated by changed executable/configuration/version or an explicit refresh.

Use **Open CLI** for native tools or **Open terminal** for terminal connections. Each instance opens in the selected project, with its own terminal tab. Closing the management panel preserves these terminals; closing an individual terminal or pressing its tool’s **Stop** control destroys the owned process. Terminal counts mean open terminal instances, not inferred model activity. Terminal instances are not resumed after RunHQ exits. Unified native/ACP task history remains durable and appears in global/project Agents views.

Disabling a tool removes it from new-task selection and prevents new unified turns or terminal starts. Active work continues. **Stop** interrupts that tool’s active unified turns and closes its terminal instances. Saving changed arguments/adapters does not mutate the configuration snapshot of an existing unified session.

## ACP capability boundaries

The adapter negotiates protocol v1 and exposes model/mode selectors reported by the agent. Modern `configOptions` categories `model`, `thought_level` and `mode` are preferred over legacy model/mode state. Other configuration options retain agent defaults. Reasoning choices are discovered for the selected model, validated again after changing it, and passed as exact wire values. Permission selections are validated against the options of the specific request; cancellation resolves outstanding requests with the protocol’s cancelled outcome.

Resuming uses the advertised `session/resume` or `session/load` support. Load replay is suppressed in the existing transcript. Returned configuration state is persisted for agents whose later load response omits optional metadata. A tool that cannot resume reports that limitation instead of silently discarding conversation context. The adapter records the initial agent mode and restores it when leaving a saved plan; if that default is unknown, choose an advertised mode explicitly. Cursor's default restores its advertised `agent` mode. Custom mode IDs remain available in the profile selector.

Image attachments are sent only to connections whose adapter accepts them — today the Codex and Claude integrations. ACP and OpenCode connections report that limitation in the composer's context tray instead of dropping the attachment, and text context (workspace paths, log excerpts, notes, saved project decisions) is sent to every connection as ordinary prompt content.

RunHQ currently advertises no ACP client filesystem, client terminal or general elicitation extensions. Agents needing these client-hosted services or other unsupported requests should use a terminal connection; unsupported RPC requests receive a method-not-found response and a visible notice. Ordinary questions in agent text are answered through the next composer message. Rich question forms use the native integrations and Cursor's supported extensions. Terminal tools keep their complete interactive UI but do not gain normalized chat/tool events, structured status or model selectors merely by being added.

## Cursor setup and native interactions

Install [Cursor CLI](https://cursor.com/docs/cli/overview), then run `agent login` using Cursor's own authentication. The built-in preset launches executable `agent` with argument `acp`; change the executable path in **Configure** if needed. Both detection and runtime first inspect `agent acp --help`, including versions with a hidden ACP subcommand. A CLI that does not advertise ACP reports an upgrade instruction before a turn can start. **Test connection** authenticates through the advertised `cursor_login` method and discovers capabilities without sending a model prompt. RunHQ does not install Cursor or copy its credentials.

The Agent / Plan / Ask controls appear only when advertised by the running CLI. Plan mode and Ask mode use Cursor's native behavior. Cursor's blocking `cursor/create_plan` request displays the full plan and waits for explicit approval or rejection. `cursor/ask_question` displays single or multiple-choice questions and returns the provider's original option IDs, including when option labels repeat. Invalid responses remain pending for correction. Stopping a task cancels these requests and the provider prompt without approving anything.

Cursor todo notifications are merged or replaced according to their protocol flag, persisted for later turns, and displayed as plan progress. Subagent notifications become transcript tool events; image notifications display the reported file path. These notifications do not launch additional RunHQ sessions or render local image files automatically. Session-load replay does not duplicate questions, plans or progress.

The RunHQ workspace canvas is a RunHQ view of its tasks. Cursor's documented ACP interface does not advertise a native Canvas protocol or a hosted Cursor editor canvas. Team-level Cursor dashboard MCP servers and client-hosted filesystem/terminal methods are outside this integration's support.

Reference: [Cursor ACP documentation](https://cursor.com/docs/cli/acp).

Protocol references: [initialization](https://agentclientprotocol.com/protocol/initialization), [sessions](https://agentclientprotocol.com/protocol/session-setup), [configuration](https://agentclientprotocol.com/protocol/session-config-options), [permission requests](https://agentclientprotocol.com/protocol/tool-calls).

## Verification

Tests cover persisted tool enablement and Cursor defaults, built-in adapter protection, literal argument handling in a real PTY, immutable session connection snapshots, disabled-tool start rejection, ACP discovery, streaming, invalid permission decisions, cancellation, replay suppression and optional metadata on resume. Cursor fixtures cover authentication, discovered legacy modes/models, plan approval and rejection, option-ID validation, cancellation during both blocking extension types, todo merging and native mode transitions on resume. Existing native/runtime, project-task and terminal backpressure tests remain in place. Centralized agent management adds coverage for attachment validation and per-adapter image capability, durable queues and restart recovery, revalidating a pending request before an answer is accepted, workflow setup/review/check/integration lifecycle over real temporary Git repositories, and the recipe, history and project-decision library. These fixtures exercise the documented protocol; live Cursor operation requires a locally installed, authenticated CLI.
