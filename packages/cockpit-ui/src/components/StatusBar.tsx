'use client';

import * as i18n from '../i18n';
import { Cpu, HardDrive, MoonStar, Network, Settings, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

interface Props {
  running: number;
  idle: number;
  cpuPercent: number;
  memoryBytes: number;
  ports: number;
  /** App version, e.g. `v1.0.0`, surfaced in the bottom-right
   *  release-notes pill. */
  version?: string;
  releaseNotesHref?: string;
  className?: string;
}

/**
 * Bottom status bar shown beneath the dashboard body. Surfaces the
 * workspace's running/idle counts on the left and the global vitals
 * (CPU, RAM, ports, AI affordances, theme, version) on the right.
 *
 * Pure read-out — no interactive state lives here.
 */
export function StatusBar({
  running,
  idle,
  cpuPercent,
  memoryBytes,
  ports,
  version,
  releaseNotesHref,
  className,
}: Props) {
  i18n.useLocale();
  const memoryMb = Math.round(memoryBytes / (1024 * 1024));
  return (
    <div
      className={cn(
        'border-border bg-surface-muted/40 text-fg-dim flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[10.5px]',
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <span className="bg-status-running h-1.5 w-1.5 rounded-full" aria-hidden />
        <span className="text-fg-muted">
          {i18n.rich('{running} running', { running: running })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="bg-fg-dim h-1.5 w-1.5 rounded-full" aria-hidden />
        <span className="text-fg-muted">{i18n.rich('{idle} idle', { idle: idle })}</span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1 tabular-nums">
          <Cpu className="h-3 w-3" />
          {i18n.number(cpuPercent, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
            useGrouping: false,
          })}
          %
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          {i18n.rich('{value1}{memoryMb} MB', {
            value1: <HardDrive className="h-3 w-3" />,
            memoryMb: memoryMb,
          })}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          {i18n.rich('{value1}{ports} ports', {
            value1: <Network className="h-3 w-3" />,
            ports: ports,
          })}
        </span>
        <span className="text-border-strong">·</span>
        <span className="hover:text-fg flex items-center gap-1">
          {i18n.rich('{value1} Ask AI', { value1: <Sparkles className="h-3 w-3" /> })}
        </span>
        <span className="hover:text-fg flex items-center gap-1">{i18n.t('AI')}</span>
        <span className="hover:text-fg flex items-center gap-1">
          {i18n.rich('{value1} Settings', { value1: <Settings className="h-3 w-3" /> })}
        </span>
        <span className="hover:text-fg flex items-center gap-1">
          {i18n.rich('{value1} Dark', { value1: <MoonStar className="h-3 w-3" /> })}
        </span>
        <a
          href={releaseNotesHref ?? 'https://github.com/erdembas/runner-hq/releases'}
          className="bg-accent/12 text-accent hover:bg-accent/20 flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition"
          target="_blank"
          rel="noreferrer"
        >
          {i18n.rich('{value1}{value2} · Release notes', {
            value1: <span className="bg-accent inline-block h-1.5 w-1.5 rounded-sm" />,
            value2: version ?? 'v1.0.0',
          })}
        </a>
      </div>
    </div>
  );
}
