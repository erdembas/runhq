import type { ServiceDef } from '@/types';
import { renderRow, type RenderRowDeps } from './renderers';
import type { ListItem } from './types';

interface QuickActionListProps {
  scrollRef: React.Ref<HTMLDivElement>;
  items: ListItem[];
  inDrill: boolean;
  services: ServiceDef[];
  renderRowDeps: RenderRowDeps;
}

export function QuickActionList({
  scrollRef,
  items,
  inDrill,
  services,
  renderRowDeps,
}: QuickActionListProps) {
  return (
    <div ref={scrollRef} className="qa-list min-h-0 flex-1 overflow-y-auto">
      {items.length === 0 && (
        <div className="text-fg-dim py-12 text-center text-[12px]">
          {inDrill
            ? 'No matching commands or actions'
            : services.length === 0
              ? 'No services configured'
              : 'No results'}
        </div>
      )}
      {!inDrill && items[0]?.type === 'app-action' && (
        <div className="qa-section-header">Actions</div>
      )}
      {items.map((item, i) => renderRow(item, i, renderRowDeps))}
    </div>
  );
}
