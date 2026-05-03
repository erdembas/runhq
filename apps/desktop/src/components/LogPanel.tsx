import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Network,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Drawer } from '@/components/ui/Drawer';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { TagChip } from '@/components/ui/TagChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  AuditChip,
  LicenseChip,
  OutdatedChip,
  licenseContaminationCount,
} from '@/components/dashboard/healthChips';
import { ProjectDetailDrawer, type DetailTab } from '@/components/ProjectDetailDrawer';
import { EditorDropdown } from '@/components/EditorDropdown';
import { GitStatusChip } from '@/components/GitStatusChip';
import { LogXtermView } from '@/components/LogXtermView';
import { TerminalPane } from '@/components/TerminalPane';
import { ServiceLayout } from '@/components/layout/ServiceLayout';
import { findGroupByTab, type Tab as LayoutTab } from '@/components/layout/layoutModel';
import { useServiceLayout } from '@/components/layout/useServiceLayout';
import { registerServiceShortcuts } from '@/lib/serviceShortcutBus';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import { runtimeFromTags, inferRuntimeFromCmds } from '@/lib/runtimes';
import { buildLogChatPayload } from '@/lib/ai/logPayload';
import type { ListeningPort, LogLine } from '@/types';

// Lazy-load the LicensePanel — same rationale as the dashboard:
// the panel pulls in the full per-package license table renderer
// and the THIRD-PARTY-NOTICES generator, which is dead weight for
// the (majority) sessions where the user never opens it.
const LicensePanel = lazy(() =>
  import('@/components/LicensePanel').then((m) => ({ default: m.LicensePanel })),
);

// The DOCS tab pulls in `react-markdown` + `remark-gfm` + the docs
// renderer. That's ~80 KB gzipped — meaningful for a panel a
// significant fraction of users won't open. Lazy-loading defers it
// until the user clicks the DOCS tab; the LOGS path stays as fast
// as before.
const ProjectDocsTab = lazy(() =>
  import('@/components/docs/ProjectDocsTab').then((m) => ({ default: m.ProjectDocsTab })),
);

// Notes tab shares the markdown renderer with DOCS, but ships its
// own edit/preview surface. Lazy-loaded for the same bundle-cost
// reason as DOCS — most service-tab views start on LOGS and never
// hit Notes, so we don't want to eagerly pay for the markdown
// pipeline up front.
const ProjectNotesTab = lazy(() =>
  import('@/components/ProjectNotesTab').then((m) => ({ default: m.ProjectNotesTab })),
);

/** Encode a UTF-8 string as the byte-array shape `terminal_write` expects. */
function utf8ToBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

type PopoverKey = 'ports';

const EMPTY_LOGS: LogLine[] = [];

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

  // Mirror of the dashboard's per-card health chips, surfaced inline
  // in the service header so the badges the user just saw on the
  // dashboard card don't disappear the moment they drill in. We
  // read the `ProjectOverview` row for this specific service from
  // the global overview snapshot — the same data that drives the
  // card chips, so the two surfaces can never disagree.
  const projectMeta = useAppStore(
    (s) => s.overview?.projects.find((p) => p.service_id === serviceId) ?? null,
  );

  // Detail / license overlays are managed locally per-tab. Each
  // service tab keeps its own drawer state so flipping between
  // services doesn't leak "I had advisories open for foo-api" into
  // the bar-frontend tab. Mounting them here (instead of bubbling
  // up to App-level shared state) keeps the LogPanel a self-
  // contained per-service surface; the trade-off is a small DOM
  // duplication when many tabs are open at once, but each drawer
  // only renders when its trigger flag is set.
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  // Expose `runScan` so chip clicks (or a future "rescan" button on
  // the LogPanel itself) can re-trigger the per-service license +
  // dep audit pass. The dashboard does the same thing through its
  // own `runScan` callback; we do it inline here so the panel
  // doesn't have to reach back into the dashboard's local state.
  const overviewScanning = useAppStore((s) => s.overviewScanning);
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const setOverviewScanning = useAppStore((s) => s.setOverviewScanning);
  const patchOverviewScan = useAppStore((s) => s.patchOverviewScan);
  const editors = useAppStore((s) => s.editors);
  // Cross-surface "open this body tab" deep-link. The dashboard's
  // notes button writes a request into the store keyed by service
  // id; we read it here, apply, and clear so a second click on the
  // same button works again. Subscribing via a per-service selector
  // keeps every other LogPanel in the workspace from re-rendering
  // when an unrelated service's request flips.
  const pendingBodyTabRequest = useAppStore((s) => s.pendingServiceBodyTab[serviceId]);
  const consumePendingBodyTab = useAppStore((s) => s.consumePendingServiceBodyTab);
  const runWorkspaceScan = useCallback(async () => {
    if (overviewScanning) return;
    setOverviewScanning(true);
    try {
      const result = await ipc.scanProjectDependencies(true);
      patchOverviewScan(result);
    } catch (err) {
      console.error('scan_project_dependencies failed', err);
    } finally {
      setOverviewScanning(false);
    }
  }, [overviewScanning, setOverviewScanning, patchOverviewScan]);

  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  // Off by default — the active command strip at the top of the log list
  // already tells you *what* is running, and most users want dense, diff-like
  // rows while scanning output. Turn it on when you actually need to line up
  // events against wall-clock time.
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [openPopover, setOpenPopover] = useState<PopoverKey | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Per-service split-layout state (recursive panel tree, drag-and-
  // drop reorder/split, persisted in localStorage). Replaces the old
  // single `mainTab` enum + the per-pane `terminalEverOpened` latch:
  // the layout reducer tracks tabs, splits, and active-per-pane
  // state, and a tab is "alive" iff it appears in the tree (so
  // closing it really does reap the PTY beneath).
  const layout = useServiceLayout(serviceId);
  // Slot registry: ServiceLayout calls back with a DOM node for
  // each visible tab in each pane (active or not — inactive slots
  // stay laid out but `visibility:hidden`). We portal each tab's
  // body into the registered node, so moving a `terminal` tab
  // between groups is a pure DOM relocation and the underlying
  // PTY-bearing component never unmounts.
  //
  // We hold the map in `useState` (not a plain ref) so React knows
  // to re-render the body host list when slots appear / disappear;
  // the equality check inside `onSlotRef` makes that safe (no
  // pointless re-renders when the same DOM node re-registers).
  const [bodySlots, setBodySlots] = useState<Map<string, HTMLDivElement>>(() => new Map());
  const onSlotRef = useCallback((tabId: string, el: HTMLDivElement | null) => {
    setBodySlots((prev) => {
      if (el) {
        if (prev.get(tabId) === el) return prev;
        const next = new Map(prev);
        next.set(tabId, el);
        return next;
      }
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

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

  // Probe the project for docs once per service. Cheap (a single
  // IPC round-trip per service tab); the result is used both to
  // gate the DOCS tab visibility and to drive the smart default
  // (a fresh tab with empty logs and a README opens straight on
  // DOCS so just-cloned projects feel useful from the first click).
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    layout.setIncludeDocs(false);
    ipc
      .discoverProjectDocs(selectedId)
      .then((list) => {
        if (!alive) return;
        const present = list.length > 0;
        layout.setIncludeDocs(present);
        if (present) {
          // Smart default: empty-logs + README → land on DOCS.
          // We resolve the docs tab's owning group to scope the
          // activation; layout activates per-group (a docs tab in
          // a split-off pane shouldn't yank focus from the
          // user's main pane).
          const logsKey = activeCmd ? logKey(selectedId, activeCmd) : '';
          const linesNow = logsKey ? (useAppStore.getState().logs[logsKey]?.lines.length ?? 0) : 0;
          if (linesNow === 0) {
            const docsGroup = findGroupByTab(layout.state.root, 'docs');
            if (docsGroup) layout.activate(docsGroup.id, 'docs');
          }
        }
      })
      .catch((err) => {
        if (!alive) return;
        console.warn('docs: discover probe failed', err);
        layout.setIncludeDocs(false);
      });
    return () => {
      alive = false;
    };
    // We deliberately depend only on `selectedId` so the panel
    // never reshuffles tabs underneath the user mid-session. The
    // panel remounts (`key={service.id}`) when the service tab
    // itself changes, which is the right time to redo discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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

  /**
   * Activate a singleton tab (logs / docs / notes) wherever it
   * currently lives. Used by the toolbar shortcuts and by cross-
   * surface deep-links — those don't know which pane the user
   * happened to drag the tab into, so we resolve the owning group
   * lazily out of the layout tree.
   *
   * For terminals (no fixed id) the caller should go through
   * `layout.ensureTerminal()` instead.
   */
  const activateSingleton = useCallback(
    (tabId: 'logs' | 'docs' | 'notes') => {
      const group = findGroupByTab(layout.state.root, tabId);
      if (group) layout.activate(group.id, tabId);
    },
    [layout],
  );

  // Honour cross-surface "open at this tab" requests. Runs after
  // the docs-discovery effect so a request to land on DOCS for a
  // service that genuinely has docs wins over the docs-tab gating;
  // we consume the request unconditionally to avoid a stale entry
  // re-firing on the next render. Notes is always available, DOCS
  // is gated on `hasDocs` — but we apply the request even if DOCS
  // is requested without docs being discovered yet (the tab strip
  // hides the DOCS button anyway, so the activation is a harmless
  // no-op in that edge case).
  useEffect(() => {
    if (!pendingBodyTabRequest) return;
    if (pendingBodyTabRequest === 'terminal') {
      // Bring an existing terminal forward, or spawn a fresh one
      // in the preferred group — the deep-link doesn't care which.
      layout.ensureTerminal();
    } else if (
      pendingBodyTabRequest === 'logs' ||
      pendingBodyTabRequest === 'docs' ||
      pendingBodyTabRequest === 'notes'
    ) {
      activateSingleton(pendingBodyTabRequest);
    }
    consumePendingBodyTab(serviceId);
  }, [pendingBodyTabRequest, consumePendingBodyTab, serviceId, layout, activateSingleton]);

  // Expose the per-service action surface to the global view-shortcut
  // dispatcher. We register on every mount and unregister on unmount,
  // so only currently-rendered LogPanels can be targeted by the
  // shortcut — a safety net against the dispatcher firing on a
  // service tab that's no longer in the DOM.
  //
  // The handler closes over `layout`, but `layout.ensureTerminal`
  // already pulls fresh state from the reducer ref, so we don't
  // need to re-register on every layout change. Re-registering
  // when only `serviceId` changes keeps the registry key in sync
  // when the same LogPanel instance flips to a different service
  // (which currently doesn't happen, but is defensive against a
  // future panel-recycling optimisation).
  useEffect(() => {
    if (!serviceId) return;
    return registerServiceShortcuts(serviceId, {
      newTerminal: () => {
        layout.ensureTerminal();
      },
    });
  }, [serviceId, layout]);

  // When the user clicks Run on a fenced shell block in DOCS, we
  // jump them to the Terminal body tab (mounting the PTY on first
  // hit via the mount-once latch) and write the command + CR
  // through `ipc.terminalWrite` after a short delay. The delay
  // covers the PTY spawn round-trip — empirically ~250 ms on
  // macOS / Linux / Windows. The terminal pane buffers writes
  // pre-ready, so even if we shave the delay the worst case is
  // a couple of dropped bytes; 250 ms is the conservative pick.
  //
  // We deliberately land the user on the *Terminal* tab now, not
  // Logs: the user explicitly asked to RUN a command in their
  // shell. They want to *see the shell*, type follow-up commands,
  // and watch interactive output (pnpm-style spinners, prompts,
  // colored progress bars) — none of which live in the structured
  // log buffer. Routing to Logs was a leftover from the old design
  // where terminal was a sub-pane of the LOGS body.
  const runDocCommand = useCallback(
    (command: string) => {
      if (!selectedId) return;
      // `ensureTerminal` returns the id of the existing or
      // freshly-spawned terminal. The reducer activates it in its
      // owning pane synchronously, so the user lands on the live
      // shell as soon as the next paint commits.
      const targetId = layout.ensureTerminal();
      if (!targetId) return;
      // Defer the write past the activation so the PTY spawn (if
      // we just allocated one) has time to land — `terminal_write`
      // pre-spawn races onto a missing handle and the bytes are
      // dropped. 250 ms covers the worst-case spawn round-trip
      // (empirically ~150 ms) with margin.
      window.setTimeout(() => {
        const bytes = utf8ToBytes(`${command}\r`);
        void ipc.terminalWrite(targetId, bytes).catch((err) => {
          console.warn('docs: terminal_write failed', err);
        });
      }, 250);
    },
    [selectedId, layout],
  );

  // When a NEW command transitions into the running pipeline —
  // whether via Play All, Restart, or an individual cmd start
  // button — we surface the LOGS tab and focus that command so the
  // user lands directly on its fresh output. This intentionally
  // overrides a manual DOCS pick: kicking off a command is the
  // strongest possible signal that the user wants to watch it run,
  // and silently leaving them on the README would feel like the
  // app swallowed their click. We still leave the LOGS-tab user
  // alone (no command swap) — they're likely tailing one cmd while
  // others churn in the background, and stealing their selection
  // would yank context out from under them.
  //
  // Implementation: derive a stable join-key from the set of
  // running cmd names so the diff effect only re-fires when that
  // set actually changes (not on every status payload), then
  // detect newly-added entries by set difference.
  const runningCmdNames = useMemo(
    () =>
      (status?.commands ?? [])
        .filter((c) => c.status === 'running' || c.status === 'starting')
        .map((c) => c.name),
    [status?.commands],
  );
  const runningCmdKey = useMemo(
    () => runningCmdNames.slice().sort().join('\x1f'),
    [runningCmdNames],
  );
  // We don't want the diff effect to re-run when the user toggles
  // panes; we only care about the running-cmd set. Snapshot the
  // layout's "is logs the active tab in the pane that holds it"
  // status via a ref so changes to the layout reducer don't
  // invalidate the effect.
  const layoutStateRef = useRef(layout.state);
  useEffect(() => {
    layoutStateRef.current = layout.state;
  }, [layout.state]);
  const prevRunningCmdsRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevRunningCmdsRef.current;
    prevRunningCmdsRef.current = runningCmdNames;
    if (runningCmdNames.length === 0) return;
    const prevSet = new Set(prev);
    const newlyRunning = runningCmdNames.find((n) => !prevSet.has(n));
    if (!newlyRunning) return;
    // A fresh command launch is the strongest possible signal the
    // user wants to watch it run. If the LOGS tab isn't the active
    // body in its owning pane, snap focus there so the output
    // becomes immediately visible. Other panes (a terminal split
    // off to the right, say) are deliberately left alone — a
    // command launch shouldn't yank user attention away from a
    // shell they're actively typing into.
    const cur = layoutStateRef.current;
    const logsGroup = findGroupByTab(cur.root, 'logs');
    if (logsGroup && logsGroup.activeTab !== 'logs') {
      setSelectedCmdName(newlyRunning);
      layout.activate(logsGroup.id, 'logs');
    } else if (logsGroup) {
      // Logs is already in front; just swap to the new command.
      setSelectedCmdName(newlyRunning);
    }
    // `runningCmdNames` is captured via closure; the join-key is
    // the actual change-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCmdKey]);

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
    <div className="bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border/70 bg-surface-raised flex shrink-0 flex-col gap-2.5 border-b px-5 py-3">
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
            {/*
              Health badges — mirror the dashboard `ServiceCard` so
              the same scan result the user just clicked on stays
              visible inside the service. Order matches the card's
              chain (Outdated → Audit → License) so the visual
              language is consistent across surfaces.

              The chips read from the same `ProjectOverview` snapshot
              the dashboard does, so:
                • A workspace rescan refreshes both surfaces at once.
                • Cold-start hydration (persisted scans → store)
                  populates this row before the user even sees the
                  dashboard, which is the real fix for "I opened a
                  service tab and the chips were missing for 30s
                  until the scan finished".

              Click semantics are split on purpose: deps + audit
              chips open `ProjectDetailDrawer` (the same triage
              tabs the dashboard uses), while the license chip
              opens the dedicated `LicensePanel` overlay where the
              full per-package table + THIRD-PARTY-NOTICES.md
              generator live. We never duplicate the audit table
              into the license drawer or vice versa — the user
              clicking on the chip is expressing explicit intent
              about which axis they want to triage.
            */}
            {projectMeta && (
              <div className="ml-1 flex items-center gap-1.5">
                {projectMeta.outdated && projectMeta.outdated.total > 0 && (
                  <OutdatedChip
                    outdated={projectMeta.outdated}
                    onClick={() => setDetailTab('outdated')}
                  />
                )}
                {projectMeta.audit &&
                  projectMeta.audit.critical +
                    projectMeta.audit.high +
                    projectMeta.audit.medium +
                    projectMeta.audit.low >
                    0 && (
                    <AuditChip
                      audit={projectMeta.audit}
                      onClick={() => setDetailTab('advisories')}
                    />
                  )}
                {projectMeta.license && licenseContaminationCount(projectMeta.license) > 0 && (
                  <LicenseChip license={projectMeta.license} onClick={() => setLicenseOpen(true)} />
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/*
              Dashboard-visibility quick toggle.

              Why inline (instead of "open the editor → Advanced tab
              → flip a Switch → Save"): the Advanced tab is a
              destination for rare, deliberate config changes
              (path overrides, grace timers, env vars). Burying a
              one-shot visibility toggle behind that ceremony was
              the source of the user complaint — they hit the flag
              often enough that the round-trip felt like
              punishment.
              Inline IconButton means the toggle is one click from
              the place where the user noticed they wanted it
              (currently looking at the service). No editor open,
              no save round-trip, no scroll to find Advanced.

              The button's label flips with the current state so
              the tooltip always describes the OUTCOME of clicking,
              not the current value (Notion / Linear convention).
              Active state mirrors the dashboard's "Hidden" toggle
              chip so a user who's mentally bound `EyeOff = hidden`
              from the dashboard reads the same here.
            */}
            <IconButton
              label={service.hide_dashboard ? 'Show on dashboard' : 'Hide from dashboard'}
              icon={service.hide_dashboard ? <EyeOff /> : <Eye />}
              size="sm"
              onClick={() => {
                void ipc
                  .updateService({
                    ...service,
                    hide_dashboard: !service.hide_dashboard,
                  })
                  .catch((err) => {
                    console.warn('updateService(hide_dashboard) failed', err);
                  });
              }}
            />
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
            {/*
              The toolbar Terminal button used to be the sole way to
              spawn a shell for a service. It became redundant once
              the layout grew its own "+ New Terminal" button in
              every group's tab strip *and* a global `Cmd/Ctrl+\``
              shortcut — three entry points for the same action just
              meant a noisier toolbar. The shortcut + tab strip pair
              covers the muscle memory case (keyboard) and the
              discoverability case (mouse) without this button
              taking up real estate next to Ports.
            */}

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

      {/*
        Recursive split layout. Owns the per-service tab tree, the
        drag-and-drop reorder/split mechanics, and the slot
        registry that tells us where each tab body should be
        portaled to. Body content itself is rendered below — see
        the `bodySlots`-driven block — so that moving a tab
        between panes is a pure DOM relocation without remounting
        the underlying PTY / xterm / markdown renderer.
      */}
      <ServiceLayout
        layout={layout}
        onSlotRef={onSlotRef}
        onAddTerminalToEmpty={(groupId) => layout.addTerminal(groupId)}
      />

      {/*
        Tab body host layer. One `<TabBodyHost>` per tab in the
        layout state — each portals its body into whichever slot
        ServiceLayout has registered for it. When a tab is dragged
        between panes, ServiceLayout swaps the slot's DOM node, the
        portal target updates, and the body content (terminal,
        xterm log view, markdown renderer, …) physically relocates
        without unmounting the React subtree. PTYs survive,
        scrollback survives, the user just sees the panel slide
        across the screen.
      */}
      {Object.values(layout.state.tabs).map((tab) => {
        const slot = bodySlots.get(tab.id);
        if (!slot) return null;
        return (
          <TabBodyHost
            key={tab.id}
            tab={tab}
            slot={slot}
            // Logs body deps
            selectedId={selectedId}
            cwd={service.cwd}
            serviceName={service.name}
            activeCmd={activeCmd}
            activeCmdEntry={activeCmdEntry}
            filtered={filtered}
            allLogs={logs}
            logK={logK}
            showTimestamp={showTimestamp}
            setShowTimestamp={setShowTimestamp}
            follow={follow}
            setFollow={setFollow}
            isDark={isDark}
            handleLineContextMenu={handleLineContextMenu}
            clearLogsLocal={clearLogsLocal}
            // Docs deps
            onRunCommand={runDocCommand}
          />
        );
      })}
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
      {/*
        License compliance overlay — same component the dashboard
        chip opens. Lazy because the panel pulls in the full
        per-package table + THIRD-PARTY-NOTICES generator (~30 KB
        gzipped); a session that never opens it pays nothing.
      */}
      {licenseOpen && (
        <Drawer onClose={() => setLicenseOpen(false)} ariaLabel="License compliance" size="lg">
          <Suspense fallback={<div className="text-fg-dim p-4 text-[12px]">Loading…</div>}>
            <LicensePanel
              serviceId={service.id}
              serviceName={service.name}
              onClose={() => setLicenseOpen(false)}
            />
          </Suspense>
        </Drawer>
      )}
      {/*
        Project triage drawer (Outdated / Advisories tabs) — opened
        by the deps + audit chips above. Mirrors the dashboard's
        per-card drawer behaviour: same component, same tabs,
        same rescan affordance, just mounted inside the per-service
        panel instead of the dashboard root.
      */}
      {detailTab && projectMeta && (
        <ProjectDetailDrawer
          project={projectMeta}
          initialTab={detailTab}
          scanning={overviewScanning}
          lastScanAt={lastScanAt}
          onRescan={() => void runWorkspaceScan()}
          onClose={() => setDetailTab(null)}
          onJump={(id) => {
            setDetailTab(null);
            useAppStore.getState().setSelected(id);
          }}
          editors={editors}
          onOpenPath={(path) => void ipc.openPath(path)}
          onOpenUrl={(url) => void ipc.openUrl(url)}
          onOpenInEditor={async (command, path) => {
            try {
              await ipc.openInEditor(command, path);
            } catch {
              // Fallback so the click is never a dead-end — if
              // the editor isn't installed or returns an error,
              // at least surface the folder in the OS file
              // browser. Silent failure here is what made the
              // dashboard version of this prompt feel broken
              // before the fallback was added.
              await ipc.openPath(path);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Renders the body for a single tab into the DOM node that
 * `ServiceLayout` registered for it. Each kind has its own body
 * (logs view, docs renderer, notes editor, terminal pane); we
 * dispatch on `tab.kind` and portal the result.
 *
 * Mount stability: as long as a tab stays in the layout tree
 * (i.e. the user hasn't closed it), this host stays mounted.
 * Switching active tabs in a pane just toggles the slot's
 * `visibility:hidden`, which doesn't unmount the body. Dragging
 * a tab to another pane changes the portal target's DOM identity
 * but the React subtree underneath this host doesn't reconcile
 * with a remount — `createPortal` reparents the host's children
 * into the new target without disturbing them. Net result: a
 * `terminal` tab can be split, dragged across panes, made
 * inactive and re-activated all without losing its PTY.
 */
function TabBodyHost(props: {
  tab: LayoutTab;
  slot: HTMLDivElement;
  // Logs deps
  selectedId: string;
  cwd: string;
  serviceName: string;
  activeCmd: string | null;
  activeCmdEntry: { name: string; cmd: string } | null;
  filtered: LogLine[];
  allLogs: LogLine[];
  logK: string;
  showTimestamp: boolean;
  setShowTimestamp: (v: boolean) => void;
  follow: boolean;
  setFollow: (v: boolean) => void;
  isDark: boolean;
  handleLineContextMenu: (index: number) => void;
  clearLogsLocal: (key: string) => void;
  // Docs deps
  onRunCommand: (command: string) => void;
}) {
  const {
    tab,
    slot,
    selectedId,
    cwd,
    serviceName,
    activeCmd,
    activeCmdEntry,
    filtered,
    allLogs,
    logK,
    showTimestamp,
    setShowTimestamp,
    follow,
    setFollow,
    isDark,
    handleLineContextMenu,
    clearLogsLocal,
    onRunCommand,
  } = props;

  let body: React.ReactNode = null;
  switch (tab.kind) {
    case 'logs':
      body = (
        <div className="relative flex min-h-0 flex-1 flex-col">
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
                · {filtered.length.toLocaleString()} / {allLogs.length.toLocaleString()} lines
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
          <div className="flex-1 overflow-hidden px-6">
            <LogXtermView
              key={`${selectedId}::${activeCmd ?? '__none__'}`}
              lines={filtered}
              totalLogs={allLogs.length}
              showTimestamp={showTimestamp}
              follow={follow}
              isDark={isDark}
              onLineContextMenu={handleLineContextMenu}
            />
          </div>
        </div>
      );
      break;
    case 'docs':
      body = (
        <Suspense
          fallback={
            <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
              Loading docs…
            </div>
          }
        >
          <ProjectDocsTab serviceId={selectedId} cwd={cwd} onRunCommand={onRunCommand} />
        </Suspense>
      );
      break;
    case 'notes':
      body = (
        <Suspense
          fallback={
            <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
              Loading notes…
            </div>
          }
        >
          <ProjectNotesTab serviceId={selectedId} serviceName={serviceName} />
        </Suspense>
      );
      break;
    case 'terminal':
      body = (
        <div className="bg-surface-muted relative flex min-h-0 flex-1 flex-col">
          <TerminalPane id={tab.id} cwd={cwd} />
        </div>
      );
      break;
  }

  return createPortal(body, slot);
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
