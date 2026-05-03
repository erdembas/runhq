import type { RefObject } from 'react';
import { FilterX, Search, X } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { FILTER_PILLS, nameHue, TIME_RANGES } from './model';
import type { TimelineSize } from './types';

interface ActivityTimelineFiltersProps {
  activeFilterCount: number;
  clearFilters: () => void;
  filterProject: string | null;
  filterType: string | null;
  projectNames: string[];
  search: string;
  searchInputRef: RefObject<HTMLInputElement>;
  setFilterProject: (value: string | null) => void;
  setFilterType: (value: string | null) => void;
  setSearch: (value: string) => void;
  setTimeRange: (value: string) => void;
  size: TimelineSize;
  timeRange: string;
}

export function ActivityTimelineFilters({
  activeFilterCount,
  clearFilters,
  filterProject,
  filterType,
  projectNames,
  search,
  searchInputRef,
  setFilterProject,
  setFilterType,
  setSearch,
  setTimeRange,
  size,
  timeRange,
}: ActivityTimelineFiltersProps) {
  return (
    <div className={cn('border-border/40 space-y-2 border-t py-2.5', size.padX)}>
      <div className="flex items-center gap-2">
        <div className="bg-surface-muted/40 border-border/40 focus-within:border-accent/50 focus-within:bg-surface relative flex flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 transition">
          <Search size={13} className="text-fg/35 shrink-0" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events…"
            className={cn(
              'placeholder:text-fg/30 text-fg/85 min-w-0 flex-1 bg-transparent outline-none',
              size.body,
            )}
            aria-label="Search timeline events"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              className="text-fg/30 hover:text-fg/70 shrink-0"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className="text-fg/35 border-border/40 bg-surface/60 shrink-0 rounded border px-1 font-mono text-[10px]">
              /
            </kbd>
          )}
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className={cn(
              'hover:bg-fg/8 text-fg/50 hover:text-fg/80 flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 font-medium transition',
              size.micro,
            )}
            title={`Clear ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}`}
          >
            <FilterX size={12} />
            <span className="tabular-nums">{activeFilterCount}</span>
          </button>
        )}
      </div>

      <div className="-mx-2 flex items-center gap-1 overflow-x-auto px-2 pr-6 pb-1.5">
        {FILTER_PILLS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => setFilterType(filter.key || null)}
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 font-medium transition',
              size.micro,
              (filterType ?? '') === filter.key
                ? 'bg-accent/15 text-accent'
                : 'text-fg/45 hover:bg-fg/5 hover:text-fg/75',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={filterProject ?? ''}
          onChange={(value) => setFilterProject(value || null)}
          options={[
            { value: '', label: 'All projects' },
            ...projectNames.map((name) => ({ value: name, label: name, hue: nameHue(name) })),
          ]}
          placeholder="All projects"
          ariaLabel="Filter by project"
          size="sm"
          className="min-w-0 flex-1"
        />
        <div className="border-border/40 bg-surface-muted/30 flex items-center gap-0.5 rounded-md border px-0.5 py-0.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range.key}
              onClick={() => setTimeRange(range.key)}
              className={cn(
                'rounded px-1.5 py-0.5 font-medium tabular-nums transition',
                size.micro,
                timeRange === range.key
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg/40 hover:bg-fg/5 hover:text-fg/70',
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
