'use client';

import type { ReactNode } from 'react';
import { ChevronDown, FolderClosed, FolderOpen } from 'lucide-react';

export function WorkspaceGroupHeader({
  name,
  color,
  collapsed,
  onToggle,
  count,
  running = 0,
  actions,
}: {
  name: string;
  color?: string;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
  running?: number;
  actions?: ReactNode;
}) {
  return (
    <header className="bg-surface-raised/95 sticky top-0 z-10 mb-1 rounded-lg backdrop-blur-sm">
      <div
        className="flex items-center gap-1 rounded-lg pr-1"
        style={{
          backgroundColor: color
            ? `color-mix(in srgb, ${color} 7%, transparent)`
            : 'rgb(var(--fg) / 0.025)',
        }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg focus-visible:ring-accent/40 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2"
        >
          <ChevronDown
            className={`text-fg-dim h-3 w-3 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{
              color,
              backgroundColor: color
                ? `color-mix(in srgb, ${color} 11%, transparent)`
                : 'rgb(var(--fg) / 0.04)',
            }}
          >
            {collapsed ? (
              <FolderClosed className="h-3.5 w-3.5" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{name}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${running ? 'bg-status-running/8 text-status-running' : 'text-fg-dim bg-fg/4'}`}
          >
            {running ? `${running}/${count}` : count}
          </span>
        </button>
        {actions}
      </div>
    </header>
  );
}
