import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { UpdateBanner } from '@/components/UpdateBanner';
import { SidebarRail } from '@/components/SidebarRail';
import { LogPanel } from '@/components/LogPanel';
import { PortManager } from '@/components/PortManager';
import { Dashboard } from '@/components/dashboard';
import { ServiceEditor } from '@/components/ServiceEditor';
import { StackEditor } from '@/components/StackEditor';
import { StackDetail } from '@/components/StackDetail';
import { ScanDialog } from '@/components/ScanDialog';
import { ShortcutSettings } from '@/components/ShortcutSettings';
import { ResizeHandles } from '@/components/ResizeHandles';
import { StatusBar } from '@/components/StatusBar';
import { TitleBar } from '@/components/TitleBar';
import { WelcomeTour } from '@/components/WelcomeTour';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { DiffViewer } from '@/components/DiffViewer';
import { CrossProjectDiffViewer } from '@/components/CrossProjectDiffViewer';
import { useAppStore, logKey } from '@/store/useAppStore';
import { events, ipc } from '@/lib/ipc';
import { hasSeenTour, hasSeenTrayHint, markTrayHintSeen } from '@/lib/onboarding';
import { useContextMenu } from '@/lib/context-menu';

export default function App() {
  const selectedServiceId = useAppStore((s) => s.selectedServiceId);
  const selectedStackId = useAppStore((s) => s.selectedStackId);
  const setServices = useAppStore((s) => s.setServices);
  const setStatus = useAppStore((s) => s.setStatus);
  const appendLog = useAppStore((s) => s.appendLog);
  const setPorts = useAppStore((s) => s.setPorts);
  const setResources = useAppStore((s) => s.setResources);
  const setAppMeta = useAppStore((s) => s.setAppMeta);
  const setEditors = useAppStore((s) => s.setEditors);
  const setSelected = useAppStore((s) => s.setSelected);
  const editorService = useAppStore((s) => s.editorService);
  const openEditor = useAppStore((s) => s.openEditor);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const editorStack = useAppStore((s) => s.editorStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const closeStackEditor = useAppStore((s) => s.closeStackEditor);
  const setStacks = useAppStore((s) => s.setStacks);
  const timelineOpen = useAppStore((s) => s.timelineOpen);
  const closeTimeline = useAppStore((s) => s.closeTimeline);
  const diffViewerOpen = useAppStore((s) => s.diffViewerOpen);
  const diffViewerServiceId = useAppStore((s) => s.diffViewerServiceId);
  const closeDiffViewer = useAppStore((s) => s.closeDiffViewer);
  const crossProjectDiffOpen = useAppStore((s) => s.crossProjectDiffOpen);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);

  const [scanPath, setScanPath] = useState<string | null>(null);
  const [portManagerOpen, setPortManagerOpen] = useState(false);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  // When the quick-action palette opens over the top of the running app, we
  // dim the main window so the floating palette reads as a modal layer rather
  // than something floating in mid-air. Rust only emits `palette-opened`
  // while the main window is actually visible, so hitting the global
  // shortcut from another app won't leave a ghost backdrop behind when the
  // user later brings RunHQ forward.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // `tourState.reopened` differentiates the automatic first-run flow from a
  // user-triggered replay (e.g. from the Settings panel). The reopened branch
  // hides the "Skip tour" affordance because the user explicitly asked for it.
  const [tourState, setTourState] = useState<{ open: boolean; reopened: boolean }>(() => ({
    open: !hasSeenTour(),
    reopened: false,
  }));

  // Wrapped in useCallback so the quick-action event listener effect below
  // doesn't tear down and re-register every render — `setScanPath` is stable,
  // so this callback identity is effectively permanent.
  const startScan = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') setScanPath(picked);
  }, []);

  const contextItems = useCallback(
    (): Array<{ label: string; action?: () => void; separator?: boolean; shortcut?: string }> => [
      { label: 'New Service…', action: () => openEditor(null), shortcut: '⌘N' },
      { label: 'New Stack…', action: () => openStackEditor(null) },
      { label: 'Scan Projects…', action: startScan },
      { separator: true, label: '' },
      {
        label: 'Reload',
        action: () => window.location.reload(),
      },
    ],
    [openEditor, openStackEditor, startScan],
  );
  const { menu: contextMenu } = useContextMenu(contextItems);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, info] = await Promise.all([ipc.listServices(), ipc.appInfo()]);
        if (cancelled) return;
        setServices(list);
        setAppMeta(info.version, info.state_dir);
        const [detected, stackList] = await Promise.all([ipc.detectEditors(), ipc.listStacks()]);
        if (!cancelled) {
          setEditors(detected);
          setStacks(stackList);
          const autoStartStacks = stackList.filter((s) => s.auto_start);
          for (const stack of autoStartStacks) {
            ipc.startStack(stack.id).catch(() => {});
          }
        }
      } catch (err) {
        console.error('initial load failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time effect; store setters are stable
  }, []);

  // Tracks the last LIFECYCLE state we recorded per service so repeated
  // `onStatus` emissions (multi-command services emit one status tick per
  // command transition) don't produce duplicate timeline events.
  const lastLifecycleRef = useRef<Record<string, 'started' | 'stopped' | 'crashed'>>({});
  // Belt-and-suspenders time-based guard. If the same (service, lifecycle)
  // pair was already recorded within this window, we drop the duplicate.
  // Protects against:
  //   1. Rust-side double-emit (e.g. a future refactor that adds a status
  //      tick we didn't anticipate — aggregate Running fired twice back to
  //      back).
  //   2. React 18 StrictMode async-effect race that can leak the *previous*
  //      subscription when cleanup runs before the first `await listen`
  //      resolves, leading to two active listeners receiving the same event.
  //      The `ref`-based dedup already catches synchronous duplicate
  //      delivery, but some IPC transports schedule listeners via
  //      microtasks / postMessage and the two handlers can end up in
  //      separate ticks — long enough for both to pass the `prev !== cur`
  //      check before either updates the ref. The time guard closes that.
  const lastLifecycleTsRef = useRef<Record<string, number>>({});
  const LIFECYCLE_DEDUP_MS = 1500;

  // Per-service "current event bucket id" used only to stamp DB-recorded
  // child events (log_error / log_warning) so they can be rolled up under
  // the owning lifecycle row in the timeline.
  //
  // Semantics by lifecycle:
  //   - `started`  → take the id straight from Rust's `status.run_id`. The
  //                  supervisor mints it BEFORE spawning any process, so
  //                  the same id is already stamped on the `$ <cmd>` echo
  //                  and every subsequent stdout/stderr line. Using it on
  //                  the frontend side gives us a single, authoritative
  //                  correlation key — no mint-on-arrival, no timestamp
  //                  windowing, no IPC-jitter fragility.
  //   - `stopped`/`crashed` → Rust has already cleared its run id by the
  //                  time we see this status (the last command's exit is
  //                  what *produced* the transition). We mint a local id
  //                  here purely to give those lifecycle rows their own
  //                  bucket so any post-stop diagnostics surface under
  //                  Stop rather than silently merging into the prior Run.
  const runIdsRef = useRef<Record<string, string>>({});

  const makeRunId = useCallback(() => {
    // `crypto.randomUUID` is available in every modern webview Tauri targets;
    // fall back to a timestamp-based id if the API is somehow missing so we
    // never silently break the correlation.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  useEffect(() => {
    // StrictMode-safe subscription pattern.
    //
    // The naive version — `unsubs.push(await events.onStatus(…))` inside a
    // fire-and-forget IIFE — has a subtle race in React 18 dev StrictMode:
    // the effect runs → cleanup runs → effect runs again. If the first
    // `await listen()` hasn't resolved by the time cleanup runs, the first
    // subscription's unlisten never makes it into `unsubs`, the cleanup
    // walks an empty array, and the first listener leaks. The re-mount
    // then establishes a *second* listener, so every future
    // `service://status` event fires both handlers. That's exactly the
    // "two Started events for one start" symptom.
    //
    // Fix: check `cancelled` after each await and immediately drop the
    // just-registered listener if the effect has already torn down. This
    // keeps at most one live subscription per channel at all times.
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const register = (unlisten: () => void) => {
      if (cancelled) {
        unlisten();
      } else {
        unsubs.push(unlisten);
      }
    };
    (async () => {
      register(
        await events.onStatus((status) => {
          setStatus(status);

          // Map the supervisor's 6-state machine down to three timeline
          // lifecycle buckets. Note: when the user stops a service the
          // aggregate settles to `exited` (commands reported Outcome::Exited
          // or ::Killed → Status::Exited), NOT `stopped` — that's only the
          // initial/never-started state. Both need to count as "Stopped".
          const lifecycle: 'started' | 'stopped' | 'crashed' | null =
            status.status === 'running'
              ? 'started'
              : status.status === 'exited' || status.status === 'stopped'
                ? 'stopped'
                : status.status === 'crashed'
                  ? 'crashed'
                  : null;

          if (!lifecycle) return;

          const prev = lastLifecycleRef.current[status.id];
          // Skip duplicate transitions (e.g. two `exited` ticks in a row as
          // separate commands wind down) — we already recorded this state.
          if (prev === lifecycle) return;
          // Don't log a synthetic "Stopped" / "Crashed" event on app boot
          // when we see a service's initial state for the very first time.
          // Only real transitions (from a previously-seen state) deserve a
          // timeline entry; the baseline is silent.
          if (prev === undefined && lifecycle !== 'started') {
            lastLifecycleRef.current[status.id] = lifecycle;
            lastLifecycleTsRef.current[status.id] = Date.now();
            return;
          }
          // Second line of defense: even if `prev` got reset somehow (new
          // subscription from a StrictMode re-mount, etc.), drop any event
          // that duplicates the most recent lifecycle for this service
          // within a short window. Different lifecycles in rapid succession
          // (e.g. crashed → started on auto-restart) are legitimate and
          // pass through because we key the timestamp by service only;
          // what we're blocking is N copies of the *same* status.
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

          // ── Event bucket correlation ──────────────────────────────────
          // Prefer the run id that Rust has already stamped on every log
          // line of this run (see `Supervisor::start_all`). For Started
          // events it WILL be present — the supervisor inserts it before
          // `start_one` emits the shell-prompt echo. For Stopped/Crashed
          // the supervisor has already cleared it (the run is over), so
          // we mint a fresh local id for that bucket.
          const runId = lifecycle === 'started' && status.run_id ? status.run_id : makeRunId();
          runIdsRef.current[status.id] = runId;

          const svc = useAppStore.getState().services.find((s) => s.id === status.id);
          const name = svc?.name ?? status.id;
          const cmds = status.commands ?? [];

          // Include command names in the description so the timeline is
          // actually informative for multi-command services ("Stopped api —
          // migrate (0), server (143)" beats a bare "Stopped api").
          let description = '';
          let eventType: 'service_started' | 'service_stopped' | 'service_crashed';
          if (lifecycle === 'started') {
            eventType = 'service_started';
            const running = cmds.filter((c) => c.status === 'running').map((c) => c.name);
            const names = running.length > 0 ? running : cmds.map((c) => c.name);
            description =
              names.length > 0 ? `Started ${name} — ${names.join(', ')}` : `Started ${name}`;
          } else if (lifecycle === 'stopped') {
            eventType = 'service_stopped';
            const parts = cmds.map((c) => {
              const code = c.exit_code != null ? ` (${c.exit_code})` : '';
              return `${c.name}${code}`;
            });
            description =
              parts.length > 0 ? `Stopped ${name} — ${parts.join(', ')}` : `Stopped ${name}`;
          } else {
            eventType = 'service_crashed';
            const failed = cmds
              .filter((c) => c.status === 'crashed' || c.error)
              .map((c) => {
                const err = c.error ? `: ${c.error}` : '';
                return `${c.name}${err}`;
              });
            description =
              failed.length > 0 ? `Crashed ${name} — ${failed.join('; ')}` : `Crashed ${name}`;
          }

          ipc
            .recordTimelineEvent(eventType, status.id, svc?.name ?? null, description, runId)
            .catch(() => {});
        }),
      );
      register(
        await events.onLog((ev) => {
          appendLog(logKey(ev.service_id, ev.cmd_name), ev.line);
          if (ev.line.stream === 'stderr') {
            const text = ev.line.text.toLowerCase();
            const isWarning = text.includes('warn') || text.includes('warning');
            const isError =
              text.includes('error') || text.includes('fatal') || text.includes('panic');
            if (isError || isWarning) {
              const svc = useAppStore.getState().services.find((s) => s.id === ev.service_id);
              // Attach the log to whatever run is currently open for this
              // service. If it's null (e.g. stderr arriving between `stopped`
              // and the next `started`, or before we ever saw a `started`
              // for this service), the log goes in ungrouped — which is
              // correct; there's no parent to collapse it into.
              const runId = runIdsRef.current[ev.service_id] ?? null;
              // Preserve enough context for the timeline detail view to actually
              // show the useful part of a stack trace / error body, not just
              // the first 200 chars which usually cut off mid-message.
              ipc
                .recordTimelineEvent(
                  isError ? 'log_error' : 'log_warning',
                  ev.service_id,
                  svc?.name ?? null,
                  ev.line.text.slice(0, 1500),
                  runId,
                )
                .catch(() => {});
            }
          }
        }),
      );
      register(
        await events.onResources((ev) =>
          setResources(ev.service_id, {
            cpu_percent: ev.cpu_percent,
            memory_bytes: ev.memory_bytes,
          }),
        ),
      );
    })();
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [setStatus, appendLog, setResources, makeRunId]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const ports = await ipc.listPorts();
        if (alive) setPorts(ports);
      } catch (err) {
        console.error('list_ports failed', err);
      }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setPorts]);

  // Cross-project overview polling — drives the dashboard's Stale / Risk /
  // Outdated pills and per-card chips. 30s cadence is deliberate: git status
  // + last-commit lookups shell out per project, and the UI doesn't need
  // sub-second freshness for "is this project stale?". The Rust side also
  // caches dependency-scan output (5 min TTL), so an explicit "Scan
  // dependencies" click is what actually refreshes audit/outdated numbers.
  useEffect(() => {
    const store = useAppStore.getState();
    let alive = true;
    const poll = async () => {
      try {
        store.setOverviewLoading(true);
        const data = await ipc.getProjectOverview(30);
        if (alive) store.setOverview(data);
      } catch (err) {
        console.error('get_project_overview failed', err);
      } finally {
        if (alive) store.setOverviewLoading(false);
      }
    };
    void poll();
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(
        await listen('runhq://palette-opened', () => {
          setPaletteOpen(true);
        }),
      );
      unsubs.push(
        await listen('runhq://palette-closed', () => {
          setPaletteOpen(false);
        }),
      );
      unsubs.push(
        await listen<{ serviceId: string; openTerminal?: boolean }>(
          'quick-action://navigate',
          (e) => {
            setSelected(e.payload.serviceId);
          },
        ),
      );
      unsubs.push(
        await listen('quick-action://scan', () => {
          startScan();
        }),
      );
      unsubs.push(
        await listen('quick-action://shortcuts', () => {
          setShortcutSettingsOpen(true);
        }),
      );
      unsubs.push(
        await listen<string>('runhq://tray-action', (e) => {
          switch (e.payload) {
            case 'new-service':
              openEditor(null);
              break;
            case 'new-stack':
              openStackEditor(null);
              break;
            case 'scan':
              startScan();
              break;
          }
        }),
      );
    })();
    return () => unsubs.forEach((u) => u());
  }, [setSelected, startScan, openEditor, openStackEditor]);

  // One-time "still running in your menu bar" hint.
  //
  // Rust emits `runhq://main-will-hide` the moment the user closes the
  // window (we intercept CloseRequested and hide instead of quitting). We
  // show our own in-app banner — a tiny transparent, always-on-top webview
  // anchored to the top-right of the current monitor — because a real
  // `UserNotifications` toast requires a permission prompt that makes new
  // users feel the app is asking for too much on first run.
  //
  // The `tray-hint` webview is pre-warmed during Rust setup, so the
  // `show_tray_hint` IPC resolves instantly.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen('runhq://main-will-hide', () => {
        if (hasSeenTrayHint()) return;
        markTrayHintSeen();
        // Let the hide animation start first — the banner appearing at the
        // exact same frame the main window disappears feels synthetic.
        window.setTimeout(() => {
          ipc.showTrayHint().catch((err) => {
            console.error('show_tray_hint failed', err);
          });
        }, 180);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // In-app ⌘/Ctrl + K → same floating Quick Action window as the OS-wide
  // shortcut and the titlebar trigger. We prefer the plain chord (no Shift)
  // inside the app because users' hands are already on the main window;
  // ⌘/Ctrl + Shift + K remains the OS-wide summon from other apps.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        // Don't swallow the chord while the user is editing a form field —
        // ⌘K has no browser default there, but this keeps future input
        // widgets (rich editors, command palettes) free to own it.
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        e.preventDefault();
        void ipc.showQuickAction().catch((err) => console.error('show_quick_action failed', err));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="bg-surface text-fg relative flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <main className="flex min-w-0 flex-1 flex-col">
          {selectedServiceId != null ? (
            <LogPanel />
          ) : selectedStackId != null ? (
            <StackDetail />
          ) : (
            <Dashboard onScan={startScan} />
          )}
        </main>
      </div>

      <UpdateBanner />

      <StatusBar
        onOpenPortManager={() => setPortManagerOpen(true)}
        onOpenShortcutSettings={() => setShortcutSettingsOpen(true)}
      />

      {editorService !== undefined && (
        <ServiceEditor service={editorService} onClose={closeEditor} />
      )}
      {editorStack !== undefined && <StackEditor stack={editorStack} onClose={closeStackEditor} />}
      {scanPath && <ScanDialog path={scanPath} onClose={() => setScanPath(null)} />}
      {portManagerOpen && <PortManager onClose={() => setPortManagerOpen(false)} />}
      {shortcutSettingsOpen && (
        <ShortcutSettings
          onClose={() => setShortcutSettingsOpen(false)}
          onReplayTour={() => {
            setShortcutSettingsOpen(false);
            setTourState({ open: true, reopened: true });
          }}
        />
      )}
      {timelineOpen && <ActivityTimeline onClose={closeTimeline} />}
      {diffViewerOpen && diffViewerServiceId && (
        <DiffViewer serviceId={diffViewerServiceId} onClose={closeDiffViewer} />
      )}
      {crossProjectDiffOpen && <CrossProjectDiffViewer onClose={closeCrossProjectDiff} />}
      {tourState.open && (
        <WelcomeTour
          reopened={tourState.reopened}
          onClose={() => setTourState({ open: false, reopened: false })}
        />
      )}
      <ResizeHandles />

      {paletteOpen && (
        <div
          aria-hidden
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] transition-opacity duration-150"
          onClick={() => void ipc.hideQuickAction().catch(() => {})}
        />
      )}
      {contextMenu}
    </div>
  );
}
