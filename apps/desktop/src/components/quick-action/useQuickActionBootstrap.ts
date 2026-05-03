import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ipc } from '@/lib/ipc';
import type { CommandStatus, DetectedEditor, ServiceDef, ServiceId, StackDef } from '@/types';
import { fetchServices, fetchStatus } from './hooks';

interface QuickActionBootstrapArgs {
  inputRef: React.RefObject<HTMLInputElement | null>;
  services: ServiceDef[];
  setServices: React.Dispatch<React.SetStateAction<ServiceDef[]>>;
  setStacks: React.Dispatch<React.SetStateAction<StackDef[]>>;
  setEditors: React.Dispatch<React.SetStateAction<DetectedEditor[]>>;
  setCmdStatuses: React.Dispatch<React.SetStateAction<Record<ServiceId, CommandStatus[]>>>;
}

export function useQuickActionBootstrap({
  inputRef,
  services,
  setServices,
  setStacks,
  setEditors,
  setCmdStatuses,
}: QuickActionBootstrapArgs) {
  useEffect(() => {
    inputRef.current?.focus();
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) inputRef.current?.focus();
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [inputRef]);

  useEffect(() => {
    fetchServices()
      .then(setServices)
      .catch(() => {});
    ipc
      .listStacks()
      .then(setStacks)
      .catch(() => {});
    ipc
      .detectEditors()
      .then(setEditors)
      .catch(() => {});
  }, [setEditors, setServices, setStacks]);

  useEffect(() => {
    Promise.all(
      services.map(async (svc) => {
        try {
          return [svc.id, (await fetchStatus(svc.id)) as CommandStatus[]] as const;
        } catch {
          return [svc.id, [] as CommandStatus[]] as const;
        }
      }),
    ).then((entries) => {
      const map: Record<string, CommandStatus[]> = {};
      for (const [id, cmds] of entries) map[id] = cmds;
      setCmdStatuses(map);
    });
  }, [services, setCmdStatuses]);
}
