import * as i18n from '@runhq/cockpit-ui/i18n';
import { Activity, FilterX, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TimelineSize } from './types';

interface TimelineEmptyStateProps {
  activeFilterCount: number;
  clearFilters: () => void;
  search: string;
  setSearch: (value: string) => void;
  size: TimelineSize;
}

export function TimelineEmptyState({
  activeFilterCount,
  clearFilters,
  search,
  setSearch,
  size,
}: TimelineEmptyStateProps) {
  i18n.useLocale();
  if (search.trim()) {
    return (
      <div className="text-fg/40 flex flex-col items-center gap-2.5 px-6 py-20">
        <div className="bg-fg/5 flex h-10 w-10 items-center justify-center rounded-full">
          <Search size={18} className="text-fg/35" />
        </div>
        <span className={cn('text-fg/60 font-semibold', size.title)}>{i18n.t('No matches')}</span>
        <span className={cn('text-fg/40', size.meta)}>
          {i18n.rich('for “{value1}”', { value1: search.trim().slice(0, 28) })}
        </span>
        <button
          onClick={() => setSearch('')}
          className={cn(
            'text-accent hover:bg-accent/10 mt-1 rounded px-2 py-1 font-medium transition',
            size.meta,
          )}
        >
          {i18n.t('Clear search')}
        </button>
      </div>
    );
  }

  if (activeFilterCount > 0) {
    return (
      <div className="text-fg/40 flex flex-col items-center gap-2.5 px-6 py-20">
        <div className="bg-fg/5 flex h-10 w-10 items-center justify-center rounded-full">
          <FilterX size={18} className="text-fg/35" />
        </div>
        <span className={cn('text-fg/60 font-semibold', size.title)}>{i18n.t('Filtered out')}</span>
        <span className={cn('text-fg/40 text-center', size.meta)}>
          {i18n.t('No events match current filters')}
        </span>
        <button
          onClick={clearFilters}
          className={cn(
            'text-accent hover:bg-accent/10 mt-1 rounded px-2 py-1 font-medium transition',
            size.meta,
          )}
        >
          {i18n.t('Reset filters')}
        </button>
      </div>
    );
  }

  return (
    <div className="text-fg/40 flex flex-col items-center gap-2.5 px-6 py-20">
      <div className="bg-accent/10 flex h-10 w-10 items-center justify-center rounded-full">
        <Activity size={18} className="text-accent" />
      </div>
      <span className={cn('text-fg/60 font-semibold', size.title)}>{i18n.t('Nothing yet')}</span>
      <span className={cn('text-fg/40 max-w-[240px] text-center', size.meta)}>
        {i18n.t('Start a service or commit — events will land here in real time.')}
      </span>
    </div>
  );
}
