'use client';

import * as i18n from '../i18n';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function WorkspaceGroupHeader({
  name,
  color,
  collapsed,
  onToggle,
  count,
  running = 0,
  actions,
  activity,
}: {
  name: string;
  color?: string;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
  running?: number;
  actions?: ReactNode;
  activity?: ReactNode;
}) {
  i18n.useLocale();
  return (
    <header className="bg-surface-raised/95 sticky top-0 z-10 mb-0.5 rounded-md backdrop-blur-sm">
      <div className="hover:bg-fg/4 flex items-center gap-1 rounded-md pr-1 transition-colors">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg focus-visible:ring-accent/40 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2"
        >
          <ChevronDown
            className={`text-fg-dim h-3 w-3 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color ?? 'rgb(var(--fg-dim) / 0.5)' }}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{name}</span>
          <span
            title={i18n.t('{running} running · {count} total', { running: running, count: count })}
            className={`min-w-5 text-right text-[10px] tabular-nums ${running ? 'text-status-running' : 'text-fg-dim'}`}
          >
            {running ? `${running}/${count}` : count}
          </span>
        </button>
        {activity}
        {actions}
      </div>
    </header>
  );
}
