'use client';

import * as i18n from '../i18n';
import { ChevronDown, HardDrive, Network, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

interface Props {
  serviceCount: number;
  version: string;
  lastScan: string;
  attentionCount: number;
  /** Workspace-wide totals shown beneath the headline. */
  totals: {
    memoryBytes: number;
    cpuPercent: number;
    ports: number;
  };
  className?: string;
}

/**
 * Header strip at the top of the dashboard body. Mirrors the
 * desktop's `DashboardHeader` — workspace meta + the giant attention
 * headline + workspace-wide totals + primary CTA cluster
 * ("Analyze Workspace", "+ New service", "Actions ▾").
 */
export function DashboardHeader({
  serviceCount,
  version,
  lastScan,
  attentionCount,
  totals,
  className,
}: Props) {
  i18n.useLocale();
  const memoryMb = Math.round(totals.memoryBytes / (1024 * 1024));
  return (
    <div className={cn('flex flex-col gap-3 px-6 pt-5 pb-3', className)}>
      <div className="text-fg-muted flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-hidden />
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">
          {i18n.t('Workspace')}
        </span>
        <span className="text-fg-dim">·</span>
        <span className="text-fg">
          {i18n.rich('{serviceCount} services', { serviceCount: serviceCount })}
        </span>
        <span className="text-fg-dim">·</span>
        <span className="text-fg-muted font-mono text-[11px]">{version}</span>
        <span className="text-fg-dim">·</span>
        <span className="text-fg-dim">
          {i18n.rich('Last scan {lastScan}', { lastScan: lastScan })}
        </span>
        <button
          type="button"
          className="text-fg-dim hover:text-fg ml-1 inline-flex items-center gap-1 text-[11px]"
        >
          {i18n.rich('{value1} Rescan', { value1: <RefreshCw className="h-3 w-3" /> })}
        </button>
      </div>

      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-fg flex items-baseline gap-3 text-[26px] leading-tight font-semibold tracking-tight">
            <span className="text-accent">{attentionCount}</span>
            <span>
              {i18n.rich('service{plural2} need attention', {
                plural2: attentionCount === 1 ? '' : 's',
              })}
            </span>
          </h1>
          <div className="text-fg-muted flex items-center gap-3 text-[11.5px] tabular-nums">
            <span className="flex items-center gap-1.5">
              {i18n.rich('{value1} {memoryMb} MB', {
                value1: <HardDrive className="text-fg-dim h-3 w-3" />,
                memoryMb: memoryMb,
              })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-fg-dim inline-block h-1 w-1 rounded-full" />{' '}
              {i18n.number(totals.cpuPercent, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                useGrouping: false,
              })}
              %
            </span>
            <span className="flex items-center gap-1.5">
              {i18n.rich('{value1} {value2} ports', {
                value1: <Network className="text-fg-dim h-3 w-3" />,
                value2: totals.ports,
              })}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition"
          >
            {i18n.rich('{value1} Analyze Workspace', {
              value1: <Sparkles className="text-accent h-3.5 w-3.5" />,
            })}
          </button>
          <button
            type="button"
            className="bg-accent text-bg hover:bg-accent/90 flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-semibold transition"
          >
            {i18n.rich('{value1} New service', { value1: <Plus className="h-3.5 w-3.5" /> })}
          </button>
          <button
            type="button"
            className="border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition"
          >
            {i18n.rich('Actions {value1}', { value1: <ChevronDown className="h-3 w-3" /> })}
          </button>
        </div>
      </div>
    </div>
  );
}
