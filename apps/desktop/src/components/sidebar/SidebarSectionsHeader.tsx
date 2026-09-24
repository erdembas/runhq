import * as i18n from '@runhq/cockpit-ui/i18n';
import { Plus } from 'lucide-react';
import { AddSectionButton } from '@/components/SectionMenus';
import { useAppStore } from '@/store/useAppStore';
import { showSidebarSections } from './sectionNavigation';

export function SidebarSectionsHeader() {
  i18n.useLocale();
  const count = useAppStore((s) => s.sections.length);
  const active = useAppStore((s) => s.sidebarGroupBy === 'none');
  return (
    <div className="mx-3 mb-1.5 flex h-7 items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => showSidebarSections()}
        title={i18n.t('Show sections')}
        aria-label={i18n.t('Show sections')}
        aria-pressed={active}
        className="text-fg-muted hover:text-fg focus-visible:ring-accent/40 flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-[11px] font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        <span>{i18n.t('Sections')}</span>
        <span className="text-fg-dim text-[10px] tabular-nums">{i18n.number(count)}</span>
      </button>
      <AddSectionButton className="text-fg-dim hover:bg-fg/5 hover:text-fg focus-visible:ring-accent/40 flex h-6 w-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none">
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </AddSectionButton>
    </div>
  );
}
