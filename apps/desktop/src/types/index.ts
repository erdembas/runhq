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
  /** 'major' | 'minor' | 'patch' | null when unclassified. */
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
  /** CVE-*, GHSA-*, or RUSTSEC-* identifier when available. */
  id: string | null;
  package: string;
  /** Normalised to 'critical' | 'high' | 'medium' | 'low' | 'info'. */
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
}

export interface DependencyScanResult {
  entries: DependencyScanEntry[];
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
  /** Correlation id tying a lifecycle event to every log/file/error it produced
   *  during the same service run, so the UI can collapse noisy runs. `null`
   *  for git events, orphan logs, or rows written before this column existed. */
  run_id: string | null;
}

export interface DailySummary {
  date: string;
  projects_worked: number;
  commits: number;
  services_started: number;
  errors: number;
  project_names: string[];
}
