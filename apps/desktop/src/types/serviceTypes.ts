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
  /**
   * Workspace-tracking-only flag. When `true` the service still
   * shows up in the sidebar / palette / search (so the user can
   * open it in an editor or terminal) but is filtered out of every
   * dashboard surface — Overview cards, headline counts, dependency
   * scan totals, license aggregates. Optional in the type because
   * older configs persisted before the field existed deserialise
   * without it; treat absent as `false`.
   */
  hide_dashboard?: boolean;
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
  raw?: boolean;
  detail?: string | null;
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

/**
 * Single batch of PTY output forwarded through a per-terminal
 * `Channel<TerminalOutput>`.
 *
 * `data` is **base64-encoded raw bytes** straight off the PTY master
 * fd — the Rust side encodes once on the boundary because Tauri's IPC
 * layer JSON-serializes typed channels (a `Vec<u8>` would balloon to
 * `[12, 34, ...]`, ~3-4× wire size; base64 holds at ~1.33×). Decode
 * with `atob` + a `Uint8Array` and hand the bytes straight to
 * `xterm.write` — no further parsing on the client.
 *
 * Each batch represents up to ~8 ms of PTY output coalesced on the
 * Rust side; the backend never lets a partial batch sit longer than
 * that, so interactive REPL echo still feels instant.
 */
export interface TerminalOutput {
  /** Base64-encoded raw bytes from the PTY master. Standard alphabet
   *  (NOT URL-safe) — the renderer decodes with `atob`. */
  data: string;
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

/**
 * Every keyboard shortcut the user can rebind. Two scopes coexist
 * here: `quick_action` and `focus_main` are OS-level globals
 * registered with Tauri's `tauri-plugin-global-shortcut` (active
 * even when RunHQ is hidden / unfocused), everything else is a
 * window-level binding handled by a React keydown listener (only
 * fires while the RunHQ window has focus). Stored together so a
 * single `prefs.json` round-trip persists every key.
 */
export interface Shortcuts {
  // ---- Global ----
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

  // ---- View (window-level) ----
  /** Pin / unpin the left sidebar. */
  toggle_left_sidebar: string;
  /** Open / close the AI Chat panel on the right. */
  toggle_ai_panel: string;
  /** Open / close the Activity timeline panel on the right. */
  toggle_activity_panel: string;
  /** Spawn a new terminal in the active service tab. */
  new_terminal: string;

  // ---- Main tabs (window-level) ----
  /** Cycle to the next main tab in the top tab strip. */
  next_main_tab: string;
  /** Cycle to the previous main tab. */
  prev_main_tab: string;
  /** Close the currently-active main tab (dashboard is sticky). */
  close_main_tab: string;
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
