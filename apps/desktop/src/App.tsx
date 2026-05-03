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
import { MainTabBar } from '@/components/MainTabBar';
import { ScanDialog } from '@/components/ScanDialog';
import { SettingsView } from '@/components/settings/SettingsView';
import { AiSettings } from '@/components/AiSettings';
import { RightActivityBar } from '@/components/RightActivityBar';
import { RightSidePanel } from '@/components/RightSidePanel';
import { ResizeHandles } from '@/components/ResizeHandles';
import { StatusBar } from '@/components/StatusBar';
import { TitleBar } from '@/components/TitleBar';
import { WelcomeTour } from '@/components/WelcomeTour';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { ReleaseNotes } from '@/components/ReleaseNotes';
import { DiffViewer } from '@/components/DiffViewer';
import { CrossProjectDiffViewer } from '@/components/CrossProjectDiffViewer';
import { useAppStore, logKey, mainTabKey } from '@/store/useAppStore';
import { events, ipc } from '@/lib/ipc';
import { hasSeenTour, hasSeenTrayHint, markTrayHintSeen } from '@/lib/onboarding';
import { useContextMenu } from '@/lib/context-menu';
import { useUiZoomShortcuts } from '@/lib/ui-zoom';
import { useViewShortcuts, type ViewShortcutHandlers } from '@/lib/useViewShortcuts';
import { getServiceShortcuts } from '@/lib/serviceShortcutBus';
import { getLatestRelease, shouldAutoShow } from '@/lib/whatsnew';
import type { Shortcuts } from '@/types';

export default function App() {
  const mainTabs = useAppStore((s) => s.mainTabs);
  const activeMainTabKey = useAppStore((s) => s.activeMainTabKey);
  const setServices = useAppStore((s) => s.setServices);
  const setStatus = useAppStore((s) => s.setStatus);
  const appendLog = useAppStore((s) => s.appendLog);
  const setPorts = useAppStore((s) => s.setPorts);
  const setResources = useAppStore((s) => s.setResources);
  const setAppMeta = useAppStore((s) => s.setAppMeta);
  const setEditors = useAppStore((s) => s.setEditors);
  const setSelected = useAppStore((s) => s.setSelected);
  const openServiceWithBodyTab = useAppStore((s) => s.openServiceWithBodyTab);
  const editorService = useAppStore((s) => s.editorService);
  const openEditor = useAppStore((s) => s.openEditor);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const editorStack = useAppStore((s) => s.editorStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const closeStackEditor = useAppStore((s) => s.closeStackEditor);
  const setStacks = useAppStore((s) => s.setStacks);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const diffViewerOpen = useAppStore((s) => s.diffViewerOpen);
  const diffViewerServiceId = useAppStore((s) => s.diffViewerServiceId);
  const closeDiffViewer = useAppStore((s) => s.closeDiffViewer);
  const crossProjectDiffOpen = useAppStore((s) => s.crossProjectDiffOpen);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);
  const appVersion = useAppStore((s) => s.appVersion);
  const whatsNewOpen = useAppStore((s) => s.whatsNewOpen);
  const whatsNewVersion = useAppStore((s) => s.whatsNewVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const closeWhatsNew = useAppStore((s) => s.closeWhatsNew);
  const releaseNotesOpen = useAppStore((s) => s.releaseNotesOpen);
  // Settings lives in the store now (it's a fullscreen page on the
  // canvas, not a modal) so the same render-precedence rules that
  // gate Release Notes apply: if Settings is open, every other
  // main-area surface is hidden underneath. The slot doubles as the
  // "active category" so deep-linking from anywhere is just
  // `openSettings('ai')`.
  const settingsCategory = useAppStore((s) => s.settingsCategory);
  const openSettings = useAppStore((s) => s.openSettings);

  const [scanPath, setScanPath] = useState<string | null>(null);
  const [portManagerOpen, setPortManagerOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  // Cross-component bridge for opening AI Settings without prop-
  // drilling. Surfaces like the chat composer's model pill — which
  // live deep inside `RightSidePanel` — fire `runhq:open-ai-settings`
  // and we react here. Window-level CustomEvent keeps the chat
  // panel decoupled from App's local state shape; the alternative
  // (lifting `aiSettingsOpen` into Zustand) would touch a much larger
  // store API surface for what is effectively a pub/sub edge.
  useEffect(() => {
    const onOpen = () => setAiSettingsOpen(true);
    window.addEventListener('runhq:open-ai-settings', onOpen);
    return () => window.removeEventListener('runhq:open-ai-settings', onOpen);
  }, []);
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
      { label: 'Discover projects…', action: startScan },
      { separator: true, label: '' },
      {
        label: 'Reload',
        action: () => window.location.reload(),
      },
    ],
    [openEditor, openStackEditor, startScan],
  );
  const { menu: contextMenu } = useContextMenu(contextItems);
  useUiZoomShortcuts();

  // ---- View shortcut wiring -------------------------------------------------
  //
  // Load the user's bindings once (and re-load whenever the settings
  // page closes, so a save round-trips into the dispatcher without
  // a restart). Globals (`quick_action`, `focus_main`) are owned by
  // the Tauri global-shortcut plugin and are not handled here —
  // those still need an app restart to re-register with the OS,
  // which is documented in the settings page.
  const [viewShortcuts, setViewShortcuts] = useState<Shortcuts | null>(null);
  useEffect(() => {
    if (settingsCategory !== null) return; // skip while the user is editing
    let cancelled = false;
    ipc
      .getPrefs()
      .then((p) => {
        if (cancelled) return;
        setViewShortcuts(p.shortcuts ?? null);
      })
      .catch(() => {
        // A failed prefs read just leaves us on whatever bindings
        // we already had (or the defaults baked into `useViewShortcuts`).
      });
    return () => {
      cancelled = true;
    };
  }, [settingsCategory]);

  const toggleSidebarPinned = useAppStore((s) => s.toggleSidebarPinned);
  const closeMainTab = useAppStore((s) => s.closeMainTab);
  const setActiveMainTab = useAppStore((s) => s.setActiveMainTab);

  const viewHandlers: ViewShortcutHandlers = {
    toggle_left_sidebar: () => toggleSidebarPinned(),
    toggle_ai_panel: () => toggleRightPanel('ai'),
    toggle_activity_panel: () => toggleRightPanel('activity'),
    new_terminal: () => {
      // Delegate to the active service's LogPanel via the registry.
      // If the active main tab is the dashboard / a non-service tab
      // there's simply nothing to spawn into — silently no-op rather
      // than firing on a stale "last selected service" id, which
      // would feel like the wrong window opened a terminal.
      const state = useAppStore.getState();
      const active = state.mainTabs.find((t) => mainTabKey(t) === state.activeMainTabKey);
      if (!active || active.kind !== 'service') return;
      const handlers = getServiceShortcuts(active.refId);
      handlers?.newTerminal();
    },
    next_main_tab: () => {
      const state = useAppStore.getState();
      const tabs = state.mainTabs;
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => mainTabKey(t) === state.activeMainTabKey);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % tabs.length;
      const target = tabs[nextIdx];
      if (target) setActiveMainTab(mainTabKey(target));
    },
    prev_main_tab: () => {
      const state = useAppStore.getState();
      const tabs = state.mainTabs;
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => mainTabKey(t) === state.activeMainTabKey);
      const prevIdx = idx <= 0 ? tabs.length - 1 : idx - 1;
      const target = tabs[prevIdx];
      if (target) setActiveMainTab(mainTabKey(target));
    },
    close_main_tab: () => {
      const state = useAppStore.getState();
      const key = state.activeMainTabKey;
      // Dashboard is sticky; closeMainTab already no-ops on it but
      // we short-circuit here to avoid the ineffectual side trip
      // through the reducer.
      if (key && key !== 'dashboard') closeMainTab(key);
    },
  };

  // We intentionally don't memoise `viewHandlers`: every render
  // produces a fresh object, but `useViewShortcuts` stashes the
  // latest value in a ref *without* re-binding the listener, so the
  // perf cost is one Map allocation per render. That's cheaper than
  // chasing the stable-identity dance for seven small closures.
  useViewShortcuts(viewShortcuts, viewHandlers);

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
  //
  // On the very first call we ALSO hydrate the persisted scan rows from
  // SQLite so the per-card "Last scanned 3h ago" chip lights up
  // immediately — without this, post-restart the dashboard renders
  // empty audit chips and "Never scanned" badges for every project
  // until someone hits Rescan, even though we have last night's data
  // sitting on disk.
  useEffect(() => {
    const store = useAppStore.getState();
    let alive = true;

    // Fire-and-forget hydration before the first poll so the chips
    // can render alongside the overview rather than after. Errors
    // are non-fatal: a missing / corrupt scan history just falls
    // back to "no scan yet" which is the existing behaviour.
    void (async () => {
      try {
        const rows = await ipc.listPersistedScans();
        if (alive) useAppStore.getState().hydratePersistedScans(rows);
      } catch (err) {
        console.error('list_persisted_scans failed', err);
      }
    })();

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
            // Honour the optional `openTerminal` flag emitted by the
            // Quick Action's "Open Terminal" sub-action. Previously
            // we ignored it, which made that menu item silently
            // identical to a plain "Open service" — confusing and
            // inconsistent with the row's icon + label.
            //
            // Routing through `openServiceWithBodyTab('terminal')`
            // (instead of an ad-hoc state poke) reuses the same
            // atomic store transition the dashboard's Notes shortcut
            // uses: the main tab is selected AND the body-tab deep
            // link is stamped in a single `set` call, so the
            // LogPanel's mount-time effect picks it up without a
            // race against the default `mainTab='logs'`.
            if (e.payload.openTerminal) {
              openServiceWithBodyTab(e.payload.serviceId, 'terminal');
            } else {
              setSelected(e.payload.serviceId);
            }
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
          openSettings('shortcuts');
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
  }, [setSelected, openServiceWithBodyTab, startScan, openEditor, openStackEditor, openSettings]);

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

  // "What's New" auto-trigger.
  //
  // Fires once per (running, lastSeen) version pair, after the modal
  // chain ahead of it has settled:
  //   1. WelcomeTour comes first on a fresh install — we never want to
  //      stack the highlights modal on top of the onboarding flow, so
  //      we only fire when `tourState.open === false` AND the user has
  //      genuinely seen the tour at some point (`hasSeenTour()`). On
  //      first-ever launch the trigger reaches the "no last-seen"
  //      branch in `shouldAutoShow` and silently records a baseline
  //      instead of popping a modal — see the rule in trigger.ts.
  //   2. A small post-mount delay lets the dashboard / sidebar paint
  //      first; otherwise the modal can render before there's any
  //      visible UI behind it, which feels like a launcher screen
  //      rather than a release announcement.
  // The cleanup clears the timer if the dependencies change before it
  // fires (e.g. user opens the tour replay, which re-opens it
  // mid-sequence) so we never end up firing for a stale snapshot.
  useEffect(() => {
    if (!appVersion) return;
    if (tourState.open) return;
    if (!hasSeenTour()) return;
    const release = shouldAutoShow(appVersion, getLatestRelease());
    if (!release) return;
    const id = window.setTimeout(() => {
      openWhatsNew(release.version);
    }, 600);
    return () => window.clearTimeout(id);
  }, [appVersion, tourState.open, openWhatsNew]);

  // In-app ⌘/Ctrl + K → same floating Quick Action window as the OS-wide
  // shortcut and the titlebar trigger. We prefer the plain chord (no Shift)
  // inside the app because users' hands are already on the main window;
  // ⌘/Ctrl + Shift + K remains the OS-wide summon from other apps.
  //
  // ⌘/Ctrl + L → AI chat panel. Mirrors Cursor's "ask" chord, which the
  // target audience already has muscle memory for. We only open the
  // panel from this shortcut — closing happens on Esc inside the panel
  // or via the close button, so the chord can't accidentally hide a
  // half-typed question.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'k' && key !== 'l') return;
      // Don't swallow the chord while the user is editing a form
      // field — they may want the browser's native ⌘L (focus URL,
      // not relevant here) or simply paste/cut characters. The chat
      // panel's own input is exempt because it owns Esc-to-close.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      if (key === 'k') {
        void ipc.showQuickAction().catch((err) => console.error('show_quick_action failed', err));
      } else {
        // ⌘L now toggles the AI panel inside the right activity bar
        // — it opens it when collapsed / a different panel is up,
        // and closes it when AI is already the active panel.
        toggleRightPanel('ai');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleRightPanel]);

  return (
    <div className="bg-surface text-fg relative flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Fullscreen pages (Release Notes, Settings) live at the
              top of the conditional chain on purpose: opening either
              must always win over whatever was on the canvas. The
              store's `setSelected` / `setSelectedStack` clear both
              `releaseNotesOpen` and `settingsCategory` so sidebar
              navigation always wins back — precedence stays
              one-directional. Settings has lower priority than
              Release Notes only because the Release Notes page is
              already an autohide-after-update flow that the user
              didn't ask for; if they happen to open Settings on
              top of an auto-shown notes page, surfacing the notes
              again would be jarring. (In practice they can't both
              be open simultaneously because each opener clears the
              other.) */}
          {releaseNotesOpen ? (
            <ReleaseNotes />
          ) : settingsCategory !== null ? (
            <SettingsView
              onReplayTour={() => {
                useAppStore.getState().closeSettings();
                setTourState({ open: true, reopened: true });
              }}
              onOpenAiManager={() => {
                useAppStore.getState().closeSettings();
                setAiSettingsOpen(true);
              }}
            />
          ) : (
            <>
              <MainTabBar />
              {/*
                Per-tab state preservation strategy:
                Every open tab stays mounted in the DOM at all
                times; the inactive ones are hidden via
                `display: none`. This is what lets a service tab
                keep its terminal session alive, its log filter
                input populated, its split-pane height intact, and
                its scroll position pinned across tab switches.
                Conditional rendering (`{active === 'foo' && ...}`)
                would tear those down on every flip and we'd be
                back to the non-tabbed UX with extra steps.
                We collapse hidden tabs via `display: none` rather
                than visibility/opacity tricks because (a) hidden
                trees don't participate in tab order or
                accessibility, exactly what we want for an
                inactive tab, and (b) layout-affecting DOM
                (TerminalPane sizing, virtualized log list
                measurement) doesn't need to compete for
                container width while invisible.
              */}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {mainTabs.map((tab) => {
                  const key = mainTabKey(tab);
                  const isActive = key === activeMainTabKey;
                  // `flex` is required (not `block`) because the
                  // children expect a column flex context to fill
                  // height. Hidden tabs collapse via `none` so they
                  // don't take any layout slot at all.
                  const style: React.CSSProperties = isActive
                    ? { display: 'flex', flex: '1 1 auto', minHeight: 0 }
                    : { display: 'none' };
                  return (
                    <div
                      key={key}
                      role="tabpanel"
                      aria-hidden={!isActive}
                      className="flex-col overflow-hidden"
                      style={style}
                    >
                      {tab.kind === 'dashboard' && <Dashboard onScan={startScan} />}
                      {tab.kind === 'service' && <LogPanel serviceId={tab.refId} />}
                      {tab.kind === 'stack' && <StackDetail stackId={tab.refId} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>
        {/* VSCode-style right side: panel host (renders the active
            view, nothing if collapsed) + a permanent 36px icon rail
            on the far edge. The order matters — the rail must be
            the right-most element so the panel can resize freely
            against the rail's left edge. */}
        <RightSidePanel />
        <RightActivityBar />
      </div>

      <UpdateBanner />

      <StatusBar
        onOpenPortManager={() => setPortManagerOpen(true)}
        onOpenSettings={() => openSettings('shortcuts')}
        onOpenAiSettings={() => openSettings('ai')}
        onToggleAiChat={() => toggleRightPanel('ai')}
      />

      {editorService !== undefined && (
        <ServiceEditor service={editorService} onClose={closeEditor} />
      )}
      {editorStack !== undefined && <StackEditor stack={editorStack} onClose={closeStackEditor} />}
      {scanPath && <ScanDialog path={scanPath} onClose={() => setScanPath(null)} />}
      {portManagerOpen && <PortManager onClose={() => setPortManagerOpen(false)} />}
      {aiSettingsOpen && <AiSettings onClose={() => setAiSettingsOpen(false)} />}
      {/* AI Chat and Activity Timeline are now both rendered inside
          the right-side shell (RightSidePanel), so we no longer
          mount them as standalone drawers/overlays here. */}
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
      {whatsNewOpen && whatsNewVersion && (
        <WhatsNewModal version={whatsNewVersion} onClose={closeWhatsNew} />
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
