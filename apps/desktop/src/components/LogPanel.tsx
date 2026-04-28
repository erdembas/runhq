import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import AnsiToHtml from 'ansi-to-html';
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
import { runtimeFromTags, inferRuntimeFromCmds } from '@/lib/runtimes';
import { buildLogChatPayload } from '@/lib/ai/logPayload';
import type { ListeningPort, LogLine } from '@/types';

type PopoverKey = 'ports';

const EMPTY_LOGS: LogLine[] = [];
const MIN_PANEL = 80;

/** Build ANSI → HTML converters per stream.
 *
 *  Notes on the palette:
 *  - `fg`/`bg` are only emitted when the source contains an ANSI reset;
 *    lines without escape codes stay uncolored and inherit the surrounding
 *    CSS color (see `streamColorClass` below). That's intentional — it lets
 *    the tokenized Tailwind colors handle "no ANSI" lines and the ANSI
 *    palette handle styled segments, so themes stay consistent.
 *  - The `colors` map mirrors the VS Code integrated terminal ("Dark+" /
 *    "Light+") palette so output looks the same here as in the embedded
 *    PTY at the bottom of the screen. */
function makeConverters(isDark: boolean) {
  const fg = isDark ? '#d4d4d4' : '#383a42';
  const bg = isDark ? '#1e1e1e' : '#ffffff';
  const palette = isDark
    ? {
        0: '#000000',
        1: '#cd3131',
        2: '#0dbc79',
        3: '#e5e510',
        4: '#2472c8',
        5: '#bc3fbc',
        6: '#11a8cd',
        7: '#e5e5e5',
        8: '#666666',
        9: '#f14c4c',
        10: '#23d18b',
        11: '#f5f543',
        12: '#3b8eea',
        13: '#d670d6',
        14: '#29b8db',
        15: '#e5e5e5',
      }
    : {
        0: '#000000',
        1: '#cd3131',
        2: '#00bc00',
        3: '#949800',
        4: '#0451a5',
        5: '#bc05bc',
        6: '#0598bc',
        7: '#555555',
        8: '#666666',
        9: '#cd3131',
        10: '#14ce14',
        11: '#b5ba00',
        12: '#0451a5',
        13: '#bc05bc',
        14: '#0598bc',
        15: '#a5a5a5',
      };
  const opts = { bg, escapeXML: true, newline: false, colors: palette } as const;
  return {
    stdout: new AnsiToHtml({ ...opts, fg }),
    stderr: new AnsiToHtml({ ...opts, fg: palette[9] }),
    system: new AnsiToHtml({ ...opts, fg: isDark ? '#4ec9b0' : '#267f99' }),
  };
}

/** Fallback Tailwind color per stream. Applied on the container so lines
 *  that ship no ANSI (Vite's plain "Port 5173 is in use…", pnpm's first
 *  info line before color kicks in, etc.) still look like a real console. */
function streamColorClass(stream: LogLine['stream']): string {
  switch (stream) {
    case 'stderr':
      return 'text-status-error';
    case 'system':
      return 'text-accent italic';
    default:
      return 'text-fg';
  }
}

/** Strip non-SGR ANSI control sequences before handing text to ansi-to-html.
 *
 *  `ansi-to-html` only understands **SGR** (`ESC [ … m`, color + style). For
 *  anything else — cursor moves (`G`, `H`, `A`-`F`), erase (`J`, `K`),
 *  scroll (`S`, `T`), save/restore (`s`, `u`), DEC private modes (`? … h/l`),
 *  OSC/APC/DCS/PM strings — it drops the `ESC [` prefix and happily leaks
 *  the trailing verb into the rendered HTML. That's what produced the leading
 *  `G` / `G$` we kept seeing on `yarn`'s "yarn run v1.22.19" + `$ vite` lines
 *  once `FORCE_COLOR=1` started making it emit full progress chrome.
 *
 *  We pre-strip those sequences here so only SGR survives. The regex covers:
 *    - CSI `ESC [ … <final>` where `<final>` is any non-`m` dispatch letter
 *    - OSC `ESC ] … (BEL | ESC \)` for terminal title / iTerm2 / hyperlinks
 *    - Bare single-byte controls (`ESC (X`, `ESC =`, etc.) we don't render
 *
 *  SGR (`m`) is deliberately excluded so colors keep working. */
const ANSI_NON_SGR_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[@A-HJKSTfhlnpsuDEMLR]|[()][A-Z0-9]|[=>DEMHcp78])/g;

/** Collapse a line containing carriage returns down to just the last segment.
 *
 *  `\r` in a terminal means "jump back to column 0; whatever I write next
 *  overwrites the current visual row". Our log buffer is line-addressed and
 *  not a real terminal, so we can't animate. The next best thing is to
 *  surface the **latest** frame of a progress indicator — e.g. for yarn's
 *  "Receiving objects: 10% -> 40% -> 80% -> 100%" sequence we show just
 *  "Receiving objects: 100%" instead of a mashed-together run of earlier
 *  frames. Applied *before* ANSI parsing so the active color state right at
 *  the point of the final `\r` is what we feed to `ansi-to-html`. */
function collapseCarriageReturn(input: string): string {
  const idx = input.lastIndexOf('\r');
  return idx === -1 ? input : input.slice(idx + 1);
}

function sanitizeAnsi(input: string): string {
  return collapseCarriageReturn(input).replace(ANSI_NON_SGR_RE, '');
}

/** Wrap http(s) URLs inside an ansi-to-html output with clickable anchors.
 *
 *  Why DOM and not regex: `ansi-to-html` doesn't emit flat sibling spans —
 *  when a new SGR adds a style (cyan + bold for the port, `\x1b[36m…
 *  \x1b[1m…\x1b[22m…\x1b[39m`), it *nests* the bold inside the cyan, so a
 *  URL like Vite's `http://localhost:5176/` lives inside a soup of
 *  `<span>http://localhost:<b>5176<span>/<span></span></span></b></span>`.
 *  Any regex that tries to bridge those tags will either stop short
 *  (truncating the port) or greedily swallow unrelated structure. The
 *  reliable move is to parse the HTML into a detached `<div>`, scan its
 *  concatenated text for URLs, then use `Range.surroundContents`-style
 *  extraction to wrap the exact character range — splitting whatever
 *  inline tags happen to straddle the URL.
 *
 *  Styling: the anchor itself carries no color class. The descendant
 *  spans already have their ANSI colors, and `text-decoration-color`
 *  defaults to `currentColor`, so the underline picks up whatever hue
 *  the emitting CLI chose. Just a hover fade to signal "interactive".
 *
 *  We mark matches with `data-open-url` rather than a real `href` so a
 *  single delegated click handler on the log container can route the
 *  click through `ipc.openUrl`, which opens in the OS browser — vital so
 *  navigating a log link doesn't replace the Tauri webview with the
 *  target page. */
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;
const ANCHOR_CLASS =
  'cursor-pointer underline underline-offset-2 hover:opacity-80 transition-opacity';

function linkifyHtml(html: string): string {
  // Cheap fast path — most log lines have no URLs, no need to touch the DOM.
  if (!/https?:\/\//.test(html)) return html;

  const root = document.createElement('div');
  root.innerHTML = html;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  const starts: number[] = [];
  let plain = '';
  let n: Node | null;
  while ((n = walker.nextNode())) {
    starts.push(plain.length);
    const t = n as Text;
    textNodes.push(t);
    plain += t.data;
  }

  interface Match {
    start: number;
    end: number;
    url: string;
  }
  const matches: Match[] = [];
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(plain)) !== null) {
    let url = m[0];
    const trail = url.match(TRAILING_PUNCT_RE);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    if (url.length < 8) continue; // sanity: "http://x" is the bare minimum.
    matches.push({ start: m.index, end: m.index + url.length, url });
  }
  if (matches.length === 0) return html;

  // Locate which text node contains a given absolute offset.
  const locate = (offset: number): [Text, number] => {
    for (let i = 0; i < textNodes.length; i++) {
      const s = starts[i] ?? 0;
      const node = textNodes[i]!;
      const e = s + node.data.length;
      if (offset <= e) return [node, Math.max(0, offset - s)];
    }
    const last = textNodes[textNodes.length - 1]!;
    return [last, last.data.length];
  };

  // Apply in reverse so earlier offsets remain valid after each wrap.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const { start, end, url } = match;
    const [startNode, startOffset] = locate(start);
    const [endNode, endOffset] = locate(end);
    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch {
      continue;
    }
    const anchor = document.createElement('a');
    anchor.setAttribute('data-open-url', url);
    anchor.setAttribute('title', url);
    anchor.className = ANCHOR_CLASS;
    try {
      anchor.appendChild(range.extractContents());
      range.insertNode(anchor);
    } catch {
      // Range can fail to surround when it crosses tag boundaries awkwardly;
      // `extractContents`+`insertNode` handles that, but guard anyway.
    }
  }

  return root.innerHTML;
}

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
  const converters = useMemo(() => makeConverters(isDark), [isDark]);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Delegated handler for the anchors that `linkifyHtml` injects into log
  // lines. We use a single listener on the scroll container instead of
  // attaching real `<a href>`s because (a) the HTML is produced by
  // `dangerouslySetInnerHTML` so React event props aren't available and
  // (b) a real `href` navigates the Tauri webview itself, nuking the app;
  // routing through `ipc.openUrl` opens the user's OS browser instead.
  const handleLogClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-open-url]');
    if (!anchor) return;
    const url = anchor.getAttribute('data-open-url');
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    void ipc.openUrl(url);
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
        {/* Meta strip directly above the virtualized list.
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
        <div
          ref={parentRef}
          className="log-line flex-1 overflow-auto px-4 pb-2 text-[12.5px] leading-[22px]"
          style={showTerminal ? { height: splitY, flex: 'none' } : undefined}
          onClick={handleLogClick}
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
                    onContextMenu={(e) => {
                      // Empty / whitespace-only lines aren't useful to
                      // triage — they're usually intentional spacers
                      // from process output. Skip them rather than
                      // confusing the model.
                      if (line.text.trim() === '') return;
                      e.preventDefault();
                      // Take the previous 30 lines for context — the
                      // most recent line is `line` itself, so we
                      // include indices [i-30, i] inclusive. Adding
                      // *future* lines would be misleading because
                      // the user clicked while triaging an error,
                      // not when reading a happy-path trace.
                      const start = Math.max(0, row.index - 30);
                      const ctx = filtered.slice(start, row.index + 1).map((l) => l.text);
                      const runtime = service
                        ? (runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds))
                        : null;
                      const payload = buildLogChatPayload({
                        line: line.text,
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
                    }}
                  >
                    {showTimestamp && (
                      // Blank log rows (a literal "\n" from the child process,
                      // e.g. Vite's spacer between its port-in-use retries and
                      // the ready banner) reserve vertical space but carry no
                      // content. Repeating the timestamp on them turned the
                      // view into a wall of dates between every actual line.
                      // We still reserve the column width via `w-[150px]`
                      // so content columns line up across all rows.
                      <span className="text-fg-dim w-[150px] shrink-0 text-[11px] leading-[22px] tabular-nums select-none">
                        {line.text.trim() === '' ? '' : formatTs(line.ts_ms)}
                      </span>
                    )}
                    <div
                      className={cn(
                        'min-w-0 flex-1 break-all whitespace-pre-wrap',
                        streamColorClass(line.stream),
                      )}
                      dangerouslySetInnerHTML={{
                        __html: linkifyHtml(
                          converters[line.stream].toHtml(sanitizeAnsi(line.text)),
                        ),
                      }}
                    />
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

/** Full local timestamp: `YYYY-MM-DD HH:MM:SS`.
 *
 *  ISO-ish, locale-independent, 24-hour. Date included so a log line that
 *  wrapped across midnight (dev server left running overnight, scheduled
 *  restarts, CI runs queued after 00:00) isn't ambiguous — otherwise two
 *  rows hours apart can show the same `00:03:12` and look adjacent.
 *  Uses local wall-clock (`get*`, not `getUTC*`) because users correlate
 *  these against what their IDE / browser / OS clock says, not UTC. */
function formatTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
