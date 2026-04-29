import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AiProvider,
  AiProviderInput,
  AiTestResult,
  AppInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  CommandEntry,
  CommitSummary,
  Conversation,
  ConversationSummary,
  DailySummary,
  DependencyScanEntry,
  DependencyScanResult,
  DetectedEditor,
  DiffSummary,
  GenerateCommitResult,
  GitStatus,
  ListeningPort,
  LogEvent,
  LogLine,
  OverviewSummary,
  PersistedScan,
  Prefs,
  ProjectCandidate,
  ResourceEvent,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
  StackStatus,
  StreamChunk,
  TerminalOutput,
  TimelineEvent,
  TimelineEventType,
} from '@/types';

/**
 * Typed Tauri IPC surface.
 *
 * This module is the **single source of truth** for every frontend↔backend
 * call. Do not call `invoke` anywhere else. Mirroring the Rust command
 * signatures here keeps contracts visible in one place and trivially
 * greppable during review.
 */
export const ipc = {
  appInfo: () => invoke<AppInfo>('app_info'),

  listServices: () => invoke<ServiceDef[]>('list_services'),
  addService: (input: {
    name: string;
    cwd: string;
    cmds: CommandEntry[];
    env?: Array<[string, string]>;
    path_override?: string | null;
    pre_command?: string | null;
    port?: number | null;
    tags?: string[];
    auto_start?: boolean;
    open_browser?: boolean;
    grace_ms?: number;
  }) => invoke<ServiceDef>('add_service', { input }),
  updateService: (service: ServiceDef) => invoke<ServiceDef>('update_service', { service }),
  removeService: (id: ServiceId) => invoke<boolean>('remove_service', { id }),

  scanDirectory: (path: string) => invoke<ProjectCandidate[]>('scan_directory', { path }),
  detectProject: (path: string) => invoke<ProjectCandidate | null>('detect_project', { path }),

  startService: (id: ServiceId) => invoke<ServiceStatus>('start_service', { id }),
  startServiceCmd: (id: ServiceId, cmdName: string) =>
    invoke<ServiceStatus>('start_service_cmd', { id, cmdName }),
  stopService: (id: ServiceId) => invoke<ServiceStatus>('stop_service', { id }),
  stopServiceCmd: (id: ServiceId, cmdName: string) =>
    invoke<ServiceStatus>('stop_service_cmd', { id, cmdName }),
  restartService: (id: ServiceId) => invoke<ServiceStatus>('restart_service', { id }),
  serviceStatus: (id: ServiceId) => invoke<ServiceStatus>('service_status', { id }),

  getLogs: (id: string, sinceSeq = 0, limit = 2000) =>
    invoke<LogLine[]>('get_logs', { id, sinceSeq, limit }),
  clearLogs: (id: string) => invoke<void>('clear_logs', { id }),

  listPorts: () => invoke<ListeningPort[]>('list_ports'),
  killPort: (port: number) => invoke<number[]>('kill_port', { port }),

  openPath: (path: string) => invoke<void>('open_path', { path }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),

  getPrefs: () => invoke<Prefs>('get_prefs'),
  updatePrefs: (prefs: Prefs) => invoke<Prefs>('update_prefs', { prefs }),

  detectEditors: () => invoke<DetectedEditor[]>('detect_editors'),
  openInEditor: (command: string, path: string) =>
    invoke<void>('open_in_editor', { command, path }),

  listStacks: () => invoke<StackDef[]>('list_stacks'),
  addStack: (input: { name: string; service_ids: string[]; auto_start?: boolean }) =>
    invoke<StackDef>('add_stack', { input }),
  updateStack: (stack: StackDef) => invoke<StackDef>('update_stack', { stack }),
  removeStack: (id: string) => invoke<boolean>('remove_stack', { id }),
  startStack: (id: string) => invoke<StackStatus>('start_stack', { id }),
  stopStack: (id: string) => invoke<StackStatus>('stop_stack', { id }),
  restartStack: (id: string) => invoke<StackStatus>('restart_stack', { id }),

  /**
   * Spin up a PTY shell for `id` and start streaming its output through
   * a per-instance Tauri `Channel<TerminalOutput>`. Channels bypass the
   * global event bus, so we don't pay an id-filter scan on every tick
   * — the Rust side only ships to *this* terminal's channel and the
   * supplied `onOutput` callback fires directly.
   *
   * `data` is base64-encoded raw PTY bytes (~33% overhead vs the prior
   * JSON-array `Vec<u8>` shape that ballooned to 3-4× wire size). The
   * caller is expected to `atob` + write into xterm.js verbatim.
   *
   * The returned promise resolves once the backend has spawned the
   * shell. It rejects if PTY allocation, child spawn, or the initial
   * shell-resolution path fails — callers should surface this in the
   * UI (e.g. by writing a red banner into the terminal) so an empty
   * black pane never silently means "shell never started".
   */
  terminalCreate: (
    id: string,
    cwd: string,
    cols: number,
    rows: number,
    onOutput: (chunk: TerminalOutput) => void,
  ) => {
    const channel = new Channel<TerminalOutput>();
    channel.onmessage = onOutput;
    return invoke<void>('terminal_create', { id, cwd, cols, rows, onOutput: channel });
  },
  terminalWrite: (id: string, data: number[]) => invoke<void>('terminal_write', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>('terminal_resize', { id, cols, rows }),
  terminalDestroy: (id: string) => invoke<void>('terminal_destroy', { id }),

  showTrayHint: () => invoke<void>('show_tray_hint'),
  showQuickAction: () => invoke<void>('show_quick_action'),
  hideQuickAction: () => invoke<void>('hide_quick_action'),
  focusMainWindow: () => invoke<void>('focus_main_window'),

  gitStatus: (id: ServiceId) => invoke<GitStatus | null>('git_status', { id }),
  gitBranches: (id: ServiceId) => invoke<string[]>('git_branches', { id }),
  gitRemoteBranches: (id: ServiceId) => invoke<string[]>('git_remote_branches', { id }),
  gitCheckout: (id: ServiceId, branch: string) => invoke<void>('git_checkout', { id, branch }),
  gitCreateBranch: (id: ServiceId, name: string) => invoke<void>('git_create_branch', { id, name }),
  gitDeleteBranch: (id: ServiceId, name: string, force: boolean) =>
    invoke<void>('git_delete_branch', { id, name, force }),
  gitFetch: (id: ServiceId) => invoke<void>('git_fetch', { id }),
  gitPull: (id: ServiceId) => invoke<void>('git_pull', { id }),
  gitStash: (id: ServiceId, message?: string | null) =>
    invoke<void>('git_stash', { id, message: message ?? null }),
  gitStashPop: (id: ServiceId) => invoke<void>('git_stash_pop', { id }),
  gitUndoLastCommit: (id: ServiceId) => invoke<void>('git_undo_last_commit', { id }),
  gitAmendCommitMessage: (id: ServiceId, message: string) =>
    invoke<void>('git_amend_commit_message', { id, message }),

  getProjectOverview: (staleThresholdDays?: number) =>
    invoke<OverviewSummary>('get_project_overview', {
      staleThresholdDays: staleThresholdDays ?? 30,
    }),
  scanProjectDependencies: (force = false) =>
    invoke<DependencyScanResult>('scan_project_dependencies', { force }),
  /**
   * Rescan one project. Default `force = true` because the only
   * sensible reason to invoke this directly is "I want fresh data
   * for THIS project right now"; if the user wanted cached data the
   * dashboard would already have it.
   */
  scanProjectDependencyForService: (serviceId: ServiceId, force = true) =>
    invoke<DependencyScanEntry>('scan_project_dependency_for_service', {
      serviceId,
      force,
    }),
  /**
   * Hydrate the dashboard's freshness chips on cold start: returns every
   * persisted dependency scan, newest first. The Rust side merges
   * persisted entries into `OverviewSummary` automatically, but the
   * frontend still needs the raw list to render per-card "Last scanned"
   * timestamps that aren't part of the overview shape.
   */
  listPersistedScans: () => invoke<PersistedScan[]>('list_persisted_scans'),
  /**
   * Drop the cached scan row for one project so its freshness chip
   * disappears until the user reruns the scan. Useful when a project's
   * registry / lockfile has been swapped under the app and the stale
   * advisory list is now misleading.
   */
  deletePersistedScan: (serviceId: ServiceId) =>
    invoke<void>('delete_persisted_scan', { serviceId }),
  /** Wipe every persisted scan row; returns the number dropped. */
  clearPersistedScans: () => invoke<number>('clear_persisted_scans'),

  recordTimelineEvent: (
    eventType: TimelineEventType,
    serviceId?: string | null,
    serviceName?: string | null,
    description?: string,
    runId?: string | null,
  ) =>
    invoke<void>('record_timeline_event', {
      eventType,
      serviceId: serviceId ?? null,
      serviceName: serviceName ?? null,
      description: description ?? '',
      runId: runId ?? null,
    }),
  getTimeline: (
    serviceId?: string | null,
    eventType?: string | null,
    sinceMs?: number | null,
    limit?: number,
  ) =>
    invoke<TimelineEvent[]>('get_timeline', {
      serviceId: serviceId ?? null,
      eventType: eventType ?? null,
      sinceMs: sinceMs ?? null,
      limit,
    }),
  getDailySummary: (date: string) => invoke<DailySummary>('get_daily_summary', { date }),
  getWeeklySummary: (date: string) => invoke<DailySummary[]>('get_weekly_summary', { date }),
  exportStandup: (sinceMs: number) => invoke<string>('export_standup', { sinceMs }),

  // ---- Conversations (AI chat history) ---------------------------------
  listConversations: (
    input: {
      limit?: number;
      include_archived?: boolean;
      /** When true, only conversations with `favorite = 1` are returned. */
      favorites_only?: boolean;
      /** Substring search across title and message content. Whitespace-only
       *  strings are treated as no filter by the backend. */
      query?: string | null;
    } = {},
  ) =>
    invoke<ConversationSummary[]>('list_conversations', {
      input: {
        limit: input.limit ?? null,
        include_archived: input.include_archived ?? false,
        favorites_only: input.favorites_only ?? false,
        query: input.query ?? null,
      },
    }),
  getConversation: (id: string) => invoke<Conversation>('get_conversation', { id }),
  createConversation: (input: { title: string; origin: string; context_json?: string | null }) =>
    invoke<string>('create_conversation', {
      input: {
        title: input.title,
        origin: input.origin,
        context_json: input.context_json ?? null,
      },
    }),
  appendConversationMessage: (input: {
    conversation_id: string;
    /** Stable client-supplied id; supply a turn id to upsert in
     *  place across continue/cancel/retry loops. Omit for one-shot
     *  appends where each call should produce a fresh row. */
    client_id?: string | null;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string | null;
    provider_id?: string | null;
    provider_name?: string | null;
    model_name?: string | null;
    finish_reason?: string | null;
    partial?: boolean;
    error?: string | null;
  }) =>
    invoke<string>('append_conversation_message', {
      input: {
        conversation_id: input.conversation_id,
        client_id: input.client_id ?? null,
        role: input.role,
        content: input.content,
        reasoning: input.reasoning ?? null,
        provider_id: input.provider_id ?? null,
        provider_name: input.provider_name ?? null,
        model_name: input.model_name ?? null,
        finish_reason: input.finish_reason ?? null,
        partial: input.partial ?? false,
        error: input.error ?? null,
      },
    }),
  renameConversation: (id: string, title: string) =>
    invoke<void>('rename_conversation', { input: { id, title } }),
  pinConversation: (id: string, pinned: boolean) =>
    invoke<void>('pin_conversation', { input: { id, pinned } }),
  favoriteConversation: (id: string, favorite: boolean) =>
    invoke<void>('favorite_conversation', { input: { id, favorite } }),
  archiveConversation: (id: string, archived: boolean) =>
    invoke<void>('archive_conversation', { input: { id, archived } }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  gitDiff: (id: ServiceId) => invoke<DiffSummary>('git_diff', { id }),
  gitDiffStaged: (id: ServiceId) => invoke<DiffSummary>('git_diff_staged', { id }),
  gitDiffFile: (id: ServiceId, file: string, context?: number) =>
    invoke<string>('git_diff_file', { id, file, context }),
  gitDiffFileStaged: (id: ServiceId, file: string, context?: number) =>
    invoke<string>('git_diff_file_staged', { id, file, context }),
  gitDiffBranches: (id: ServiceId, base: string, head: string) =>
    invoke<DiffSummary>('git_diff_branches', { id, base, head }),
  gitDiffAllRaw: (id: ServiceId) => invoke<string>('git_diff_all_raw', { id }),
  gitDiffStagedRaw: (id: ServiceId) => invoke<string>('git_diff_staged_raw', { id }),

  gitStageFile: (id: ServiceId, path: string) => invoke<void>('git_stage_file', { id, path }),
  gitUnstageFile: (id: ServiceId, path: string) => invoke<void>('git_unstage_file', { id, path }),
  gitStageAll: (id: ServiceId) => invoke<void>('git_stage_all', { id }),
  gitUnstageAll: (id: ServiceId) => invoke<void>('git_unstage_all', { id }),
  /**
   * Throw away working-tree changes for a single path. Backend
   * auto-detects tracked vs untracked and routes to `git checkout HEAD --`
   * or `git clean -f -d --` respectively. Both are irreversible — gate
   * the call behind a confirmation in the UI.
   */
  gitDiscardFile: (id: ServiceId, path: string) => invoke<void>('git_discard_file', { id, path }),
  gitCommit: (id: ServiceId, message: string, amend = false) =>
    invoke<void>('git_commit', { id, message, amend }),
  gitPush: (id: ServiceId, forceWithLease = false) =>
    invoke<void>('git_push', { id, forceWithLease }),
  gitLog: (id: ServiceId, branch?: string | null, limit = 200) =>
    invoke<CommitSummary[]>('git_log', {
      id,
      branch: branch ?? null,
      limit,
    }),
  gitShowCommit: (id: ServiceId, hash: string) =>
    invoke<DiffSummary>('git_show_commit', { id, hash }),
  gitDiffCommitFile: (id: ServiceId, hash: string, file: string, context?: number) =>
    invoke<string>('git_diff_commit_file', { id, hash, file, context }),

  // ---- AI providers ------------------------------------------------------

  listAiProviders: () => invoke<AiProvider[]>('list_ai_providers'),
  upsertAiProvider: (input: AiProviderInput) => invoke<AiProvider>('upsert_ai_provider', { input }),
  removeAiProvider: (id: string) => invoke<boolean>('remove_ai_provider', { id }),
  setDefaultAiProvider: (id: string) => invoke<boolean>('set_default_ai_provider', { id }),
  testAiProvider: (id: string) => invoke<AiTestResult>('test_ai_provider', { id }),
  aiChatCompletion: (input: {
    provider_id?: string | null;
    messages: ChatMessage[];
    options?: ChatOptions;
  }) => invoke<ChatResponse>('ai_chat_completion', { input }),
  aiGenerateCommitMessage: (input: {
    service_id: ServiceId;
    provider_id?: string | null;
    hint?: string | null;
  }) => invoke<GenerateCommitResult>('ai_generate_commit_message', { input }),
  /**
   * Lightweight git context fetch for the AI Chat panel's commit
   * surface. Returns the staged diff (capped), recent commit subjects,
   * branch, and a truncation flag. The renderer uses this to seed a
   * commit-message conversation without round-tripping through the
   * dedicated `ai_generate_commit_message` endpoint — the user picks
   * a model in the panel, the assistant streams its draft, and the
   * action button below the answer fills the commit textarea via a
   * `runhq:ai-action:use-as-commit` event.
   */
  aiCommitChatContext: (input: { service_id: ServiceId }) =>
    invoke<{
      branch: string | null;
      diff: string;
      recent_subjects: string[];
      diff_truncated: boolean;
    }>('ai_commit_chat_context', { input }),

  // ---- AI streaming surfaces --------------------------------------------
  //
  // Each streaming command takes a `Channel<StreamChunk>` so the UI can
  // render token-by-token as the model produces output. Callers pass an
  // `onChunk` handler; we wrap it in a `Channel` and forward. The promise
  // resolves once the backend command exits — by which time the channel
  // has emitted a terminal `done` (or `error`) chunk, so callers don't
  // need to await both.
  aiChatCompletionStream: (
    input: {
      provider_id?: string | null;
      messages: ChatMessage[];
      options?: ChatOptions;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_chat_completion_stream', { input, onChunk: channel });
  },

  aiExplainDiff: (
    input: {
      diff: string;
      file_path?: string | null;
      selection_only?: boolean;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_explain_diff', { input, onChunk: channel });
  },

  aiExplainLog: (
    input: {
      line: string;
      context_lines?: string[];
      runtime?: string | null;
      service_name?: string | null;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_explain_log', { input, onChunk: channel });
  },

  aiPolishStandup: (
    input: {
      raw_markdown: string;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_polish_standup', { input, onChunk: channel });
  },

  aiTriageAdvisories: (
    input: {
      advisories: {
        id: string | null;
        package: string;
        severity: string;
        title: string;
        vulnerable_range: string | null;
        fix_version: string | null;
      }[];
      project_name?: string | null;
      runtime?: string | null;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_triage_advisories', { input, onChunk: channel });
  },

  aiCountTokens: async (texts: string[]): Promise<number> => {
    const out = await invoke<{ tokens: number }>('ai_count_tokens', {
      input: { texts },
    });
    return out.tokens;
  },

  aiAnalyzeWorkspace: (
    input: {
      facts: Record<string, unknown>;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_analyze_workspace', { input, onChunk: channel });
  },

  aiExplainProjectState: (
    input: {
      headline: string;
      facts: Record<string, unknown>;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => {
    const channel = new Channel<StreamChunk>();
    channel.onmessage = onChunk;
    return invoke<void>('ai_explain_project_state', { input, onChunk: channel });
  },
};

export const events = {
  onStatus: (handler: (status: ServiceStatus) => void): Promise<UnlistenFn> =>
    listen<ServiceStatus>('service://status', (e) => handler(e.payload)),
  onLog: (handler: (ev: LogEvent) => void): Promise<UnlistenFn> =>
    listen<LogEvent>('service://log', (e) => handler(e.payload)),
  onResources: (handler: (ev: ResourceEvent) => void): Promise<UnlistenFn> =>
    listen<ResourceEvent>('service://resources', (e) => handler(e.payload)),
};
