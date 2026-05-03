import { Search, Star, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FilterChip } from './FilterChip';

interface HistorySearchFiltersProps {
  query: string;
  appliedQuery: string;
  favoritesOnly: boolean;
  searchInputRef: React.Ref<HTMLInputElement>;
  setQuery: (value: string) => void;
  setAppliedQuery: (value: string) => void;
  setFavoritesOnly: (value: boolean) => void;
}

export function HistorySearchFilters({
  query,
  appliedQuery,
  favoritesOnly,
  searchInputRef,
  setQuery,
  setAppliedQuery,
  setFavoritesOnly,
}: HistorySearchFiltersProps) {
  const hasActiveFilters = favoritesOnly || appliedQuery.length > 0;
  return (
    <div className="border-border/60 flex flex-col gap-1.5 border-b px-2.5 py-2">
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1',
          'bg-fg/5 border-border/40 border',
          'focus-within:bg-fg/[0.07]',
          'transition-colors',
        )}
      >
        <Search className="text-fg-dim h-3 w-3 shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or messages…"
          aria-label="Search conversations"
          className={cn(
            'history-search-input',
            'text-fg placeholder:text-fg-dim/70 min-w-0 flex-1 bg-transparent text-[11.5px]',
            'border-0 ring-0 outline-none focus:ring-0 focus:outline-none',
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setAppliedQuery('');
            }}
            title="Clear search"
            className="text-fg-dim hover:text-fg flex h-4 w-4 items-center justify-center rounded transition"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <FilterChip active={!favoritesOnly} onClick={() => setFavoritesOnly(false)} label="All" />
        <FilterChip
          active={favoritesOnly}
          onClick={() => setFavoritesOnly(true)}
          icon={<Star className="h-2.5 w-2.5" fill={favoritesOnly ? 'currentColor' : 'none'} />}
          label="Favorites"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setFavoritesOnly(false);
              setQuery('');
              setAppliedQuery('');
            }}
            className="text-fg-dim hover:text-fg ml-auto rounded px-1.5 py-0.5 text-[10px] transition"
            title="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
