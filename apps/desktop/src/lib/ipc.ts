import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppInfo,
  CommandEntry,
  DailySummary,
  DependencyScanResult,
  DetectedEditor,
  GitStatus,
  ListeningPort,
  LogEvent,
  LogLine,
  OverviewSummary,
  Prefs,
  ProjectCandidate,
  ResourceEvent,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
  StackStatus,
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

  terminalCreate: (id: string, cwd: string, cols: number, rows: number) =>
    invoke<void>('terminal_create', { id, cwd, cols, rows }),
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
  gitCheckout: (id: ServiceId, branch: string) => invoke<void>('git_checkout', { id, branch }),
  gitCreateBranch: (id: ServiceId, name: string) => invoke<void>('git_create_branch', { id, name }),
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
};

export const events = {
  onStatus: (handler: (status: ServiceStatus) => void): Promise<UnlistenFn> =>
    listen<ServiceStatus>('service://status', (e) => handler(e.payload)),
  onLog: (handler: (ev: LogEvent) => void): Promise<UnlistenFn> =>
    listen<LogEvent>('service://log', (e) => handler(e.payload)),
  onResources: (handler: (ev: ResourceEvent) => void): Promise<UnlistenFn> =>
    listen<ResourceEvent>('service://resources', (e) => handler(e.payload)),
};
