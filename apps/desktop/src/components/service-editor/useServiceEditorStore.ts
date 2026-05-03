import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CommandEntry, ProjectCandidate, ServiceDef } from '@/types';
import {
  DEFAULT_GRACE_MS,
  inferPmFromCmds,
  rewritePmInCmd,
  type EnvRow,
  type NodePackageManager,
} from './types';

export type TabKey = 'general' | 'env' | 'advanced';

let cmdUid = 0;
const nextUid = () => `cmd-${++cmdUid}`;

export interface CmdRow extends CommandEntry {
  uid: string;
}

interface ServiceEditorState {
  tab: TabKey;
  name: string;
  cwd: string;
  cmds: CmdRow[];
  port: string;
  tags: string[];
  tagDraft: string;
  envRows: EnvRow[];
  graceMs: string;
  pathOverride: string;
  preCommand: string;
  autoStart: boolean;
  hideDashboard: boolean;
  saving: boolean;
  error: string | null;
  detected: ProjectCandidate | null;
  detecting: boolean;
  selectedPm: NodePackageManager;
}

type ServiceEditorPatch =
  | Partial<ServiceEditorState>
  | ((state: ServiceEditorStore) => Partial<ServiceEditorState>);

interface ServiceEditorActions {
  patch: (patch: ServiceEditorPatch) => void;
  addCmd: () => void;
  removeCmd: (index: number) => void;
  updateCmd: (index: number, patch: Partial<CommandEntry>) => void;
  moveCmd: (from: number, to: number) => void;
  addSuggestionAsCmd: (suggestion: { label: string; cmd: string }) => void;
  addTag: (value: string) => void;
  removeTag: (tag: string) => void;
  rewritePackageManagerCommands: (pm: NodePackageManager) => void;
}

export type ServiceEditorStore = ServiceEditorState & ServiceEditorActions;
export type ServiceEditorStoreApi = StoreApi<ServiceEditorStore>;

function commandRows(service: ServiceDef | null): CmdRow[] {
  if (!service?.cmds?.length) return [];
  return service.cmds.map((cmd) => ({ ...cmd, uid: nextUid() }));
}

export function createServiceEditorStore(service: ServiceDef | null): ServiceEditorStoreApi {
  return createStore<ServiceEditorStore>((set) => ({
    tab: 'general',
    name: service?.name ?? '',
    cwd: service?.cwd ?? '',
    cmds: commandRows(service),
    port: service?.port?.toString() ?? '',
    tags: service?.tags ?? [],
    tagDraft: '',
    envRows: service?.env.map(([key, value]) => ({ key, value })) ?? [],
    graceMs: service?.grace_ms?.toString() ?? String(DEFAULT_GRACE_MS),
    pathOverride: service?.path_override ?? '',
    preCommand: service?.pre_command ?? '',
    autoStart: service?.auto_start ?? false,
    hideDashboard: service?.hide_dashboard ?? false,
    saving: false,
    error: null,
    detected: null,
    detecting: false,
    selectedPm: inferPmFromCmds(service?.cmds ?? []),

    patch: (patch) => set((state) => (typeof patch === 'function' ? patch(state) : patch)),

    addCmd: () =>
      set((state) => {
        const idx = state.cmds.length + 1;
        return { cmds: [...state.cmds, { name: `cmd-${idx}`, cmd: '', uid: nextUid() }] };
      }),
    removeCmd: (index) =>
      set((state) => ({
        cmds: state.cmds.filter((_, idx) => idx !== index),
      })),
    updateCmd: (index, patch) =>
      set((state) => ({
        cmds: state.cmds.map((cmd, idx) => (idx === index ? { ...cmd, ...patch } : cmd)),
      })),
    moveCmd: (from, to) =>
      set((state) => {
        const cmds = [...state.cmds];
        const [moved] = cmds.splice(from, 1);
        if (!moved) return state;
        cmds.splice(to, 0, moved);
        return { cmds };
      }),
    addSuggestionAsCmd: (suggestion) =>
      set((state) => {
        const existing = state.cmds.findIndex((cmd) => cmd.name === suggestion.label);
        const cmds =
          existing >= 0
            ? state.cmds.map((cmd, idx) =>
                idx === existing ? { ...cmd, cmd: suggestion.cmd } : cmd,
              )
            : [...state.cmds, { name: suggestion.label, cmd: suggestion.cmd, uid: nextUid() }];
        const shouldTagFrontend =
          state.tags.length === 0 &&
          state.detected?.runtime === 'node' &&
          /dev|start|serve/.test(suggestion.label.toLowerCase());

        return {
          cmds,
          tags: shouldTagFrontend ? ['frontend'] : state.tags,
        };
      }),
    addTag: (value) => {
      const cleaned = value.trim().toLowerCase();
      if (!cleaned) return;
      set((state) => {
        if (state.tags.includes(cleaned)) return state;
        return { tags: [...state.tags, cleaned], tagDraft: '' };
      });
    },
    removeTag: (tag) =>
      set((state) => ({
        tags: state.tags.filter((item) => item !== tag),
      })),
    rewritePackageManagerCommands: (pm) =>
      set((state) => {
        const hasPmCmd = (cmd: string) => /\b(npm|yarn|pnpm|bun)\b/.test(cmd);
        if (!state.cmds.some((cmd) => hasPmCmd(cmd.cmd))) return state;
        return {
          cmds: state.cmds.map((cmd) =>
            hasPmCmd(cmd.cmd) ? { ...cmd, cmd: rewritePmInCmd(cmd.cmd, pm) } : cmd,
          ),
        };
      }),
  }));
}

export function useServiceEditorStoreRef(service: ServiceDef | null): ServiceEditorStoreApi {
  const storeRef = useRef<ServiceEditorStoreApi>();
  if (!storeRef.current) {
    storeRef.current = createServiceEditorStore(service);
  }
  return storeRef.current;
}

export function useServiceEditorStore<T>(
  store: ServiceEditorStoreApi,
  selector: (state: ServiceEditorStore) => T,
): T {
  return useStore(store, selector);
}
