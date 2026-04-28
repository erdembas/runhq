import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { categoryForTags } from '@/lib/categories';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta } from '@/lib/runtimes';
import { STATUS_DOT, STATUS_LABEL } from './constants';
import { isRunning, type ListItem } from './types';
import type { ServiceId } from '@/types';

export interface RenderRowDeps {
  cursor: number;
  execute: (item: ListItem) => Promise<void>;
  setCursor: (i: number) => void;
  setExpandedId: (id: string | null) => void;
  refreshStatus: (id: ServiceId) => Promise<void>;
}

export function renderRow(item: ListItem, i: number, deps: RenderRowDeps): React.ReactNode {
  const { cursor, execute, setCursor, setExpandedId, refreshStatus } = deps;
  const active = cursor === i;

  if (item.type === 'header') {
    return (
      <div key={`hdr-${item.label}-${i}`} className="qa-section-header">
        {item.label}
      </div>
    );
  }

  if (item.type === 'cmd-header') {
    return (
      <div key={`cmdhdr-${i}`} className="qa-section-header">
        Commands
      </div>
    );
  }

  if (item.type === 'app-action') {
    return (
      <div
        key={item.id}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span className="text-fg-muted bg-surface-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
          {item.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-fg text-[12px] font-medium">{item.label}</div>
          <div className="text-fg-dim text-[10px]">{item.subtitle}</div>
        </div>
        <kbd className="text-fg-dim border-border bg-surface-muted shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]">
          {item.shortcut}
        </kbd>
      </div>
    );
  }

  if (item.type === 'service') {
    const anyRunning = item.cmds.some((c) => isRunning(c.status));
    const cat = categoryForTags(item.service.tags);
    const rt = runtimeFromTags(item.service.tags) ?? inferRuntimeFromCmds(item.service.cmds);
    const rtMeta = rt ? runtimeMeta(rt) : null;
    return (
      <div
        key={`svc-${item.service.id}`}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            STATUS_DOT[anyRunning ? 'running' : 'stopped'],
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg text-[12px] font-semibold">{item.service.name}</span>
            {rtMeta && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                  rtMeta.bg,
                  rtMeta.color,
                )}
              >
                {rtMeta.label}
              </span>
            )}
            <span className={cn('text-[9px] font-medium', cat.color)}>{cat.label}</span>
          </div>
          <div className="text-fg-dim flex items-center gap-2 text-[10px]">
            <span>{STATUS_LABEL[item.cmds[0]?.status ?? 'stopped']}</span>
            <span>·</span>
            <span>
              {item.cmds.length} cmd{item.cmds.length !== 1 ? 's' : ''}
            </span>
            {item.service.port != null && (
              <>
                <span>·</span>
                <span className="text-accent">:{item.service.port}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            title={anyRunning ? 'Stop' : 'Start'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition',
              anyRunning
                ? 'text-status-error/70 hover:bg-status-error/10 hover:text-status-error'
                : 'text-status-running/70 hover:bg-status-running/10 hover:text-status-running',
            )}
            onClick={async (e) => {
              e.stopPropagation();
              if (anyRunning) await ipc.stopService(item.service.id);
              else await ipc.startService(item.service.id);
              await refreshStatus(item.service.id);
            }}
          >
            {anyRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <ArrowRight className="text-fg-dim h-3 w-3" />
        </div>
      </div>
    );
  }

  if (item.type === 'expanded-header') {
    const anyRunning = item.cmds.some((c) => isRunning(c.status));
    const rt = runtimeFromTags(item.service.tags) ?? inferRuntimeFromCmds(item.service.cmds);
    const rtMeta = rt ? runtimeMeta(rt) : null;
    return (
      <div
        key={`exp-${item.service.id}`}
        data-active={active ? '' : undefined}
        className={cn(
          'border-border/20 flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => setExpandedId(null)}
        onMouseEnter={() => setCursor(i)}
      >
        <ChevronLeft className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            STATUS_DOT[anyRunning ? 'running' : 'stopped'],
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg text-[12px] font-semibold">{item.service.name}</span>
            {rtMeta && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                  rtMeta.bg,
                  rtMeta.color,
                )}
              >
                {rtMeta.label}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (item.type === 'sub-action') {
    // `nested` rows live under an expandable parent and need a deeper
    // indent + a faint left rule so the parent/child relationship is
    // obvious without forcing the eye to count whitespace.
    const padLeft = item.nested ? 'pl-14' : 'pl-10';
    return (
      <div
        key={`sub-${item.serviceId}-${item.label}-${i}`}
        data-active={active ? '' : undefined}
        className={cn(
          'relative flex cursor-pointer items-center gap-3 px-4 py-2 transition',
          padLeft,
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        {item.nested && (
          <span
            aria-hidden
            // Vertical guide line aligns with the parent's icon column
            // (pl-10 = 40px → ~46px to land just left of the badge).
            className="border-border/60 pointer-events-none absolute top-0 bottom-0 left-[46px] border-l"
          />
        )}
        <span className={cn('shrink-0', item.danger ? 'text-status-error/70' : 'text-fg-muted')}>
          {item.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn('text-[11px] font-medium', item.danger ? 'text-status-error' : 'text-fg')}
          >
            {item.label}
          </div>
          {item.subtitle && <div className="text-fg-dim truncate text-[9px]">{item.subtitle}</div>}
        </div>
        {item.expandable && (
          <span className="text-fg-dim shrink-0">
            {item.expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        )}
      </div>
    );
  }

  if (item.type === 'expanded-cmd') {
    return (
      <div
        key={`ecmd-${item.serviceId}-${item.cmd.name}`}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2 pl-10 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span
          className={cn(
            'shrink-0',
            isRunning(item.cmd.status) ? 'text-status-error/70' : 'text-status-running/70',
          )}
        >
          {isRunning(item.cmd.status) ? (
            <Square className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-[11px] font-medium',
              isRunning(item.cmd.status) ? 'text-status-error' : 'text-fg',
            )}
          >
            {item.cmd.name}
          </div>
          <div className="text-fg-dim truncate text-[9px]">{item.cmd.cmd}</div>
        </div>
      </div>
    );
  }

  if (item.type === 'cmd') {
    return (
      <div
        key={`cmd-${item.serviceId}-${item.cmdName}`}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            STATUS_DOT[item.status] ?? 'bg-surface-muted',
          )}
        />
        <div className="min-w-0 flex-1">
          <span className="text-fg text-[11px] font-medium">{item.cmdName}</span>
          <span className="text-fg-dim ml-2 text-[10px]">{item.serviceName}</span>
        </div>
        <span className="shrink-0">
          {isRunning(item.status) ? (
            <Square className="text-status-error h-3 w-3" />
          ) : (
            <Play className="text-status-running h-3 w-3" />
          )}
        </span>
      </div>
    );
  }

  if (item.type === 'stack') {
    return (
      <div
        key={`stack-${item.stack.id}`}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span className="text-fg-muted bg-accent/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
          <Layers className="text-accent h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-fg text-[12px] font-semibold">{item.stack.name}</div>
          <div className="text-fg-dim flex items-center gap-2 text-[10px]">
            <span>{item.stack.service_ids.length} services</span>
            {item.runningCount > 0 && (
              <>
                <span>·</span>
                <span className="text-status-running">{item.runningCount} running</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            title={item.runningCount > 0 ? 'Stop all' : 'Start all'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition',
              item.runningCount > 0
                ? 'text-status-error/70 hover:bg-status-error/10 hover:text-status-error'
                : 'text-status-running/70 hover:bg-status-running/10 hover:text-status-running',
            )}
            onClick={async (e) => {
              e.stopPropagation();
              if (item.runningCount > 0) await ipc.stopStack(item.stack.id);
              else await ipc.startStack(item.stack.id);
            }}
          >
            {item.runningCount > 0 ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <ArrowRight className="text-fg-dim h-3 w-3" />
        </div>
      </div>
    );
  }

  if (item.type === 'expanded-stack') {
    return (
      <div
        key={`exp-stack-${item.stack.id}`}
        data-active={active ? '' : undefined}
        className={cn(
          'border-border/20 flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => setExpandedId(null)}
        onMouseEnter={() => setCursor(i)}
      >
        <ChevronLeft className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        <span className="text-fg-muted bg-accent/10 flex h-6 w-6 shrink-0 items-center justify-center rounded">
          <Layers className="text-accent h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-fg text-[12px] font-semibold">{item.stack.name}</span>
        </div>
      </div>
    );
  }

  if (item.type === 'stack-action') {
    return (
      <div
        key={`sa-${item.stackId}-${item.label}-${i}`}
        data-active={active ? '' : undefined}
        className={cn(
          'flex cursor-pointer items-center gap-3 px-4 py-2 pl-10 transition',
          active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
        )}
        onClick={() => execute(item)}
        onMouseEnter={() => setCursor(i)}
      >
        <span className={cn('shrink-0', item.danger ? 'text-status-error/70' : 'text-fg-muted')}>
          {item.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn('text-[11px] font-medium', item.danger ? 'text-status-error' : 'text-fg')}
          >
            {item.label}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
