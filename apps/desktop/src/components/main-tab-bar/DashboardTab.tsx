import type React from 'react';
import { cn } from '@/lib/cn';

interface DashboardTabProps {
  isActive: boolean;
  activeTabRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
  onActivate: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  icon: React.ReactNode;
  label: string;
}

export function DashboardTab(props: DashboardTabProps) {
  const { isActive, activeTabRef, onActivate, onContextMenu, icon, label } = props;

  return (
    <div
      ref={activeTabRef}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-2 border-r px-3 text-[12px] transition select-none',
        'border-border/60 outline-none focus-visible:outline-none',
        isActive ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
      )}
      title="Workspace dashboard"
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition',
          isActive ? 'bg-accent' : 'bg-transparent',
        )}
      />
      <span className="text-fg-dim flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="max-w-[180px] truncate">{label}</span>
      <span aria-hidden className="-mr-1 ml-1 inline-block h-4 w-4 shrink-0" />
    </div>
  );
}
