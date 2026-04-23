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

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    (async () => {
      unsubs.push(
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
            return;
          }
          lastLifecycleRef.current[status.id] = lifecycle;

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
            .recordTimelineEvent(eventType, status.id, svc?.name ?? null, description)
            .catch(() => {});
        }),
      );
      unsubs.push(
        await events.onLog((ev) => {
          appendLog(logKey(ev.service_id, ev.cmd_name), ev.line);
          if (ev.line.stream === 'stderr') {
            const text = ev.line.text.toLowerCase();
            const isWarning = text.includes('warn') || text.includes('warning');
            const isError =
              text.includes('error') || text.includes('fatal') || text.includes('panic');
            if (isError || isWarning) {
              const svc = useAppStore.getState().services.find((s) => s.id === ev.service_id);
              // Preserve enough context for the timeline detail view to actually
              // show the useful part of a stack trace / error body, not just
              // the first 200 chars which usually cut off mid-message.
              ipc
                .recordTimelineEvent(
                  isError ? 'log_error' : 'log_warning',
                  ev.service_id,
                  svc?.name ?? null,
                  ev.line.text.slice(0, 1500),
                )
                .catch(() => {});
            }
          }
        }),
      );
      unsubs.push(
        await events.onResources((ev) =>
          setResources(ev.service_id, {
            cpu_percent: ev.cpu_percent,
            memory_bytes: ev.memory_bytes,
          }),
        ),
      );
    })();
    return () => unsubs.forEach((u) => u());
  }, [setStatus, appendLog, setResources]);

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
