import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  ExternalLink,
  FolderOpen,
  Globe,
  GripHorizontal,
  Maximize2,
  Minimize2,
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
import { LogXtermView } from '@/components/LogXtermView';
import { TerminalPane } from '@/components/TerminalPane';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import { runtimeFromTags, inferRuntimeFromCmds } from '@/lib/runtimes';
import { buildLogChatPayload } from '@/lib/ai/logPayload';
import type { ListeningPort, LogLine } from '@/types';

type PopoverKey = 'ports';

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

interface LogPanelProps {
  /**
   * The service this panel renders. Provided by the parent (the
   * tabbed main-area host) instead of read from the store so that
   * multiple LogPanel instances can coexist — one per open service
   * tab — each with its own filter / follow / terminal / split
   * state. Reading the active service from the store would make
   * every instance render the same one and collapse the tab system
   * into a single shared view.
   */
  serviceId: string;
}

export function LogPanel({ serviceId }: LogPanelProps) {
  const selectedId = serviceId;
  // Per-tab "active command" state. Lives locally so each open
  // service tab remembers which sub-command the user was looking
  // at — switching tabs and coming back keeps you on the same
  // command without re-deriving from a global store value that
  // would clobber sibling tabs.
  const [selectedCmdName, setSelectedCmdName] = useState<string | null>(null);
  const service = useAppStore((s) => s.services.find((x) => x.id === serviceId) ?? null);
  const status = useAppStore((s) => s.statuses[serviceId]);
  const ports = useAppStore((s) => s.ports);
  const replaceLogs = useAppStore((s) => s.replaceLogs);
  const clearLogsLocal = useAppStore((s) => s.clearLogs);
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const openAiChat = useAppStore((s) => s.openAiChat);

  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  // Off by default — the active command strip at the top of the log list
  // already tells you *what* is running, and most users want dense, diff-like
  // rows while scanning output. Turn it on when you actually need to line up
  // events against wall-clock time.
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  // When `true`, the terminal expands to fill the entire content area
  // (logs list and splitter both collapse). Kept as local component
  // state — like `selectedCmdName` — so each service tab remembers
  // its own maximize preference independently. Auto-resets when the
  // terminal itself is closed: re-opening should land in the
  // familiar split layout, not silently re-enter fullscreen.
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const [openPopover, setOpenPopover] = useState<PopoverKey | null>(null);
  const [splitY, setSplitY] = useState(() => Math.round(window.innerHeight * 0.55));
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // AI log-triage now routes through the right-side chat panel via
  // `openAiChat`. We keep no local triage state — the right-click
  // handler builds the payload inline and hands it off to the store.

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Closing the terminal panel must also drop the maximize flag so a
  // future re-open lands in the regular split view. Otherwise the
  // user clicks "Terminal" expecting to *see* logs again and gets a
  // stale fullscreen state staring back at them.
  useEffect(() => {
    if (!showTerminal && terminalMaximized) setTerminalMaximized(false);
  }, [showTerminal, terminalMaximized]);

  // Esc restores the split view from fullscreen. We attach the
  // listener only while maximized to keep keyboard surface area
  // honest — Esc has lots of meanings across this app (close
  // popovers, dismiss dialogs) and we don't want to claim it
  // unconditionally. Capture phase isn't necessary since nothing
  // earlier in the tree consumes Esc when this mode is on.
  useEffect(() => {
    if (!terminalMaximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setTerminalMaximized(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [terminalMaximized]);

  const activeCmd = useMemo(() => {
    if (!service) return null;
    if (selectedCmdName && service.cmds.some((c) => c.name === selectedCmdName))
      return selectedCmdName;
    return service.cmds[0]?.name ?? null;
  }, [service, selectedCmdName]);

  const activeCmdEntry = useMemo(() => {
    if (!service || !activeCmd) return null;
    return service.cmds.find((c) => c.name === activeCmd) ?? null;
  }, [service, activeCmd]);

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

  // Right-click on a log line forwards a triage request to the AI
  // chat panel: line + the previous 30 lines as context, runtime
  // hint inferred from tags / cmds. Memoised + dependent on the
  // current `filtered` slice so the marker → index mapping done
  // inside `LogXtermView` stays in sync with what's rendered.
  const handleLineContextMenu = useCallback(
    (index: number) => {
      const target = filtered[index];
      if (!target) return;
      // Context window mirrors the legacy LogPanel: 30 lines BEFORE
      // the click + the clicked line itself. We deliberately exclude
      // *future* lines because the user clicked while triaging an
      // error, not while reading a happy-path trace.
      const start = Math.max(0, index - 30);
      const ctx = filtered.slice(start, index + 1).map((l) => l.text);
      const runtime = service
        ? (runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds))
        : null;
      const payload = buildLogChatPayload({
        line: target.text,
        contextLines: ctx,
        runtime,
        serviceName: service?.name ?? null,
      });
      void openAiChat({
        origin: 'log',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
        autoSend: true,
      });
    },
    [filtered, service, openAiChat],
  );

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
            <GitStatusChip key={service.id} serviceId={service.id} />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<TerminalSquare className="h-3 w-3" />}
              className={showTerminal ? 'border-accent/50 text-accent bg-accent/10' : ''}
              onClick={() => setShowTerminal((v) => !v)}
            >
              {showTerminal ? 'Close' : 'Terminal'}
            </Button>
            {/*
              Fullscreen toggle for the terminal pane. Only renders
              when the terminal is open — there's nothing to maximize
              otherwise, and showing a disabled control would just
              add visual clutter to the toolbar. Keeping it adjacent
              to the Terminal button groups the two terminal-related
              affordances together (open ↔ size) instead of scattering
              them across the row.
            */}
            {showTerminal && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={
                  terminalMaximized ? (
                    <Minimize2 className="h-3 w-3" />
                  ) : (
                    <Maximize2 className="h-3 w-3" />
                  )
                }
                className={terminalMaximized ? 'border-accent/50 text-accent bg-accent/10' : ''}
                onClick={() => setTerminalMaximized((v) => !v)}
                title={
                  terminalMaximized
                    ? 'Restore split view (Esc)'
                    : 'Expand terminal to fill the panel'
                }
              >
                {terminalMaximized ? 'Restore' : 'Expand'}
              </Button>
            )}

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
                  onClick={() => setSelectedCmdName(entry.name)}
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
        {/* Meta strip directly above the xterm log view.
            - Left: which command owns this log buffer (badge + raw invocation
              like `yarn dev`). Moved out of each row because repeating the
              same badge on every line was pure noise once a single command
              was selected.
            - Right: per-list toggles (timestamp, follow) + clear. */}
        <div className="text-fg-dim flex items-center justify-between gap-3 px-5 py-1.5 text-[10.5px]">
          <div className="flex min-w-0 items-center gap-2">
            {activeCmd && (
              <span className={cn('svc-badge shrink-0', badgeClass(activeCmd))}>{activeCmd}</span>
            )}
            {activeCmdEntry && (
              <code
                className="text-fg-muted truncate font-mono text-[11px]"
                title={activeCmdEntry.cmd}
              >
                {activeCmdEntry.cmd}
              </code>
            )}
            <span className="text-fg-dim/80 shrink-0 tabular-nums">
              · {filtered.length.toLocaleString()} / {logs.length.toLocaleString()} lines
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
              <input
                type="checkbox"
                checked={showTimestamp}
                onChange={(e) => setShowTimestamp(e.target.checked)}
                className="accent-accent h-2.5 w-2.5"
              />
              Timestamp
            </label>
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

        {/*
          xterm.js host. The view is "controlled" via props: `filtered`
          is the source of truth, `LogXtermView` reconciles its buffer
          against that array. We intentionally use `display: none` (via
          `hidden`) instead of unmounting on maximize so the xterm
          instance, its scrollback, and the per-line markers all
          survive — re-mounting on every toggle would dump the user's
          scroll position and force a full re-write of the buffer.

          The `key` is keyed on `serviceId + activeCmd` so switching
          commands (or services) gives the xterm a fresh instance with
          clean state. Reusing one xterm across cmd switches would
          require an extra reset round-trip and risk leaking markers
          into the wrong cmd's lookup table.
        */}
        <div
          className={cn('flex-1 overflow-hidden px-6', terminalMaximized && 'hidden')}
          style={showTerminal && !terminalMaximized ? { height: splitY, flex: 'none' } : undefined}
        >
          <LogXtermView
            key={`${selectedId}::${activeCmd ?? '__none__'}`}
            lines={filtered}
            totalLogs={logs.length}
            showTimestamp={showTimestamp}
            follow={follow}
            isDark={isDark}
            onLineContextMenu={handleLineContextMenu}
          />
        </div>

        {showTerminal && (
          <>
            {/*
              Hide the resize splitter while maximized — there's
              nothing on the other side to resize against, so a
              draggable handle would just be confusing dead UI. We
              still keep it mounted via `hidden` so its pointer
              capture refs stay stable; not strictly required
              today, but cheaper than re-creating handlers on
              every maximize toggle.
            */}
            <div
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              className={cn(
                'border-border/60 bg-surface-muted/60 group hover:bg-accent/10 relative flex h-5 shrink-0 cursor-row-resize items-center justify-center border-y transition-colors',
                terminalMaximized && 'hidden',
              )}
            >
              <GripHorizontal className="text-fg-dim group-hover:text-accent h-3 w-3" />
              {/*
                In-handle Expand affordance.

                Why here: the splitter is exactly where the user's
                eye lands when they want "more terminal, less log" —
                a fullscreen button on the same line is a natural
                escalation of that intent. Putting the control IN the
                handle (right-anchored) instead of next to it keeps
                the row a single visual unit at h-5.

                Why `stopPropagation` on pointer down: the parent owns
                the drag-to-resize gesture (`onPointerDown` →
                `setPointerCapture`). Without stopping the event the
                act of clicking the button would also start a drag,
                and the user would feel the panel jump while their
                fullscreen click "succeeded but did weird things".
                Stopping the bubble keeps the two interactions
                cleanly separated.
              */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setTerminalMaximized(true);
                }}
                title="Expand terminal to fill the panel"
                aria-label="Expand terminal to fill the panel"
                className={cn(
                  'absolute top-1/2 right-1.5 -translate-y-1/2',
                  'flex h-4 items-center gap-1 rounded px-1.5',
                  'text-fg-dim hover:bg-accent/15 hover:text-accent',
                  'cursor-pointer text-[10px] font-medium transition-colors',
                )}
              >
                <Maximize2 className="h-2.5 w-2.5" />
                <span>Expand</span>
              </button>
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
