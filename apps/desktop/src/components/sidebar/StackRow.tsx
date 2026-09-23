import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { GripVertical, Layers, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { MoveToSectionMenu } from '../MoveToSectionMenu';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
import { beginDrag, endDrag } from './dnd';
import type { SectionId } from '@/types';
import { SidebarAgentActivity } from './SidebarAgentActivity';
import { useSidebarAgentActivity } from './useSidebarAgentActivity';

export function StackRow({
  stackId,
  serviceIds,
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
  serviceIds: string[];
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
  i18n.useLocale();
  const anyRunning = running > 0;
  const hasAgentActivity = !!useSidebarAgentActivity(serviceIds)?.targetSessionId;
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
        active ? 'bg-fg/6 text-fg' : 'text-fg-muted hover:bg-fg/4 hover:text-fg',
        dragging && 'opacity-40',
      )}
    >
      {active && (
        <span className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full" />
      )}
      <div className="relative flex items-center gap-1.5">
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
        <Layers className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium"
          title={i18n.t('{name} · {running}/{total} services running', {
            name: name,
            running: running,
            total: total,
          })}
        >
          {name}
        </span>

        <SidebarAgentActivity serviceIds={serviceIds} name={name} />
        <div
          className={cn(
            'flex h-6 shrink-0 items-center justify-end',
            hasAgentActivity && !active
              ? 'bg-surface-raised absolute right-[64px] rounded-md'
              : 'relative',
          )}
        >
          {!hasAgentActivity && (
            <span
              className={cn(
                'rounded-app-sm px-1.5 text-[10px] tabular-nums transition-opacity',
                anyRunning ? 'text-status-running' : 'text-fg-dim',
                active
                  ? 'pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0'
                  : 'static opacity-100 group-hover:pointer-events-none group-hover:absolute group-hover:inset-y-0 group-hover:right-0 group-hover:flex group-hover:items-center group-hover:opacity-0',
              )}
            >
              {anyRunning ? `${running}/${total}` : total}
            </span>
          )}

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
                  label={i18n.t('Stop all')}
                  icon={<Square />}
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStop();
                  }}
                />
              ) : (
                <IconButton
                  label={i18n.t('Start all')}
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
              label={i18n.t('Edit stack')}
              icon={<Pencil />}
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
            {!active && (
              <IconButton
                label={i18n.t('Delete stack')}
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
