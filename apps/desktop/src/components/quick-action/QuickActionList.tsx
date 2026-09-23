import * as i18n from '@runhq/cockpit-ui/i18n';
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
  i18n.useLocale();
  return (
    <div ref={scrollRef} className="qa-list min-h-0 flex-1 overflow-y-auto">
      {items.length === 0 && (
        <div className="text-fg-dim py-12 text-center text-[12px]">
          {inDrill
            ? i18n.t('No matching commands or actions')
            : services.length === 0
              ? i18n.t('No services configured')
              : i18n.t('No results')}
        </div>
      )}
      {!inDrill && items[0]?.type === 'app-action' && (
        <div className="qa-section-header">{i18n.t('Actions')}</div>
      )}
      {items.map((item, i) => renderRow(item, i, renderRowDeps))}
    </div>
  );
}
