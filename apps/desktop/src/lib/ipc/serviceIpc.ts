import { invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  CommandEntry,
  DetectedEditor,
  ListeningPort,
  LogLine,
  Prefs,
  ProjectCandidate,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
  StackStatus,
} from '@/types';

export const serviceIpc = {
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
    hide_dashboard?: boolean;
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
  resizeServiceLogPty: (id: ServiceId, cmdName: string, cols: number, rows: number) =>
    invoke<void>('resize_service_log_pty', { id, cmdName, cols, rows }),

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

  showTrayHint: () => invoke<void>('show_tray_hint'),
  showQuickAction: () => invoke<void>('show_quick_action'),
  hideQuickAction: () => invoke<void>('hide_quick_action'),
  focusMainWindow: () => invoke<void>('focus_main_window'),
};
