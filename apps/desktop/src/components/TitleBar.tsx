import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import {} from 'react';
import { Search, Zap } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { Status } from '@/types';

/** macOS gets native overlay traffic-lights; other platforms keep full native chrome. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function TitleBar() {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);

  const runningCount = useMemo(
    () =>
      services.filter((svc) => {
        const st: Status = statuses[svc.id]?.status ?? 'stopped';
        return st === 'running' || st === 'starting';
      }).length,
    [services, statuses],
  );

  // Only render our custom titlebar on macOS where we've hidden the native one.
  if (!isMac) return null;

  const openQuickAction = () => {
    // The titlebar click and the OS-wide global shortcut both drive the
    // same floating Quick Action window (see `show_quick_action` in the
    // Rust shell) so users get a single, consistent surface.
    void ipc.showQuickAction().catch((err) => console.error('show_quick_action failed', err));
  };

  return (
    <div
      data-tauri-drag-region
      className="border-border/60 bg-surface-raised relative z-20 flex h-10 shrink-0 items-center border-b px-3 select-none"
    >
      {/* Gutter for macOS traffic lights (x=14 + ~3*12 + 2*8 ≈ 70 → pad 76) */}
      <div className="w-[76px] shrink-0" aria-hidden />

      {/* Brand */}
      <div data-tauri-drag-region className="flex items-center gap-1.5">
        <span className="bg-accent/15 text-accent rounded-app-sm inline-flex h-5 w-5 items-center justify-center">
          <Zap className="h-3 w-3" />
        </span>
        <span className="text-fg text-[12px] font-semibold tracking-tight">{i18n.t('RunHQ')}</span>
      </div>

      {/*
        Centered quick-search trigger. The outer wrapper is pointer-events:none
        so the surrounding titlebar remains draggable; the button itself
        re-enables clicks via pointer-events:auto.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex items-center justify-center">
        <button
          type="button"
          onClick={openQuickAction}
          className="border-border/70 bg-surface-muted/70 hover:bg-surface-overlay hover:border-border-strong/70 text-fg-dim hover:text-fg-muted rounded-app-sm pointer-events-auto flex h-7 w-[360px] max-w-[42vw] items-center gap-2 border px-2.5 text-[11.5px] transition"
          aria-label={i18n.t('Open Quick Action')}
        >
          <Search className="h-3 w-3 shrink-0" />
          <span className="truncate">{i18n.t('Search services, stacks, actions…')}</span>
          <kbd className="border-border bg-surface text-fg-dim ml-auto shrink-0 rounded border px-1 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: live running count */}
      <div data-tauri-drag-region className="ml-auto flex items-center gap-2">
        {runningCount > 0 && (
          <span className="bg-status-running/15 text-status-running rounded-app-sm flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-semibold">
            {i18n.rich('{value1}{runningCount} running', {
              value1: (
                <span className="bg-status-running animate-breathe h-1.5 w-1.5 rounded-full" />
              ),
              runningCount: runningCount,
            })}
          </span>
        )}
      </div>
    </div>
  );
}
