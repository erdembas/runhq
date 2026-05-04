import { useEffect, useMemo } from 'react';
import { ipc } from '@/lib/ipc';
import { logKey, useAppStore } from '@/store/useAppStore';
import type { LogLine, ServiceDef } from '@/types';
import { EMPTY_LOGS } from './model';

export type LogsByCommand = Record<string, LogLine[]>;

export function useServiceCommandNames(service: ServiceDef | null): string[] {
  return useMemo(() => service?.cmds.map((command) => command.name) ?? [], [service]);
}

export function useActiveServiceCommand(
  service: ServiceDef | null,
  activeLogCommand: string | null,
): string | null {
  return useMemo(() => {
    if (!service) return null;
    if (activeLogCommand && service.cmds.some((command) => command.name === activeLogCommand)) {
      return activeLogCommand;
    }
    return service.cmds[0]?.name ?? null;
  }, [service, activeLogCommand]);
}

export function useCommandLogs(serviceId: string, commandNames: string[]): LogsByCommand {
  const logsStore = useAppStore((s) => s.logs);
  const replaceLogs = useAppStore((s) => s.replaceLogs);
  const commandKey = useMemo(() => commandNames.join('\x1f'), [commandNames]);

  useEffect(() => {
    if (!serviceId || commandNames.length === 0) return;
    let alive = true;
    for (const commandName of commandNames) {
      const key = logKey(serviceId, commandName);
      void ipc
        .getLogs(key, 0)
        .then((lines) => {
          if (alive) replaceLogs(key, lines);
        })
        .catch((err) => {
          console.error('get_logs failed', err);
        });
    }
    return () => {
      alive = false;
    };
  }, [serviceId, commandKey, commandNames, replaceLogs]);

  return useMemo(() => {
    const next: LogsByCommand = {};
    for (const commandName of commandNames) {
      next[commandName] = logsStore[logKey(serviceId, commandName)]?.lines ?? EMPTY_LOGS;
    }
    return next;
  }, [commandNames, logsStore, serviceId]);
}
