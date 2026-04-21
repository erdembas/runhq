import { useState } from 'react';
import { GripVertical, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { MoveToSectionMenu } from '../MoveToSectionMenu';
import { EditorDropdown } from '@/components/EditorDropdown';
import { ResourceBadge } from '@/components/ResourceBadge';
import { IconButton } from '@/components/ui/IconButton';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta } from '@/lib/runtimes';
import { beginDrag, endDrag } from './dnd';
import type { SectionId, ServiceDef, Status } from '@/types';

export function ServiceRow({
  service,
  status,
  pid,
  selected,
  currentSectionId,
  onSelect,
  onEdit,
  onDelete,
}: {
  service: ServiceDef;
  status: Status;
  pid?: number;
  selected: boolean;
  currentSectionId: SectionId | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isRunning = status === 'running' || status === 'starting';
  const isStarting = status === 'starting';
  const isCrashed = status === 'crashed';
  const rtKey = runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds);
  const rt = rtKey ? runtimeMeta(rtKey) : null;
  // Only surface resource numbers while the service is live — showing stale
  // samples for a stopped service would mislead the user into thinking it's
  // still consuming memory.
  const resourceSample = useAppStore((s) => s.resources[service.id]);
  const showResources = isRunning && resourceSample !== undefined;

  const dotClass = isCrashed ? 'bg-status-error' : isRunning ? 'bg-status-running' : 'bg-fg-dim/50';
  const dotAnim = isStarting ? 'animate-pulse-dot' : isRunning ? 'animate-breathe' : '';
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={(e) => {
        beginDrag(e, 'service', service.id);
        setDragging(true);
      }}
      onDragEnd={() => {
        endDrag();
        setDragging(false);
      }}
      className={cn(
        'rounded-app-sm group relative cursor-grab py-1.5 pr-2 pl-0.5 transition active:cursor-grabbing',
        selected
          ? 'bg-accent/10 text-fg'
          : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
        dragging && 'opacity-40',
      )}
    >
      {selected && (
        <span className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full" />
      )}

      <div className="relative flex items-center gap-1.5">
        <GripVertical
          className="text-fg-dim/60 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass, dotAnim)} aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', selected && 'font-medium')}>
          {service.name}
        </span>

        <div className="relative flex h-6 shrink-0 items-center justify-end">
          <div
            className={cn(
              'flex items-center gap-1.5 transition-opacity',
              selected
                ? 'pointer-events-none absolute inset-y-0 right-0 opacity-0'
                : 'static opacity-100 group-hover:pointer-events-none group-hover:absolute group-hover:inset-y-0 group-hover:right-0 group-hover:opacity-0',
            )}
          >
            {service.port != null && (
              <span className="text-accent text-[10.5px] font-medium tabular-nums">
                :{service.port}
              </span>
            )}
            {rt && (
              <span className={cn('font-mono text-[9.5px] font-semibold uppercase', rt.color)}>
                {rt.label}
              </span>
            )}
            {showResources && <ResourceBadge sample={resourceSample} compact />}
          </div>

          <div
            className={cn(
              'flex items-center gap-0 transition-opacity',
              selected
                ? 'static opacity-100'
                : 'pointer-events-none absolute inset-y-0 right-0 opacity-0 group-hover:pointer-events-auto group-hover:static group-hover:opacity-100',
            )}
          >
            {/*
              When the row is already selected, the right-hand detail panel
              surfaces the full action set (Play/Stop, Delete, open-in-editor,
              reveal-in-Finder, logs, ports, env…) — duplicating them inline
              here just makes the selected row feel noisier than the ones
              underneath it. We keep Edit and Move-to-Section because neither
              has a first-class home on the right panel: Edit opens the
              configuration modal, Move reshuffles sidebar grouping. The
              other buttons still show up on hover for *unselected* rows, so
              fast-fire flows (mouse over, click Play) are preserved.
            */}
            {!selected &&
              (isRunning ? (
                <IconButton
                  label="Stop"
                  icon={<Square />}
                  size="xs"
                  tone="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void ipc.stopService(service.id);
                  }}
                />
              ) : (
                <IconButton
                  label="Start"
                  icon={<Play />}
                  size="xs"
                  tone="accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    void ipc.startService(service.id);
                  }}
                />
              ))}
            <MoveToSectionMenu
              kind="service"
              itemId={service.id}
              currentSectionId={currentSectionId}
            />
            <IconButton
              label="Edit"
              icon={<Pencil />}
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
            {!selected && (
              <IconButton
                label="Delete"
                icon={<Trash2 />}
                size="xs"
                tone="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              />
            )}
            {!selected && (
              <div onClick={(e) => e.stopPropagation()}>
                <EditorDropdown cwd={service.cwd} cmds={service.cmds} />
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && (service.port != null || pid != null) && (
        <div className="text-fg-dim mt-0.5 ml-3.5 flex items-center gap-2 text-[10.5px]">
          {service.port != null && (
            <span className="text-accent font-medium tabular-nums">:{service.port}</span>
          )}
          {pid != null && <span className="font-mono tabular-nums">pid {pid}</span>}
        </div>
      )}
    </div>
  );
}
