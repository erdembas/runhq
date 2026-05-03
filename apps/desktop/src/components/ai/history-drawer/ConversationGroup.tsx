import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ConversationSummary } from '@/types';
import { formatRelative } from './model';
import { OriginIcon } from './OriginIcon';
import type { RenameState } from './types';

interface ConversationGroupProps {
  label: string;
  items: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: ConversationSummary) => void;
  onToggleFavorite: (item: ConversationSummary) => void;
  renaming: RenameState;
  setRenaming: (v: RenameState) => void;
  onCommitRename: () => void;
}

export function ConversationGroup({
  label,
  items,
  activeId,
  onSelect,
  onContextMenu,
  onToggleFavorite,
  renaming,
  setRenaming,
  onCommitRename,
}: ConversationGroupProps) {
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <div className="text-fg-dim/70 px-3 pt-1.5 pb-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase">
        {label}
      </div>
      <ul className="flex flex-col">
        {items.map((it) => {
          const isActive = it.id === activeId;
          const isRenaming = renaming?.id === it.id;
          return (
            <li key={it.id} className="group/row relative">
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                onContextMenu={(e) => onContextMenu(e, it)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
                  'hover:bg-fg/5',
                  isActive && 'bg-accent/10',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  <OriginIcon origin={it.origin} pinned={it.pinned} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: it.id, value: e.target.value })}
                        onBlur={onCommitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onCommitRename();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenaming(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'text-fg flex-1 rounded border px-1 text-[12px] outline-none',
                          'border-accent/60 bg-fg/5',
                        )}
                      />
                    ) : (
                      <span
                        className={cn(
                          'truncate text-[12px] font-medium',
                          isActive ? 'text-fg' : 'text-fg/85',
                        )}
                      >
                        {it.title}
                      </span>
                    )}
                    <span className="text-fg-dim/60 shrink-0 text-[9.5px]">
                      {formatRelative(it.updated_at_ms)}
                    </span>
                  </div>
                  {it.last_preview && !isRenaming && (
                    <div className="text-fg-dim/70 mt-0.5 line-clamp-1 text-[10.5px] leading-snug">
                      {it.last_preview}
                    </div>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(it);
                }}
                title={it.favorite ? 'Unfavorite' : 'Favorite'}
                aria-label={it.favorite ? 'Unfavorite conversation' : 'Favorite conversation'}
                className={cn(
                  'absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded transition-all',
                  'hover:bg-fg/10',
                  it.favorite
                    ? 'text-accent'
                    : 'text-fg-dim/0 group-hover/row:text-fg-dim/70 hover:text-fg',
                )}
              >
                <Star className="h-3 w-3" fill={it.favorite ? 'currentColor' : 'none'} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
