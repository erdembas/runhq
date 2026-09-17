import { useEffect, useMemo, useRef } from 'react';
import { ipc } from '@/lib/ipc';
import { logKey, useAppStore } from '@/store/useAppStore';
import type { LogLine, ServiceDef } from '@/types';
import { EMPTY_LOGS } from './model';

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

export function useCommandLogs(
  serviceId: string,
  commandName: string | null,
  visible: boolean,
): LogLine[] {
  const snapshot = useRef<LogLine[]>(EMPTY_LOGS);
  const logs = useAppStore((s) =>
    visible && commandName
      ? (s.logs[logKey(serviceId, commandName)]?.lines ?? EMPTY_LOGS)
      : snapshot.current,
  );
  snapshot.current = logs;
  return logs;
}

// Fetch once per service/command list. Streaming updates are consumed directly
// by visible command bodies so log traffic cannot rerender the entire panel.
export function useLoadCommandLogs(serviceId: string, commandNames: string[]): void {
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
}
