import type {
  DetectedEditor,
  GitStatus,
  ListeningPort,
  LogLine,
  ResourceSample,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
} from '@/types';

export interface LogBuffer {
  lines: LogLine[];
  lastSeq: number;
}

export interface WorkspaceStoreSlice {
  services: ServiceDef[];
  /**
   * Whether the very first `listServices` IPC has resolved. Starts
   * `false` and flips to `true` once App.tsx has hydrated the roster
   * — even if the result was an empty array. The dashboard uses this
   * to render a skeleton instead of either a) a confusingly empty
   * frame, or b) the "no services yet" onboarding card (which would
   * flash for 200-400ms during a normal cold start where services
   * *do* exist but haven't arrived from Rust yet).
   *
   * We deliberately don't model this as a "loading: true|false"
   * — the frontend is `false`-on-load forever after the initial
   * hydration; subsequent service add/remove operations are
   * optimistic and don't need to flicker the skeleton back on.
   */
  servicesLoaded: boolean;
  statuses: Record<ServiceId, ServiceStatus>;
  logs: Record<string, LogBuffer>;
  ports: ListeningPort[];
  editors: DetectedEditor[];
  /**
   * Per-service git snapshot. `null` means "checked, not a repo"; `undefined`
   * means "not yet loaded" so the UI can show a loading shimmer before the
   * first poll returns.
   */
  git: Record<ServiceId, GitStatus | null>;
  /** Most recent CPU + memory sample per running service (2s cadence from Rust). */
  resources: Record<ServiceId, ResourceSample>;
  /** Rolling CPU% history per service for sparklines — bounded to [`RESOURCE_HISTORY_MAX`]. */
  resourceHistory: Record<ServiceId, number[]>;
  appVersion: string | null;
  stateDir: string | null;

  editorService: ServiceDef | null | undefined;
  stacks: StackDef[];
  editorStack: StackDef | null | undefined;

  setServices: (services: ServiceDef[]) => void;
  upsertService: (svc: ServiceDef) => void;
  removeService: (id: ServiceId) => void;
  setStatus: (status: ServiceStatus) => void;
  appendLog: (key: string, line: LogLine) => void;
  replaceLogs: (key: string, lines: LogLine[]) => void;
  clearLogs: (key: string) => void;
  setPorts: (ports: ListeningPort[]) => void;
  setEditors: (editors: DetectedEditor[]) => void;
  setGit: (id: ServiceId, status: GitStatus | null) => void;
  setResources: (id: ServiceId, sample: ResourceSample) => void;
  setAppMeta: (version: string, stateDir: string) => void;

  openEditor: (service: ServiceDef | null) => void;
  closeEditor: () => void;
  setStacks: (stacks: StackDef[]) => void;
  upsertStack: (stack: StackDef) => void;
  removeStack: (id: string) => void;
  openStackEditor: (stack: StackDef | null) => void;
  closeStackEditor: () => void;
}
