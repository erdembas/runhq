import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EditorDropdown } from '@/components/EditorDropdown';
import { IconButton } from '@/components/ui/IconButton';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import type { LogLine, ServiceDef, Status } from '@/types';

type Tab = 'services' | 'logs';

interface StackDetailProps {
  /**
   * The stack this detail view renders. Passed in by the tabbed
   * main-area host so multiple StackDetail instances can stay
   * mounted (one per open stack tab) without colliding on a single
   * `selectedStackId` from the store. Reading the id from the
   * store would force every mounted instance to render the same
   * stack — defeating the per-tab state preservation the tab
   * system is designed for.
   */
  stackId: string;
}

export function StackDetail({ stackId }: StackDetailProps) {
  const stacks = useAppStore((s) => s.stacks);
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const logs = useAppStore((s) => s.logs);
  const setSelected = useAppStore((s) => s.setSelected);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const removeStack = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);

  const [tab, setTab] = useState<Tab>('services');
  const [logFocus, setLogFocus] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const stack = stacks.find((s) => s.id === stackId) ?? null;

  const stackServices = useMemo(
    () =>
      stack
        ? (stack.service_ids
            .map((sid) => services.find((s) => s.id === sid))
            .filter(Boolean) as ServiceDef[])
        : [],
    [stack, services],
  );

  const perServiceLogs = useMemo(() => {
    const map = new Map<string, LogLine[]>();
    for (const svc of stackServices) {
      const lines: LogLine[] = [];
      for (const cmd of svc.cmds) {
        const buf = logs[logKey(svc.id, cmd.name)];
        if (buf) lines.push(...buf.lines);
      }
      lines.sort((a, b) => a.seq - b.seq);
      map.set(svc.id, lines.slice(-200));
    }
    return map;
  }, [stackServices, logs]);

  const runningCount = stackServices.filter(
    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
  ).length;
  const failedCount = stackServices.filter(
    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'crashed',
  ).length;
  const anyRunning = runningCount > 0;
  const allRunning = stackServices.length > 0 && runningCount === stackServices.length;

  if (!stack) return null;

  return (
    <div className="bg-surface flex flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-8 py-8">
        <div>
          <button
            type="button"
            onClick={() => setSelectedStack(null)}
            className="text-fg-dim hover:text-fg mb-3 flex items-center gap-1.5 text-[12px] font-medium transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="bg-accent/10 border-accent/30 rounded-app-lg flex h-10 w-10 items-center justify-center border">
                  <Layers className="text-accent h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-fg text-xl font-bold">{stack.name}</h1>
                  <div className="text-fg-muted mt-0.5 flex items-center gap-2 text-[13px]">
                    {stackServices.length} service{stackServices.length !== 1 ? 's' : ''}
                    {runningCount > 0 && (
                      <>
                        <span className="text-fg-dim">·</span>
                        <span className="text-status-running">{runningCount} running</span>
                      </>
                    )}
                    {failedCount > 0 && (
                      <>
                        <span className="text-fg-dim">·</span>
                        <span className="text-status-error">{failedCount} failed</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {anyRunning ? (
                <IconButton
                  label="Stop all"
                  icon={<Square className="h-4 w-4" />}
                  size="md"
                  onClick={() => void ipc.stopStack(stack.id)}
                />
              ) : (
                <IconButton
                  label="Start all"
                  icon={<Play className="h-4 w-4" />}
                  size="md"
                  onClick={() => void ipc.startStack(stack.id)}
                />
              )}
              <IconButton
                label="Restart all"
                icon={<RotateCcw className="h-4 w-4" />}
                size="md"
                onClick={() => void ipc.restartStack(stack.id)}
              />
              <IconButton
                label="Edit stack"
                icon={<Pencil className="h-4 w-4" />}
                size="md"
                onClick={() => openStackEditor(stack)}
              />
              <IconButton
                label="Delete stack"
                icon={<Trash2 className="h-4 w-4" />}
                size="md"
                tone="danger"
                onClick={() => {
                  setPendingConfirm({
                    message: `Delete stack "${stack.name}"?`,
                    onConfirm: async () => {
                      setPendingConfirm(null);
                      await ipc.removeStack(stack.id);
                      removeStack(stack.id);
                      setSelectedStack(null);
                    },
                  });
                }}
              />
            </div>
          </div>
        </div>

        <div className="glass overflow-hidden p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              Stack Health
            </span>
            <span className="text-fg text-[13px] font-semibold tabular-nums">
              {runningCount}/{stackServices.length}
            </span>
          </div>
          <div className="bg-surface-muted h-2 w-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-700',
                allRunning ? 'from-accent to-status-running bg-gradient-to-r' : 'bg-accent',
              )}
              style={{
                width: `${stackServices.length > 0 ? (runningCount / stackServices.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="border-border/30 flex items-center gap-1 border-b pb-1">
          <button
            type="button"
            onClick={() => setTab('services')}
            className={cn(
              'px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase transition',
              tab === 'services'
                ? 'text-accent border-accent border-b-2'
                : 'text-fg-dim hover:text-fg',
            )}
          >
            Services
          </button>
          <button
            type="button"
            onClick={() => setTab('logs')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase transition',
              tab === 'logs' ? 'text-accent border-accent border-b-2' : 'text-fg-dim hover:text-fg',
            )}
          >
            <FileText className="h-3 w-3" />
            Logs
          </button>
        </div>

        {tab === 'services' && (
          <div className="flex flex-col gap-2">
            {stackServices.map((svc) => {
              const st: Status = statuses[svc.id]?.status ?? 'stopped';
              const isRunning = st === 'running' || st === 'starting';
              const cmdSummary =
                svc.cmds.length === 1 ? svc.cmds[0]?.cmd : `${svc.cmds.length} commands`;
              return (
                <div
                  key={svc.id}
                  className={cn(
                    'glass gradient-border group flex items-center gap-3 p-3 transition hover:shadow-lg',
                    isRunning && 'hover:shadow-accent/5',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(svc.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <StatusDot status={st} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-fg text-[13px] font-semibold">{svc.name}</span>
                        <StatusPill status={st} />
                      </div>
                      <div className="text-fg-dim mt-0.5 truncate text-[11px]">{cmdSummary}</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5">
                    {svc.port != null && (
                      <span className="bg-accent/10 text-accent rounded-app-sm px-1.5 py-0.5 text-[11px] font-semibold">
                        :{svc.port}
                      </span>
                    )}
                    {isRunning ? (
                      <IconButton
                        label="Stop"
                        icon={<Square />}
                        size="xs"
                        onClick={() => void ipc.stopService(svc.id)}
                      />
                    ) : (
                      <IconButton
                        label="Start"
                        icon={<Play />}
                        size="xs"
                        onClick={() => void ipc.startService(svc.id)}
                      />
                    )}
                    <IconButton
                      label="Restart"
                      icon={<RotateCcw />}
                      size="xs"
                      onClick={() => void ipc.restartService(svc.id)}
                    />
                    <button
                      type="button"
                      title="Open folder"
                      onClick={() => void ipc.openPath(svc.cwd)}
                      className="text-fg-dim hover:bg-accent/10 hover:text-fg flex h-6 w-6 items-center justify-center transition"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    {svc.port != null && (
                      <button
                        type="button"
                        title={`Open ${localUrl(svc.port!)}`}
                        onClick={() => void ipc.openUrl(localUrl(svc.port!))}
                        className="text-fg-dim hover:bg-accent/10 hover:text-accent flex h-6 w-6 items-center justify-center transition"
                      >
                        <Globe className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <EditorDropdown cwd={svc.cwd} cmds={svc.cmds} size="xs" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'logs' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 overflow-x-auto">
              {stackServices.map((svc) => {
                const svcLines = perServiceLogs.get(svc.id)?.length ?? 0;
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => setLogFocus(logFocus === svc.id ? null : svc.id)}
                    className={cn(
                      'rounded-app-sm shrink-0 px-2.5 py-0.5 text-[10px] font-medium transition',
                      logFocus === svc.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-fg-dim hover:bg-surface-muted hover:text-fg',
                    )}
                  >
                    {svc.name}
                    <span className="ml-1 opacity-60">{svcLines}</span>
                  </button>
                );
              })}
            </div>

            {(logFocus
              ? [stackServices.find((s) => s.id === logFocus)!].filter(Boolean)
              : stackServices
            ).map((svc) => {
              const svcLines = perServiceLogs.get(svc.id) ?? [];
              const st: Status = statuses[svc.id]?.status ?? 'stopped';
              return (
                <div key={svc.id} className="glass flex flex-col overflow-hidden">
                  <div className="border-border/20 flex items-center gap-2 border-b px-4 py-1.5">
                    <StatusDot status={st} size="sm" />
                    <span className="text-fg text-[11px] font-semibold">{svc.name}</span>
                    <span className="text-fg-dim ml-auto text-[10px]">{svcLines.length} lines</span>
                  </div>
                  {svcLines.length === 0 ? (
                    <div className="text-fg-dim px-4 py-3 text-[11px]">No output</div>
                  ) : (
                    <div
                      className={cn(
                        'overflow-y-auto px-4 py-2 font-mono text-[11px] leading-[17px]',
                        logFocus ? 'max-h-[400px]' : 'max-h-[140px]',
                      )}
                    >
                      {svcLines.map((line, idx) => (
                        <div
                          key={`${line.seq}-${idx}`}
                          className={cn(
                            line.stream === 'stderr' && 'text-status-error/80',
                            line.stream === 'system' && 'text-accent italic',
                          )}
                        >
                          <span className="text-fg-dim">{line.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
