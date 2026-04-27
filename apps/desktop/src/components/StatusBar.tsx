import { useMemo } from 'react';
import { BrainCircuit, Cpu, Keyboard, MemoryStick, Network, Sparkles } from 'lucide-react';
import { cpuToneClass, memoryToneClass } from '@/lib/resourceTone';
import { ThemeMenu } from '@/components/ThemeMenu';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import { formatBytes, formatPercent } from '@/lib/format';
import type { Status } from '@/types';

interface Props {
  onOpenPortManager: () => void;
  onOpenShortcutSettings: () => void;
  onOpenAiSettings: () => void;
  onToggleAiChat: () => void;
}

export function StatusBar({
  onOpenPortManager,
  onOpenShortcutSettings,
  onOpenAiSettings,
  onToggleAiChat,
}: Props) {
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const ports = useAppStore((s) => s.ports);
  const resources = useAppStore((s) => s.resources);
  const appVersion = useAppStore((s) => s.appVersion);
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);

  const stats = useMemo(() => {
    let running = 0;
    let warn = 0;
    let idle = 0;
    let failed = 0;
    for (const svc of services) {
      const st: Status = statuses[svc.id]?.status ?? 'stopped';
      if (st === 'running') running++;
      else if (st === 'starting' || st === 'stopping') warn++;
      else if (st === 'crashed') failed++;
      else idle++;
    }
    return { running, warn, idle, failed };
  }, [services, statuses]);

  // Aggregate only over services currently in a running-ish state. Stale
  // samples from recently-stopped services would otherwise still count until
  // the next refresh, making the bar lie for a couple of seconds post-stop.
  const totals = useMemo(() => {
    let cpu = 0;
    let mem = 0;
    let samples = 0;
    for (const svc of services) {
      const st: Status = statuses[svc.id]?.status ?? 'stopped';
      if (st !== 'running' && st !== 'starting') continue;
      const r = resources[svc.id];
      if (!r) continue;
      cpu += r.cpu_percent;
      mem += r.memory_bytes;
      samples++;
    }
    return { cpu, mem, samples };
  }, [services, statuses, resources]);

  return (
    // `leading-none` eliminates the implicit line-height gap that otherwise
    // pushes icon buttons a couple of pixels above the text-only stats on the
    // left, which read visually centered but rendered slightly lower.
    <div className="border-border/70 bg-surface-raised text-fg-muted flex h-8 shrink-0 items-center justify-between border-t px-4 text-[11px] leading-none">
      <div className="flex items-center gap-4">
        <Stat dot="bg-status-running" label="running" value={stats.running} />
        {stats.warn > 0 && <Stat dot="bg-status-starting" label="warn" value={stats.warn} />}
        {stats.failed > 0 && <Stat dot="bg-status-error" label="failed" value={stats.failed} />}
        <Stat dot="bg-status-stopped/60" label="idle" value={stats.idle} />
      </div>
      {/* Clickable chrome is wrapped in a subtle "pill" container: idle it
          stays flat & quiet, on hover it lifts with a soft background so the
          status bar doesn't feel like one long static strip. Non-interactive
          bits (version) intentionally skip the hover treatment so the
          affordance stays honest. */}
      <div className="flex items-center gap-0.5">
        {totals.samples > 0 && (
          <div
            className="mr-2 flex items-center gap-2 font-mono tabular-nums"
            title={`Aggregate across ${totals.samples} running service${totals.samples === 1 ? '' : 's'}`}
          >
            {/* Aggregate thresholds are higher than per-service because
                multiple running services naturally stack CPU/RAM — two
                active dev servers already total ~30-40% before anything
                is actually wrong. */}
            <span className={cn('inline-flex items-center gap-1', cpuToneClass(totals.cpu / 2))}>
              <Cpu className="h-3 w-3" />
              {formatPercent(totals.cpu)}
            </span>
            <span className={cn('inline-flex items-center gap-1', memoryToneClass(totals.mem / 2))}>
              <MemoryStick className="h-3 w-3" />
              {formatBytes(totals.mem)}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onOpenPortManager}
          className="hover:bg-surface-overlay hover:text-fg rounded-app-sm flex items-center gap-1.5 px-1.5 py-1 transition"
          title="Listening ports"
        >
          <Network className="h-3 w-3" />
          <span className="tabular-nums">{ports.length}</span>
          <span className="text-fg-dim">ports</span>
        </button>
        <button
          type="button"
          onClick={onToggleAiChat}
          className="hover:bg-surface-overlay hover:text-fg rounded-app-sm flex items-center gap-1.5 px-1.5 py-1 transition"
          title="AI chat (⌘L)"
        >
          <Sparkles className="text-accent h-3 w-3" />
          <span className="text-fg-dim">Ask AI</span>
        </button>
        <button
          type="button"
          onClick={onOpenAiSettings}
          className="hover:bg-surface-overlay hover:text-fg rounded-app-sm flex items-center gap-1.5 px-1.5 py-1 transition"
          title="AI providers"
        >
          <BrainCircuit className="h-3 w-3" />
          <span className="text-fg-dim">AI</span>
        </button>
        <button
          type="button"
          onClick={onOpenShortcutSettings}
          className="hover:bg-surface-overlay hover:text-fg rounded-app-sm flex items-center gap-1.5 px-1.5 py-1 transition"
          title="Keyboard shortcuts"
        >
          <Keyboard className="h-3 w-3" />
          <span className="text-fg-dim">shortcuts</span>
        </button>
        <ThemeMenu />
        {appVersion && (
          // Version badge doubles as the Release Notes entry point.
          // Accent-tinted pill so the version reads as deliberate UI
          // (clickable, brand-aligned) rather than an inert footer
          // string. Sparkles icon mirrors what we use everywhere else
          // for "What's new" content, so the affordance carries across
          // surfaces (modal, settings link, status bar) without a key.
          // Version badge doubles as the Release Notes entry point.
          // Explicit "Release notes" label sits next to the version so
          // the affordance reads as a real action — a bare `v0.5.1`
          // chip looked decorative and would have been ignored. Order
          // is icon → version (mono, prominent) → label (muted) so the
          // version stays the primary anchor and the label clarifies
          // what the click does.
          <button
            type="button"
            onClick={() => openReleaseNotes(appVersion)}
            title={`See what's new in RunHQ ${appVersion}`}
            className="bg-accent/10 text-fg ring-accent/25 hover:bg-accent/20 hover:ring-accent/45 ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ring-1 transition-colors"
          >
            <Sparkles className="text-accent h-3 w-3" />
            <span className="tabular-nums">v{appVersion}</span>
            <span className="text-fg-dim border-accent/25 border-l pl-1.5 text-[10px] font-medium">
              Release notes
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      <span className="text-fg tabular-nums">{value}</span>
      <span className="text-fg-dim">{label}</span>
    </div>
  );
}
