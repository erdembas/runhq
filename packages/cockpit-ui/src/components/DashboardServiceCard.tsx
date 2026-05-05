'use client';

import { useEffect, useRef, useState } from 'react';
import type { ResourceSample, ServiceDef, Status } from '@runhq/cockpit-types';
import {
  Check,
  Clock,
  Code2,
  Copy,
  GitBranch,
  MoreHorizontal,
  Play,
  RotateCcw,
  ScrollText,
  Square,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { formatBytes, formatPercent } from '../lib/format';
import { cpuToneClass, memoryToneClass } from '../lib/resourceTone';
import { RuntimeBadge, type RuntimeBadgeKey } from './RuntimeBadge';
import { StatusDot } from './StatusDot';

interface Props {
  service: ServiceDef;
  status: Status;
  runtime?: RuntimeBadgeKey;
  /** Last-scan timestamp surfaced as a relative string ("1h ago"). */
  lastScan?: string;
  /** Branch shown in the "↗ main" chip — read-only on the marketing
   *  surface. */
  branch?: string;
  /** Latest resource sample. When provided, the card renders the
   *  CPU/RAM read-out + branch chip row at the bottom. */
  sample?: ResourceSample;
  /** Last 3 log lines surfaced as the card's preview pane. The card
   *  only renders the preview block when `status === 'running'` and
   *  this array is non-empty. */
  logTail?: string[];
  /** Optional severity badge — when present renders the small
   *  number-badge + "why?" pill on the top-right (mirrors the desktop
   *  card's incident summary). */
  attention?: { count: number; tone?: 'warning' | 'critical' };
  /** Optional toggle handler for the Stop/Start button. When provided
   *  the dashboard becomes lightly interactive — clicking flips the
   *  service status, which lets the parent re-derive totals + the
   *  running-hot bars. */
  onToggleStatus?: () => void;
  /** Optional restart handler — the marketing demo just re-flips
   *  through `starting` → `running` so the user sees the spinner. */
  onRestart?: () => void;
  /** Optional select handler. Fires when the visitor clicks anywhere
   *  inside the card body that isn't a button — used by the marketing
   *  composite to switch the active tab. */
  onSelect?: () => void;
  /** When true, the card paints with an accent-tinted ring to mark
   *  the active selection. */
  selected?: boolean;
  className?: string;
}

/**
 * Marketing-grade dashboard card. Mirrors the desktop's
 * `ServiceCard` — header (status dot + name + runtime badge), summary
 * row ("All clear" / "X commands"), action cluster (Stop/Start +
 * actions), branch chip, and an inline log tail preview when the
 * service is running.
 *
 * Accepts optional `onToggleStatus` / `onRestart` / `onSelect`
 * callbacks so the parent composite can opt in to interactivity. When
 * none are provided the card renders inert (matching the original
 * read-only marketing contract).
 */
export function DashboardServiceCard({
  service,
  status,
  runtime,
  lastScan,
  branch,
  sample,
  logTail,
  attention,
  onToggleStatus,
  onRestart,
  onSelect,
  selected,
  className,
}: Props) {
  const cmdCount = service.cmds?.length ?? 0;
  const cmdSummary =
    cmdCount > 0
      ? service.cmds
          .slice(0, 2)
          .map((c) => c.name)
          .join(', ')
      : null;

  const isRunning = status === 'running';
  const isStopped = status === 'stopped' || status === 'exited';
  const isStarting = status === 'starting' || status === 'stopping';

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the menu on outside click + escape — same behaviour the
  // desktop's MoreMenu has.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const stopAndRun = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  const isInteractive = Boolean(onSelect);

  return (
    <article
      onClick={onSelect}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      className={cn(
        'border-border bg-surface flex flex-col gap-2.5 rounded-lg border p-3 transition',
        'hover:border-border-strong',
        selected && 'border-accent/60 ring-accent/25 ring-2',
        isInteractive && 'cursor-pointer',
        className,
      )}
    >
      <header className="flex items-start gap-2">
        <StatusDot status={status} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg truncate text-[13px] font-semibold">{service.name}</span>
            {runtime && <RuntimeBadge runtime={runtime} className="text-[10px]" />}
          </div>
          <div className="text-fg-muted mt-1 flex items-center gap-1.5 text-[11px]">
            {isRunning ? (
              <>
                <Check className="text-status-running h-3 w-3" />
                <span>All clear</span>
              </>
            ) : isStarting ? (
              <span className="text-status-starting">Starting…</span>
            ) : isStopped ? (
              <span className="text-fg-dim">Idle · no dependencies missing</span>
            ) : (
              <span className="text-status-error">Needs attention</span>
            )}
          </div>
        </div>
        {attention ? (
          <div className="flex items-center gap-1">
            <span className="bg-tone-critical/15 text-tone-critical-fg flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] font-semibold tabular-nums">
              {attention.count}
            </span>
            <button
              type="button"
              onClick={stopAndRun()}
              className="bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition"
            >
              why?
            </button>
          </div>
        ) : (
          lastScan && (
            <span className="text-fg-dim flex shrink-0 items-center gap-1 text-[10.5px]">
              <Clock className="h-3 w-3" /> {lastScan}
            </span>
          )
        )}
      </header>

      {cmdSummary && (
        <div className="text-fg-muted flex items-center gap-1.5 text-[11px]">
          <span className="text-fg-dim font-mono tabular-nums">{cmdCount} commands</span>
          <span className="text-fg-dim">·</span>
          <span className="text-fg-muted truncate font-mono">{cmdSummary}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <button
            type="button"
            onClick={stopAndRun(onToggleStatus)}
            className="bg-status-error/15 text-status-error hover:bg-status-error/25 flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition active:scale-95"
          >
            <Square className="h-3 w-3" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={stopAndRun(onToggleStatus)}
            disabled={isStarting}
            className="bg-status-running/15 text-status-running hover:bg-status-running/25 flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className={cn('h-3 w-3', isStarting && 'animate-pulse')} />{' '}
            {isStarting ? 'Starting' : 'Start'}
          </button>
        )}
        <button
          type="button"
          onClick={stopAndRun(onRestart)}
          className="border-border bg-surface-muted text-fg-dim hover:text-fg active:text-accent flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border transition"
          aria-label="Restart"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={stopAndRun(() => setMenuOpen((v) => !v))}
            className={cn(
              'border-border bg-surface-muted hover:text-fg flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border transition',
              menuOpen ? 'text-fg border-border-strong' : 'text-fg-dim',
            )}
            aria-label="More"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="border-border bg-surface-overlay animate-fade-in absolute top-7 left-0 z-20 flex min-w-[170px] flex-col gap-0.5 rounded-md border p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="text-fg-muted hover:bg-surface-muted hover:text-fg flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] transition"
              >
                <ScrollText className="h-3.5 w-3.5" />
                View logs
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onRestart?.();
                }}
                className="text-fg-muted hover:bg-surface-muted hover:text-fg flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] transition"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restart service
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    void navigator.clipboard.writeText(service.cmds[0]?.cmd ?? service.name);
                  }
                }}
                className="text-fg-muted hover:bg-surface-muted hover:text-fg flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] transition"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy command
              </button>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {branch && (
            <span className="border-border text-fg-dim flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[10.5px]">
              <GitBranch className="h-3 w-3" /> {branch}
            </span>
          )}
          <button
            type="button"
            onClick={stopAndRun()}
            className="border-border text-fg-dim hover:text-fg flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border transition"
            aria-label="Open in editor"
          >
            <Code2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {sample && (
        <div className="text-fg-muted flex items-center gap-3 font-mono text-[10.5px] tabular-nums">
          <span className={cpuToneClass(sample.cpu_percent)}>
            {formatPercent(sample.cpu_percent)}
          </span>
          <span className={memoryToneClass(sample.memory_bytes)}>
            {formatBytes(sample.memory_bytes)}
          </span>
        </div>
      )}

      {isRunning && logTail && logTail.length > 0 && (
        <div className="bg-surface-muted/60 border-border/60 mt-1 flex flex-col gap-0.5 rounded-md border p-2 font-mono text-[9.5px] leading-tight">
          {logTail.map((line, idx) => (
            <div key={idx} className="text-fg-dim truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
