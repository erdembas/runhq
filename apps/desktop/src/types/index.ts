export type ServiceId = string;

export interface CommandEntry {
  name: string;
  cmd: string;
}

export interface ServiceDef {
  id: ServiceId;
  name: string;
  cwd: string;
  cmds: CommandEntry[];
  env: Array<[string, string]>;
  path_override?: string | null;
  pre_command?: string | null;
  port?: number | null;
  tags: string[];
  auto_start: boolean;
  open_browser: boolean;
  grace_ms: number;
}

export type Status = 'stopped' | 'starting' | 'running' | 'stopping' | 'exited' | 'crashed';

export interface CommandStatus {
  name: string;
  status: Status;
  pid?: number | null;
  started_at_ms?: number | null;
  exit_code?: number | null;
  error?: string | null;
}

export interface ServiceStatus {
  id: ServiceId;
  status: Status;
  pid?: number | null;
  started_at_ms?: number | null;
  exit_code?: number | null;
  error?: string | null;
  commands: CommandStatus[];
  /** Correlation id of the currently-active run, populated by the Rust
   *  supervisor. Present while any command of this service is alive;
   *  `null` / absent once the last command has exited. The UI uses this
   *  to deterministically attribute incoming `LogLine`s to the owning
   *  lifecycle event — no timestamp heuristics. */
  run_id?: string | null;
}

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogLine {
  seq: number;
  ts_ms: number;
  stream: LogStream;
  text: string;
  /** Correlation id of the run that produced this line. Rust stamps every
   *  line emitted between the `start_*` call and the child's exit —
   *  including the `$ <cmd>` prompt echo and the `[exited code N]`
   *  closer — with the same id, so the UI can group lines under the
   *  owning lifecycle event without any timestamp arithmetic. */
  run_id?: string | null;
}

export interface LogEvent {
  service_id: ServiceId;
  cmd_name: string;
  line: LogLine;
}

export interface ListeningPort {
  port: number;
  pid: number;
  process_name: string;
  /** Parent chain of `pid`, nearest parent first. Used to match forked workers
   *  (e.g. `pnpm` → `next-dev` → listener) back to a supervised command. */
  ancestor_pids?: number[];
}

export interface Suggestion {
  label: string;
  cmd: string;
}

export interface ProjectCandidate {
  name: string;
  cwd: string;
  runtime: string;
  suggestions: Suggestion[];
  package_manager?: string;
  project_name?: string;
}

export interface AppInfo {
  version: string;
  state_dir: string;
}

export interface Shortcuts {
  quick_action: string;
  /**
   * Global shortcut that brings the main RunHQ window to the
   * foreground from anywhere on the OS — even when the app is
   * hidden in the menu-bar / tray, minimised, or sitting behind a
   * fullscreen editor. Companion to `quick_action`: the palette
   * shortcut opens the floating command bar, this one promotes the
   * main window so the user can resume their full workflow.
   */
  focus_main: string;
}

export interface Prefs {
  theme?: string | null;
  last_scanned_dir?: string | null;
  shortcuts?: Shortcuts;
}

export interface DetectedEditor {
  key: string;
  name: string;
  command: string;
}

export interface StackDef {
  id: string;
  name: string;
  service_ids: string[];
  auto_start: boolean;
}

export interface StackStatus {
  id: string;
  running: number;
  total: number;
}

export interface GitCommitInfo {
  hash_short: string;
  hash_full: string;
  author: string;
  email: string;
  subject: string;
  timestamp: number;
}

export interface ResourceSample {
  cpu_percent: number;
  memory_bytes: number;
}

export interface ResourceEvent {
  service_id: ServiceId;
  cpu_percent: number;
  memory_bytes: number;
}

export interface GitStatus {
  branch: string | null;
  head_short: string | null;
  head_full: string | null;
  is_dirty: boolean;
  dirty_count: number;
  ahead: number;
  behind: number;
  upstream: string | null;
  last_commit: GitCommitInfo | null;
}

export type SectionId = string;

/** A fixed palette keeps colors harmonised with the theme and avoids the
 *  accessibility pitfalls of free-form color pickers. */
export type SectionColor =
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'pink'
  | 'cyan'
  | 'yellow'
  | 'slate';

/** Purely organisational grouping in the sidebar. Unlike stacks, a section
 *  carries no runtime semantics — it is a visual folder that can hold both
 *  stacks and standalone services. Persisted locally only (no backend). */
export interface Section {
  id: SectionId;
  name: string;
  color: SectionColor;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  bump: string | null;
  homepage: string | null;
}

export interface OutdatedResult {
  total: number;
  major: number;
  minor: number;
  patch: number;
  packages: OutdatedPackage[];
}

export interface Advisory {
  id: string | null;
  package: string;
  severity: string;
  title: string;
  url: string | null;
  vulnerable_range: string | null;
  fix_version: string | null;
}

export interface AuditResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  advisories: Advisory[];
}

export interface ProjectOverview {
  service_id: string;
  name: string;
  cwd: string;
  runtime: string | null;
  is_running: boolean;
  git_status: GitStatus | null;
  cpu_percent: number;
  memory_bytes: number;
  last_activity: string | null;
  is_stale: boolean;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  tags: string[];
}

export interface OverviewSummary {
  projects: ProjectOverview[];
  total_running: number;
  total_stopped: number;
  total_dirty: number;
  total_behind: number;
  total_cpu: number;
  total_memory: number;
  total_outdated: number;
  total_vulnerabilities: number;
  stale_count: number;
  has_dependency_scan: boolean;
}

export interface DependencyScanEntry {
  service_id: string;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  /**
   * Wall-clock epoch ms when this individual project's scan finished.
   * Used to drive the per-card "Last scanned 3h ago" chip.
   */
  scanned_at_ms: number;
  /** How long the per-project scan ran (ms). null on cache hits. */
  duration_ms: number | null;
  /**
   * `true` when the entry came out of the in-memory 5-minute cache
   * rather than a fresh subprocess run. Lets the UI tell "you just
   * rescanned" apart from "we reused a stale result".
   */
  from_cache: boolean;
  /**
   * Total outdated count from the previous persisted scan for this
   * project. `null` when there is no prior scan (first run) or this
   * entry came from cache (no meaningful comparison). Drives the
   * "↑3 since last scan" delta badge on the dashboard's outdated
   * chip — the difference between the live total and this number
   * tells the user "what changed since I last looked".
   */
  previous_total_outdated: number | null;
  previous_total_vulnerabilities: number | null;
}

export interface DependencyScanResult {
  entries: DependencyScanEntry[];
  total_outdated: number;
  total_vulnerabilities: number;
}

/**
 * One row from the persistent SQLite scan history. Returned by
 * `listPersistedScans()` so the dashboard can render a "Last scanned"
 * chip on every project card the moment it mounts, without having to
 * wait for a full rescan.
 *
 * Mirrors the Rust `PersistedScan` shape one-to-one. `cwd` and
 * `service_name` are denormalised at write time so we can label rows
 * even after a service has been removed and re-added (which would
 * orphan the row by `service_id`).
 */
export interface PersistedScan {
  service_id: string;
  cwd: string;
  service_name: string;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  scanned_at_ms: number;
  duration_ms: number | null;
  total_outdated: number;
  total_vulnerabilities: number;
}

export type TimelineEventType =
  | 'service_started'
  | 'service_stopped'
  | 'service_crashed'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'git_checkout'
  | 'git_branch_created'
  | 'git_stash'
  | 'log_error'
  | 'log_warning'
  | 'file_changed';

export interface TimelineEvent {
  id: number;
  timestamp: string;
  service_id: string | null;
  service_name: string | null;
  event_type: TimelineEventType;
  description: string;
  run_id: string | null;
}

// ---- AI providers --------------------------------------------------------

export type AiProviderKind = 'openai';

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  /** BCP-47-ish language code (`en`, `tr`, `auto`, …) the model should
   *  respond in. `null`/`undefined`/`auto` means "let the model
   *  decide". See `AI_LANGUAGE_OPTIONS` for the curated list. */
  response_language?: string | null;
  /** Per-provider override for AI-generated commit messages. Kept
   *  separate from {@link response_language} because the audiences
   *  diverge: chat replies are read by the user (their native tongue
   *  is fine), but commits enter the project history where the
   *  team convention often demands English regardless of the
   *  developer's UI preference.
   *
   *  Resolution:
   *    - `null`/`undefined`/empty/`inherit` → fall back to
   *      `response_language`
   *    - `auto` → opt out of any language directive on commits
   *      (the model decides; usually mirrors diff-comment language)
   *    - any other code → forced directive on commit surface only
   */
  commit_language?: string | null;
  /** Hard ceiling on streamed output tokens for this provider, in
   *  tokens. `null`/`undefined` means "no client-side cap" — RunHQ
   *  sends no `max_tokens` and lets the server apply its own
   *  model-aware default. Useful for users on long-context models
   *  (Gemini 1M, Claude 200K) who want big diff/history analyses,
   *  *and* for users on tiny local servers who want to clamp output
   *  to fit their model's window. */
  max_output_tokens?: number | null;
  /** Optional per-provider context window (input + output) in tokens.
   *  Drives the chat composer's TokenMeter — when set, the meter
   *  renders a `12.4k / 128k` gauge with traffic-light coloring as
   *  the user approaches the cap. `null`/`undefined` means we just
   *  show the raw count without a denominator. */
  context_window?: number | null;
  created_at_ms: number;
}

export interface AiProviderInput {
  id?: string | null;
  name: string;
  kind?: AiProviderKind;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  response_language?: string | null;
  commit_language?: string | null;
  max_output_tokens?: number | null;
  context_window?: number | null;
}

export interface AiTestResult {
  ok: boolean;
  latency_ms: number;
  model?: string | null;
  message?: string | null;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatOptions {
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface ChatResponse {
  content: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface GenerateCommitResult {
  message: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  provider_id: string;
  provider_name: string;
}

/// One chunk of a streaming AI response.
///
/// Mirrors `runhq_core::ai::StreamChunk` (serde tag = "type"). Discriminate
/// on `type` and the rest of the fields are narrowed by the compiler.
export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  /// Sent when the splitter sees `</think>` without ever seeing the
  /// matching `<think>` opener — proxy-stripped reasoning streams.
  /// The reducer concats `text` onto `reasoning` and resets `text`.
  | { type: 'reclassify_as_reasoning' }
  | {
      type: 'done';
      content: string;
      reasoning?: string | null;
      model?: string | null;
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
      /// Why the model stopped generating, as reported by the
      /// provider. `"length"` means the answer was truncated by
      /// `max_tokens` / context cap and the UI should surface a
      /// "Response was cut off" banner with a Continue affordance.
      /// Other observed values: `"stop"`, `"content_filter"`,
      /// `null` (provider didn't report).
      finish_reason?: string | null;
    }
  | { type: 'error'; message: string };

/**
 * Where a chat conversation came from. Drives the icon shown in the
 * History drawer and the surface-specific suggestions in the composer.
 *
 * - `free`: user typed into the chat panel directly (no surface).
 * - `why`: ServiceCard "Why?" button on the dashboard.
 * - `log`: right-click on a log line in LogPanel.
 * - `diff`: "Explain" button on a diff hunk in DiffPane.
 * - `commit`: "Generate commit message" in CommitPanel.
 * - `standup`: "Polish for standup" in ActivityTimeline.
 * - `dashboard_report`: "Analyze workspace" button on the dashboard.
 * - `advisory`: "Ask AI" on the advisories panel.
 */
export type ConversationOrigin =
  | 'free'
  | 'why'
  | 'log'
  | 'diff'
  | 'commit'
  | 'standup'
  | 'dashboard_report'
  | 'advisory';

export type ConversationMessageRole = 'user' | 'assistant';

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  /** Frontend-supplied stable id (the chat panel's `Turn.id`).
   *  Lets a "Continue" or "cancel after partial" loop upsert into
   *  the same row instead of fragmenting one turn into many bubbles
   *  on reload. May be null for legacy rows or messages persisted
   *  before this column existed. */
  client_id?: string | null;
  seq: number;
  role: ConversationMessageRole;
  content: string;
  reasoning?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  model_name?: string | null;
  finish_reason?: string | null;
  partial: boolean;
  error?: string | null;
  created_at_ms: number;
}

export interface Conversation {
  id: string;
  title: string;
  origin: string;
  context_json?: string | null;
  pinned: boolean;
  /** User-curated star. Pin = always-on-top; favorite = "I want to
   *  find this again later". A conversation can be favorited without
   *  being pinned. */
  favorite: boolean;
  archived: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  messages: ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  origin: string;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  message_count: number;
  last_preview?: string | null;
}

export interface DailySummary {
  date: string;
  projects_worked: number;
  commits: number;
  services_started: number;
  errors: number;
  project_names: string[];
}

export type FileDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

export interface FileDiff {
  path: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
}

export interface DiffSummary {
  files: FileDiff[];
  total_additions: number;
  total_deletions: number;
}

export interface CommitSummary {
  hash_full: string;
  hash_short: string;
  parents: string[];
  author: string;
  email: string;
  subject: string;
  timestamp: number;
  refs: string[];
}
