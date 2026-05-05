'use client';

import type { ServiceId, Status } from '@runhq/cockpit-types';
import { LayoutDashboard } from 'lucide-react';
import { cn } from '../lib/cn';
import { StatusDot } from './StatusDot';

export interface MainTab {
  id: string;
  /** Either `'dashboard'` for the home tab or a `ServiceId` for an
   *  open service tab. */
  kind: 'dashboard' | 'service';
  label: string;
  /** Service id for service tabs — looked up against `statuses` to
   *  paint the status dot. */
  serviceId?: ServiceId;
}

interface Props {
  tabs: MainTab[];
  activeTabId?: string;
  statuses?: Record<ServiceId, Status>;
  onSelect?: (id: string) => void;
  className?: string;
}

/**
 * Top tab strip rendered immediately under the TitleBar. Mirrors the
 * desktop's `MainTabBar` — the home "Dashboard" tab is special-cased
 * with a layout-grid icon, every other tab is keyed by service id and
 * paints a status dot pulled from the supplied `statuses` map.
 */
export function MainTabBar({ tabs, activeTabId, statuses, onSelect, className }: Props) {
  return (
    <div
      className={cn(
        'border-border bg-surface flex h-9 shrink-0 items-center gap-0.5 border-b px-2',
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const status =
          tab.kind === 'service' && tab.serviceId
            ? (statuses?.[tab.serviceId] ?? 'stopped')
            : undefined;
        return (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(tab.id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition',
              active
                ? 'bg-surface-muted text-fg'
                : 'text-fg-muted hover:bg-surface-muted/60 hover:text-fg',
            )}
          >
            {tab.kind === 'dashboard' ? (
              <LayoutDashboard
                className={cn('h-3.5 w-3.5', active ? 'text-accent' : 'text-fg-dim')}
              />
            ) : (
              <StatusDot status={status ?? 'stopped'} size="xs" />
            )}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
