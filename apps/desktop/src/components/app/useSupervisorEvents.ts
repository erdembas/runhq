import { useCallback, useEffect, useRef } from 'react';
import { events, ipc } from '@/lib/ipc';
import { logKey, useAppStore } from '@/store/useAppStore';

type Lifecycle = 'started' | 'stopped' | 'crashed';

const LIFECYCLE_DEDUP_MS = 1500;

function toLifecycle(status: string): Lifecycle | null {
  if (status === 'running') return 'started';
  if (status === 'exited' || status === 'stopped') return 'stopped';
  if (status === 'crashed') return 'crashed';
  return null;
}

export function useSupervisorEvents() {
  const setStatus = useAppStore((s) => s.setStatus);
  const appendLog = useAppStore((s) => s.appendLog);
  const setResources = useAppStore((s) => s.setResources);
  const lastLifecycleRef = useRef<Record<string, Lifecycle>>({});
  const lastLifecycleTsRef = useRef<Record<string, number>>({});
  const runIdsRef = useRef<Record<string, string>>({});

  const makeRunId = useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const register = (unlisten: () => void) => {
      if (cancelled) unlisten();
      else unsubs.push(unlisten);
    };

    (async () => {
      register(
        await events.onStatus((status) => {
          setStatus(status);
          const lifecycle = toLifecycle(status.status);
          if (!lifecycle) return;

          const prev = lastLifecycleRef.current[status.id];
          if (prev === lifecycle) return;
          if (prev === undefined && lifecycle !== 'started') {
            lastLifecycleRef.current[status.id] = lifecycle;
            lastLifecycleTsRef.current[status.id] = Date.now();
            return;
          }

          const nowMs = Date.now();
          const lastTs = lastLifecycleTsRef.current[status.id];
          if (
            prev === undefined &&
            lifecycle === 'started' &&
            lastTs != null &&
            nowMs - lastTs < LIFECYCLE_DEDUP_MS
          ) {
            lastLifecycleRef.current[status.id] = lifecycle;
            lastLifecycleTsRef.current[status.id] = nowMs;
            return;
          }

          lastLifecycleRef.current[status.id] = lifecycle;
          lastLifecycleTsRef.current[status.id] = nowMs;

          const runId = lifecycle === 'started' && status.run_id ? status.run_id : makeRunId();
          runIdsRef.current[status.id] = runId;
          const service = useAppStore.getState().services.find((s) => s.id === status.id);
          const name = service?.name ?? status.id;
          const commands = status.commands ?? [];
          let description = '';
          let eventType: 'service_started' | 'service_stopped' | 'service_crashed';

          if (lifecycle === 'started') {
            eventType = 'service_started';
            const running = commands.filter((c) => c.status === 'running').map((c) => c.name);
            const names = running.length > 0 ? running : commands.map((c) => c.name);
            description =
              names.length > 0 ? `Started ${name} — ${names.join(', ')}` : `Started ${name}`;
          } else if (lifecycle === 'stopped') {
            eventType = 'service_stopped';
            const parts = commands.map((command) => {
              const code = command.exit_code != null ? ` (${command.exit_code})` : '';
              return `${command.name}${code}`;
            });
            description =
              parts.length > 0 ? `Stopped ${name} — ${parts.join(', ')}` : `Stopped ${name}`;
          } else {
            eventType = 'service_crashed';
            const failed = commands
              .filter((command) => command.status === 'crashed' || command.error)
              .map((command) => {
                const err = command.error ? `: ${command.error}` : '';
                return `${command.name}${err}`;
              });
            description =
              failed.length > 0 ? `Crashed ${name} — ${failed.join('; ')}` : `Crashed ${name}`;
          }

          ipc
            .recordTimelineEvent(eventType, status.id, service?.name ?? null, description, runId)
            .catch(() => {});
        }),
      );
      register(
        await events.onLog((event) => {
          appendLog(logKey(event.service_id, event.cmd_name), event.line);
          if (event.line.stream !== 'stderr') return;

          const text = event.line.text.toLowerCase();
          const isWarning = text.includes('warn') || text.includes('warning');
          const isError =
            text.includes('error') || text.includes('fatal') || text.includes('panic');
          if (!isError && !isWarning) return;

          const service = useAppStore.getState().services.find((s) => s.id === event.service_id);
          const runId = runIdsRef.current[event.service_id] ?? null;
          ipc
            .recordTimelineEvent(
              isError ? 'log_error' : 'log_warning',
              event.service_id,
              service?.name ?? null,
              event.line.text.slice(0, 1500),
              runId,
            )
            .catch(() => {});
        }),
      );
      register(
        await events.onResources((event) =>
          setResources(event.service_id, {
            cpu_percent: event.cpu_percent,
            memory_bytes: event.memory_bytes,
          }),
        ),
      );
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((unsub) => unsub());
    };
  }, [appendLog, makeRunId, setResources, setStatus]);
}
