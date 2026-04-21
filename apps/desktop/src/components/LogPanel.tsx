import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Eraser,
  ExternalLink,
  FolderOpen,
  Globe,
  GripHorizontal,
  Network,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { TagChip } from '@/components/ui/TagChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EditorDropdown } from '@/components/EditorDropdown';
import { GitStatusChip } from '@/components/GitStatusChip';
import { TerminalPane } from '@/components/TerminalPane';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import type { ListeningPort, LogLine } from '@/types';

type PopoverKey = 'ports';

const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'text-fg',
  stderr: 'text-status-error',
  system: 'text-accent italic',
};
const EMPTY_LOGS: LogLine[] = [];
const MIN_PANEL = 80;

/** Deterministically pick a badge color for a command name.
 *
 *  Light uses -700/-600 shades so the chip reads as a real colored pill on
 *  ivory; dark keeps the vivid -300 shades that sit nicely on charcoal. The
 *  previous base (-400/-500) was calibrated only for dark and bled into a
 *  near-grayscale blur against the white log surface. */
function badgeClass(name: string): string {
  const palette = [
    'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    'bg-lime-500/15 text-lime-700 dark:text-lime-300',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

export function LogPanel() {
  const selectedId = useAppStore((s) => s.selectedServiceId);
  const selectedCmdName = useAppStore((s) => s.selectedCmdName);
  const setSelectedCmd = useAppStore((s) => s.setSelectedCmd);
  const service = useAppStore((s) =>
    s.selectedServiceId ? (s.services.find((x) => x.id === s.selectedServiceId) ?? null) : null,
  );
  const status = useAppStore((s) =>
    s.selectedServiceId ? s.statuses[s.selectedServiceId] : undefined,
  );
  const ports = useAppStore((s) => s.ports);
  const replaceLogs = useAppStore((s) => s.replaceLogs);
  const clearLogsLocal = useAppStore((s) => s.clearLogs);
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);

  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [openPopover, setOpenPopover] = useState<PopoverKey | null>(null);
  const [splitY, setSplitY] = useState(() => Math.round(window.innerHeight * 0.55));
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeCmd = useMemo(() => {
    if (!service) return null;
    if (selectedCmdName && service.cmds.some((c) => c.name === selectedCmdName))
      return selectedCmdName;
    return service.cmds[0]?.name ?? null;
  }, [service, selectedCmdName]);

  const logK = activeCmd && selectedId ? logKey(selectedId, activeCmd) : '';
  const logs = useAppStore((s) => (logK ? (s.logs[logK]?.lines ?? EMPTY_LOGS) : EMPTY_LOGS));

  useEffect(() => {
    if (!selectedId || !activeCmd) return;
    let alive = true;
    const key = logKey(selectedId, activeCmd);
    (async () => {
      try {
        const lines = await ipc.getLogs(key, 0);
        if (alive) replaceLogs(key, lines);
      } catch (err) {
        console.error('get_logs failed', err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, activeCmd, replaceLogs]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return logs;
    const q = filter.toLowerCase();
    return logs.filter((l) => l.text.toLowerCase().includes(q));
  }, [logs, filter]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
    measureElement:
      typeof window !== 'undefined' && !('ResizeObserver' in window)
        ? undefined
        : (el) => el.getBoundingClientRect().height,
  });

  useEffect(() => {
    if (!follow || filtered.length === 0) return;
    rowVirtualizer.scrollToIndex(filtered.length - 1, { align: 'end' });
  }, [filtered.length, follow, rowVirtualizer]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const headerH =
      containerRef.current.querySelector('[data-header]')?.getBoundingClientRect().height ?? 0;
    const y = e.clientY - rect.top - headerH;
    const max = rect.height - headerH - 28;
    setSplitY(Math.max(MIN_PANEL, Math.min(max - MIN_PANEL, y)));
  }, []);

  const onDragEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  const currentStatus = status?.status ?? 'stopped';
  const isServiceRunning = currentStatus === 'running' || currentStatus === 'starting';
  const cmdStatuses = status?.commands ?? [];

  useEffect(() => {
    if (!isServiceRunning || !service || !selectedId) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.key === 'c' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        const msg = activeCmd
          ? `Stop "${activeCmd}" command on ${service.name}?`
          : `Stop ${service.name}?`;
        setPendingConfirm({
          message: msg,
          onConfirm: () => {
            setPendingConfirm(null);
            if (activeCmd) void ipc.stopServiceCmd(selectedId, activeCmd);
            else void ipc.stopService(selectedId);
          },
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isServiceRunning, selectedId, activeCmd, service]);

  if (!service || !selectedId) {
    return (
      <div className="text-fg-dim flex flex-1 items-center justify-center text-[13px]">
        {!selectedId ? 'Select a service to view its logs.' : 'Loading service…'}
      </div>
    );
  }

  // Supervised process tree for this service: the service-level pid + every
  // command pid. A listener belongs to us if its own pid OR any of its
  // ancestors match (handles shell → pnpm → next-dev worker chains).
  const supervisedPids = new Set<number>();
  if (status?.pid != null) supervisedPids.add(status.pid);
  for (const c of status?.commands ?? []) {
    if (c.pid != null) supervisedPids.add(c.pid);
  }

  const servicePorts = ports.filter((p) => {
    if (supervisedPids.has(p.pid)) return true;
    for (const anc of p.ancestor_pids ?? []) {
      if (supervisedPids.has(anc)) return true;
    }
    // Fallback: if the service declared a port, show any listener on that port
    // so users always see their "intended" port even if the pid map is stale.
    return service.port != null && p.port === service.port;
  });

  return (
    <div
      ref={containerRef}
      className="bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Header */}
      <div
        data-header
        className="border-border/70 bg-surface-raised flex shrink-0 flex-col gap-2.5 border-b px-5 py-3"
      >
        {/* Title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusDot status={currentStatus} size="md" />
            <h2 className="text-fg text-[15px] font-semibold tracking-tight">{service.name}</h2>
            <StatusPill status={currentStatus} />
            <div className="ml-1 flex items-center gap-1.5">
              {service.tags.slice(0, 3).map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label="Edit"
              icon={<Pencil />}
              size="sm"
              onClick={() => openEditor(service)}
            />
            <IconButton
              label="Delete"
              icon={<Trash2 />}
              size="sm"
              tone="danger"
              onClick={() => {
                setPendingConfirm({
                  message: `Delete "${service.name}"?`,
                  onConfirm: async () => {
                    setPendingConfirm(null);
                    await ipc.stopService(service.id).catch(() => undefined);
                    await ipc.removeService(service.id);
                    removeServiceLocal(service.id);
                  },
                });
              }}
            />
            <IconButton
              label="Open folder"
              icon={<FolderOpen />}
              size="sm"
              onClick={() => void ipc.openPath(service.cwd)}
            />
            {service.port != null && (
              <IconButton
                label={`Open ${localUrl(service.port!)}`}
                icon={<Globe />}
                size="sm"
                tone="accent"
                onClick={() => void ipc.openUrl(localUrl(service.port!))}
              />
            )}
            <EditorDropdown cwd={service.cwd} cmds={service.cmds} size="sm" />
          </div>
        </div>

        {/* Toolbar row — matches reference: [Play all] [Restart] [Stop]  …  [Filter]  …  [Logs|Ports|Env] */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {isServiceRunning ? (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Square className="h-3 w-3" />}
                onClick={() => void ipc.stopService(service.id)}
              >
                Stop{service.cmds.length > 1 ? ' all' : ''}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play className="h-3 w-3 fill-current" />}
                onClick={() => void ipc.startService(service.id)}
              >
                {service.cmds.length > 1 ? 'Play all' : 'Play'}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="h-3 w-3" />}
              onClick={() => void ipc.restartService(service.id)}
            >
              Restart
            </Button>
            {isServiceRunning && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Square className="h-3 w-3" />}
                onClick={() => void ipc.stopService(service.id)}
              >
                Stop
              </Button>
            )}
          </div>

          {/* Filter */}
          <div className="relative w-full max-w-[280px]">
            <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter logs…"
              className="border-border bg-surface-muted/70 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface rounded-app-sm h-7 w-full border px-2 pl-7 text-[12px] transition focus:outline-none"
            />
            <kbd className="text-fg-dim border-border bg-surface absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded border px-1 font-mono text-[9.5px] md:inline">
              /
            </kbd>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* `key` forces a remount on service change so per-service local
                state (branches list, in-progress inputs, popover-open flag)
                can't leak from one service into the next. */}
            <GitStatusChip key={service.id} serviceId={service.id} cwd={service.cwd} />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<TerminalSquare className="h-3 w-3" />}
              className={showTerminal ? 'border-accent/50 text-accent bg-accent/10' : ''}
              onClick={() => setShowTerminal((v) => !v)}
            >
              {showTerminal ? 'Close' : 'Terminal'}
            </Button>

            <PopoverChip
              icon={<Network className="h-3 w-3" />}
              label="Ports"
              count={servicePorts.length}
              open={openPopover === 'ports'}
              onToggle={() => setOpenPopover((prev) => (prev === 'ports' ? null : 'ports'))}
              onClose={() => setOpenPopover(null)}
            >
              <PortsPopoverBody ports={servicePorts} pid={status?.pid ?? null} />
            </PopoverChip>
          </div>
        </div>

        {/* Command tabs */}
        {service.cmds.length > 1 && (
          <div className="flex flex-wrap items-stretch gap-1">
            {service.cmds.map((entry) => {
              const cs = cmdStatuses.find((c) => c.name === entry.name);
              const csStatus = cs?.status ?? 'stopped';
              const isActive = activeCmd === entry.name;
              const isRunning = csStatus === 'running' || csStatus === 'starting';
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => setSelectedCmd(entry.name)}
                  className={cn(
                    'rounded-app-sm group flex items-center gap-2 border px-2 py-1 text-left transition',
                    isActive
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border/70 hover:bg-surface-overlay/60',
                  )}
                >
                  <span
                    className={cn('svc-badge', badgeClass(entry.name), isActive && 'opacity-100')}
                  >
                    {entry.name}
                  </span>
                  <span className="text-fg-dim max-w-[160px] truncate text-[10px]">
                    {isRunning && cs?.pid != null ? `pid ${cs.pid}` : entry.cmd}
                  </span>
                  <div
                    role="button"
                    tabIndex={0}
                    title={isRunning ? `Stop ${entry.name}` : `Start ${entry.name}`}
                    className={cn(
                      'ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition',
                      isRunning
                        ? 'text-status-error/70 hover:bg-status-error/10 hover:text-status-error'
                        : 'text-status-running/70 hover:bg-status-running/10 hover:text-status-running',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isRunning) void ipc.stopServiceCmd(service.id, entry.name);
                      else void ipc.startServiceCmd(service.id, entry.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        if (isRunning) void ipc.stopServiceCmd(service.id, entry.name);
                        else void ipc.startServiceCmd(service.id, entry.name);
                      }
                    }}
                  >
                    {isRunning ? (
                      <Square className="h-2.5 w-2.5" />
                    ) : (
                      <Play className="h-2.5 w-2.5" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Logs — always the primary body. Ports / Env are popovers in the toolbar. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ userSelect: dragging.current ? 'none' : undefined }}
      >
        <div className="text-fg-dim flex items-center justify-between px-5 py-1 text-[10.5px]">
          <span className="tabular-nums">
            {filtered.length.toLocaleString()} / {logs.length.toLocaleString()} lines
          </span>
          <div className="flex items-center gap-2">
            <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
                className="accent-accent h-2.5 w-2.5"
              />
              Follow
            </label>
            <IconButton
              label="Clear logs"
              icon={<Eraser />}
              size="xs"
              onClick={() => {
                if (logK) {
                  void ipc.clearLogs(logK);
                  clearLogsLocal(logK);
                }
              }}
            />
          </div>
        </div>
        <div
          ref={parentRef}
          className="log-line flex-1 overflow-auto px-4 pb-2 text-[12.5px] leading-[22px]"
          style={showTerminal ? { height: splitY, flex: 'none' } : undefined}
        >
          {filtered.length === 0 ? (
            <div className="text-fg-dim flex h-full items-center justify-center text-[11px]">
              {logs.length === 0 ? 'No logs yet. Start the service to see output.' : 'No matches.'}
            </div>
          ) : (
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((row) => {
                const line = filtered[row.index]!;
                const isLast = row.index === filtered.length - 1;
                return (
                  <div
                    key={row.key}
                    data-index={row.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${row.start}px)`,
                    }}
                    className={cn(
                      'flex items-start gap-3 rounded-[4px] px-2 py-[1px]',
                      isLast && follow && 'log-cursor-line',
                    )}
                  >
                    <span className="text-fg-dim w-[62px] shrink-0 text-[11px] leading-[22px] tabular-nums select-none">
                      {formatTs(line.ts_ms)}
                    </span>
                    {activeCmd && (
                      <span
                        className={cn(
                          'svc-badge mt-[3px] shrink-0',
                          line.stream === 'stderr'
                            ? 'bg-status-error/15 text-status-error'
                            : line.stream === 'system'
                              ? 'bg-accent/15 text-accent'
                              : badgeClass(activeCmd),
                        )}
                      >
                        {activeCmd}
                      </span>
                    )}
                    <div
                      className={cn(
                        'min-w-0 flex-1 break-all whitespace-pre-wrap',
                        STREAM_COLOR[line.stream],
                      )}
                    >
                      <LogLineContent text={line.text} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showTerminal && (
          <>
            <div
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              className="border-border/60 bg-surface-muted/60 group hover:bg-accent/10 relative flex h-5 shrink-0 cursor-row-resize items-center justify-center border-y transition-colors"
            >
              <GripHorizontal className="text-fg-dim group-hover:text-accent h-3 w-3" />
            </div>
            <div className="bg-surface-muted min-h-0 flex-1">
              <TerminalPane id={selectedId} cwd={service.cwd} />
            </div>
          </>
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

/** Toolbar chip-button that anchors a floating popover panel below it. */
function PopoverChip({
  icon,
  label,
  count,
  open,
  onToggle,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'border-border rounded-app-sm flex h-7 items-center gap-1.5 border px-2 text-[12px] font-medium transition',
          open
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'bg-surface-muted/70 text-fg-muted hover:text-fg hover:bg-surface-overlay',
        )}
      >
        <span className={cn(open ? 'text-accent' : 'text-fg-dim')}>{icon}</span>
        <span>{label}</span>
        {count > 0 && (
          <span
            className={cn(
              'rounded-app-sm ml-0.5 px-1 text-[10px] tabular-nums',
              open ? 'bg-accent/20 text-accent' : 'bg-surface-overlay text-fg-muted',
            )}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="border-border bg-surface-raised rounded-app-lg animate-fade-in absolute top-full right-0 z-50 mt-1.5 w-[360px] overflow-hidden border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          role="dialog"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function PortsPopoverBody({ ports, pid }: { ports: ListeningPort[]; pid: number | null }) {
  if (ports.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <Network className="text-fg-dim mx-auto mb-2 h-4 w-4" />
        <p className="text-fg-muted text-[12px]">No listening ports detected.</p>
        <p className="text-fg-dim mt-1 text-[10.5px]">
          Start the service{pid != null ? ` (pid ${pid})` : ''} and any listeners will appear here.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="border-border bg-surface-muted text-fg-dim flex items-center justify-between border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
        <span>Listening ports</span>
        <span className="tracking-normal normal-case tabular-nums">{ports.length} open</span>
      </div>
      <div className="divide-border max-h-[280px] divide-y overflow-auto">
        {ports.map((p) => (
          <div
            key={`${p.pid}-${p.port}`}
            className="hover:bg-surface-muted/50 group flex items-center gap-2 px-3 py-2 transition"
          >
            <span className="bg-accent/10 text-accent rounded-app-sm shrink-0 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold">
              :{p.port}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-fg truncate font-mono text-[11.5px]">{p.process_name}</p>
              <p className="text-fg-dim font-mono text-[10px]">pid {p.pid}</p>
            </div>
            <button
              type="button"
              className="text-accent hover:bg-accent/10 rounded-app-sm flex items-center gap-1 px-2 py-1 text-[11px] opacity-0 transition group-hover:opacity-100"
              onClick={() => void ipc.openUrl(localUrl(p.port))}
            >
              Open <ExternalLink className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function LogLineContent({ text }: { text: string }) {
  const parts = useMemo(() => splitUrls(text), [text]);
  if (parts.length === 1 && !parts[0]!.url) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.url ? (
          <span
            key={i}
            role="link"
            className="text-accent decoration-accent/40 hover:decoration-accent cursor-pointer underline underline-offset-2 transition"
            onClick={(e) => {
              e.stopPropagation();
              void ipc.openUrl(part.url!);
            }}
            title={part.url}
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

interface TextPart {
  text: string;
  url: string | null;
}

function splitUrls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index!;
    if (start > last) parts.push({ text: text.slice(last, start), url: null });
    parts.push({ text: m[0]!, url: m[0]! });
    last = start + m[0]!.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), url: null });
  if (parts.length === 0) parts.push({ text, url: null });
  return parts;
}
