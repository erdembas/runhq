import { useCallback } from 'react';
import type React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pin, X } from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusDot';
import { DASHBOARD_TAB_KEY, type MainTab } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import type { Status } from '@/types';

interface SortableTabProps {
  id: string;
  tab: MainTab;
  label: string;
  icon: React.ReactNode;
  status?: Status;
  isPinned: boolean;
  pinnedSet: ReadonlySet<string>;
  closable: boolean;
  isActive: boolean;
  activeTabRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
  onActivate: () => void;
  onClose?: () => void;
  onTogglePin: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function SortableTab(props: SortableTabProps) {
  const {
    id,
    tab,
    label,
    icon,
    status,
    isPinned,
    pinnedSet,
    closable,
    isActive,
    activeTabRef,
    onActivate,
    onClose,
    onTogglePin,
    onContextMenu,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } =
    useSortable({ id });
  const activeId = active?.id != null ? String(active.id) : null;
  const activeIsPinned =
    activeId != null && activeId !== DASHBOARD_TAB_KEY && pinnedSet.has(activeId);
  const showDropIndicator =
    isOver && activeId !== id && activeId != null && activeIsPinned === isPinned;

  const style: React.CSSProperties = {
    ...(transform ? { transform: CSS.Transform.toString(transform) } : null),
    ...(transition ? { transition } : null),
    ...(isDragging
      ? {
          zIndex: 20,
          boxShadow: '0 6px 16px rgb(0 0 0 / 0.22), 0 2px 4px rgb(0 0 0 / 0.18)',
        }
      : null),
  };

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (activeTabRef) {
        activeTabRef.current = node;
      }
    },
    [activeTabRef, setNodeRef],
  );

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
        if (closable && !isPinned && (event.key === 'Backspace' || event.key === 'Delete')) {
          event.preventDefault();
          onClose?.();
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && closable && !isPinned) {
          event.preventDefault();
          onClose?.();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-2 border-r px-3 text-[12px] transition select-none',
        'border-border/60 outline-none focus-visible:outline-none',
        isActive ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
        isDragging && 'cursor-grabbing opacity-40',
        showDropIndicator && 'bg-accent/8',
      )}
      title={tab.kind === 'dashboard' ? 'Workspace dashboard' : label}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition',
          isActive ? 'bg-accent' : 'bg-transparent',
          isDragging && 'opacity-50',
        )}
      />
      {showDropIndicator && (
        <span
          aria-hidden
          className="bg-accent pointer-events-none absolute inset-y-1 -left-px z-10 w-[2px] rounded-full"
          style={{
            boxShadow: '0 0 6px 1px rgb(var(--accent) / 0.55), 0 0 2px 0 rgb(var(--accent) / 0.85)',
          }}
        />
      )}
      <span className="text-fg-dim flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {tab.kind === 'service' && status ? <StatusDot status={status} size="sm" /> : icon}
      </span>
      <span className="max-w-[180px] truncate">{label}</span>
      {isPinned ? (
        <button
          type="button"
          title="Unpin tab"
          aria-label={`Unpin ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="text-accent hover:bg-surface-overlay -mr-1 ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] opacity-90 transition"
        >
          <Pin className="h-3 w-3 fill-current" />
        </button>
      ) : closable ? (
        <button
          type="button"
          title="Close tab"
          aria-label={`Close ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose?.();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'text-fg-dim hover:bg-surface-overlay hover:text-fg -mr-1 ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] transition',
            isActive ? 'opacity-80' : 'opacity-0 group-hover:opacity-80',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <span aria-hidden className="-mr-1 ml-1 inline-block h-4 w-4 shrink-0" />
      )}
    </div>
  );
}
