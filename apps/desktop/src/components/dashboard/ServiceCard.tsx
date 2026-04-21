import { useState } from 'react';
import { FolderOpen, Globe, Pencil, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EditorDropdown } from '@/components/EditorDropdown';
import { ResourceBadge } from '@/components/ResourceBadge';
import { Sparkline } from '@/components/Sparkline';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta } from '@/lib/runtimes';
import type { ServiceDef, Status } from '@/types';

function CardAction({
  title,
  onClick,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: 'accent';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'accent'
      ? 'hover:bg-accent/10 hover:text-accent'
      : 'hover:bg-surface-muted hover:text-fg';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'text-fg-dim flex h-7 w-7 items-center justify-center rounded-md transition',
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

export function ServiceCard({
  svc,
  draggable: cardDraggable,
}: {
  svc: ServiceDef;
  draggable?: boolean;
}) {
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const statuses = useAppStore((s) => s.statuses);
  const setSelected = useAppStore((s) => s.setSelected);
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const logs = useAppStore((s) => s.logs);
  const resourceSample = useAppStore((s) => s.resources[svc.id]);
  const resourceHistory = useAppStore((s) => s.resourceHistory[svc.id]);
  const st: Status = statuses[svc.id]?.status ?? 'stopped';
  const isRunning = st === 'running' || st === 'starting';
  const logLines =
    svc.cmds.length > 0 ? (logs[logKey(svc.id, svc.cmds[0]!.name)]?.lines ?? []) : [];
  const tail = logLines.slice(-3);

  const runtimeKey = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds);
  const runtime = runtimeKey ? runtimeMeta(runtimeKey) : null;

  return (
    <div
      draggable={cardDraggable}
      onDragStart={(e) => {
        if (!cardDraggable) return;
        e.dataTransfer.setData('application/x-service-id', svc.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      role="button"
      tabIndex={0}
      onClick={() => setSelected(svc.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setSelected(svc.id);
        }
      }}
      className={cn(
        'group/card glass relative flex flex-col gap-3 p-4 text-left transition-all duration-200',
        'hover:border-border-strong hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.25)]',
        isRunning && 'border-accent/35 shadow-[0_0_0_1px_rgb(var(--accent)/0.12)]',
      )}
    >
      {isRunning && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgb(var(--accent) / 0.4), transparent)',
          }}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={st} size="md" />
          <span className="text-fg truncate text-[13px] font-semibold">{svc.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {runtime && (
            <span
              className={cn(
                'rounded-app-sm px-1.5 py-0.5 text-[10px] font-semibold',
                runtime.bg,
                runtime.color,
              )}
            >
              {runtime.label}
            </span>
          )}
          {svc.port != null && (
            <span className="bg-accent/10 text-accent rounded-app-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              :{svc.port}
            </span>
          )}
        </div>
      </div>

      <div className="text-fg-muted min-h-[18px] truncate font-mono text-[11px]">
        {svc.cmds.length === 1
          ? svc.cmds[0]?.cmd
          : `${svc.cmds.length} commands · ${svc.cmds.map((c) => c.name).join(', ')}`}
      </div>

      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <button
            type="button"
            title="Stop"
            onClick={() => void ipc.stopService(svc.id)}
            className="bg-status-error/10 text-status-error hover:bg-status-error/20 border-status-error/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
          >
            <Square className="h-3 w-3" fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            title="Start"
            onClick={() => void ipc.startService(svc.id)}
            className="bg-status-running/10 text-status-running hover:bg-status-running/20 border-status-running/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
          >
            <Play className="h-3 w-3" fill="currentColor" />
            Start
          </button>
        )}
        <CardAction title="Restart" onClick={() => void ipc.restartService(svc.id)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="Edit" onClick={() => openEditor(svc)}>
          <Pencil className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction
          title="Delete"
          onClick={() => {
            setPendingConfirm({
              message: `Delete "${svc.name}"?`,
              onConfirm: async () => {
                setPendingConfirm(null);
                await ipc.stopService(svc.id).catch(() => undefined);
                await ipc.removeService(svc.id);
                removeServiceLocal(svc.id);
              },
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="Open folder" onClick={() => void ipc.openPath(svc.cwd)}>
          <FolderOpen className="h-3.5 w-3.5" />
        </CardAction>
        {svc.port != null && (
          <CardAction
            title={`Open ${localUrl(svc.port!)}`}
            onClick={() => void ipc.openUrl(localUrl(svc.port!))}
            tone="accent"
          >
            <Globe className="h-3.5 w-3.5" />
          </CardAction>
        )}
        <div className="ml-auto">
          <EditorDropdown cwd={svc.cwd} cmds={svc.cmds} size="xs" />
        </div>
      </div>

      {isRunning && (
        <div className="border-border/60 -mx-1 flex items-center justify-between gap-2 border-t pt-2">
          <ResourceBadge sample={resourceSample} />
          <Sparkline data={resourceHistory} width={100} height={24} />
        </div>
      )}

      {tail.length > 0 && (
        <div className="relative -mx-1 mt-1 -mb-1 overflow-hidden rounded-md bg-[rgb(var(--surface)/0.5)] px-3 pt-2 pb-1 font-mono">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-[rgb(var(--surface-raised)/0.9)] to-transparent"
          />
          {tail.map((line, i) => (
            <div
              key={i}
              className={cn(
                'truncate text-[11px] leading-[16px]',
                i === tail.length - 1 ? 'text-fg-muted' : 'text-fg-dim',
                line.stream === 'stderr' && 'text-status-error/70',
              )}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
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
