import { useState } from 'react';
import { GripVertical, Layers, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { MoveToSectionMenu } from '../MoveToSectionMenu';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
import { beginDrag, endDrag } from './dnd';
import type { SectionId } from '@/types';

export function StackRow({
  stackId,
  currentSectionId,
  name,
  total,
  running,
  active,
  onSelect,
  onStart,
  onStop,
  onEdit,
  onDelete,
}: {
  stackId: string;
  currentSectionId: SectionId | null;
  name: string;
  total: number;
  running: number;
  active: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const anyRunning = running > 0;
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={(e) => {
        beginDrag(e, 'stack', stackId);
        setDragging(true);
      }}
      onDragEnd={() => {
        endDrag();
        setDragging(false);
      }}
      className={cn(
        'group relative cursor-grab rounded-lg py-1.5 pr-2 pl-0.5 transition-colors active:cursor-grabbing',
        active
          ? 'bg-accent/8 text-fg ring-accent/15 ring-1 ring-inset'
          : 'text-fg-muted hover:bg-fg/4 hover:text-fg',
        dragging && 'opacity-40',
      )}
    >
      {active && (
        <span className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full" />
      )}
      <div className="flex items-center gap-1.5">
        <GripVertical
          className="text-fg-dim/60 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            anyRunning ? 'bg-status-running animate-breathe' : 'bg-fg-dim/40',
          )}
          aria-hidden
        />
        <Layers className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-accent' : 'text-fg-dim')} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{name}</span>

        <div className="relative flex h-6 shrink-0 items-center justify-end">
          <span
            className={cn(
              'rounded-app-sm px-1.5 text-[10px] tabular-nums transition-opacity',
              anyRunning
                ? 'bg-status-running/15 text-status-running'
                : 'text-fg-dim bg-surface-muted',
              active
                ? 'pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0'
                : 'static opacity-100 group-hover:pointer-events-none group-hover:absolute group-hover:inset-y-0 group-hover:right-0 group-hover:flex group-hover:items-center group-hover:opacity-0',
            )}
          >
            {anyRunning ? `${running}/${total}` : total}
          </span>

          <div
            className={cn(
              'flex items-center gap-0 transition-opacity',
              active
                ? 'static opacity-100'
                : 'pointer-events-none absolute inset-y-0 right-0 opacity-0 group-hover:pointer-events-auto group-hover:static group-hover:opacity-100',
            )}
          >
            {/*
              Active stack already owns the right-hand detail panel, which
              renders Play/Stop and Delete as first-class toolbar buttons.
              Keeping them inline too just duplicates a click target six
              pixels above the one the user is about to use. Edit and Move
              stay because neither is surfaced in the detail panel.
            */}
            {!active &&
              (anyRunning ? (
                <IconButton
                  label="Stop all"
                  icon={<Square />}
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStop();
                  }}
                />
              ) : (
                <IconButton
                  label="Start all"
                  icon={<Play />}
                  size="xs"
                  tone="accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStart();
                  }}
                />
              ))}
            <MoveToSectionMenu kind="stack" itemId={stackId} currentSectionId={currentSectionId} />
            <IconButton
              label="Edit stack"
              icon={<Pencil />}
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
            {!active && (
              <IconButton
                label="Delete stack"
                icon={<Trash2 />}
                size="xs"
                tone="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
