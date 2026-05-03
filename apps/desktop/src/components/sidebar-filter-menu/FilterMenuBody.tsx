import { X } from 'lucide-react';
import { CheckRow } from '@/components/sidebar-filter-menu/CheckRow';
import { GROUP_OPTIONS, STATUS_OPTIONS } from '@/components/sidebar-filter-menu/filterOptions';
import { MenuSection } from '@/components/sidebar-filter-menu/MenuSection';
import { cn } from '@/lib/cn';
import type { Category } from '@/lib/categories';
import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/useAppStore';

interface FilterMenuBodyProps {
  statusFilter: SidebarStatusFilter;
  setStatusFilter: (value: SidebarStatusFilter) => void;
  groupBy: SidebarGroupBy;
  setGroupBy: (value: SidebarGroupBy) => void;
  categoryBuckets: Array<Category & { count: number }>;
  runtimeBuckets: Array<{ key: string; label: string; color: string; count: number }>;
  categoryFilter: string[];
  setCategoryFilter: (keys: string[]) => void;
  runtimeFilter: string[];
  setRuntimeFilter: (keys: string[]) => void;
  toggleCategory: (key: string) => void;
  toggleRuntime: (key: string) => void;
  activeFilterCount: number;
  onClearAll: () => void;
}

export function FilterMenuBody({
  statusFilter,
  setStatusFilter,
  groupBy,
  setGroupBy,
  categoryBuckets,
  runtimeBuckets,
  categoryFilter,
  setCategoryFilter,
  runtimeFilter,
  setRuntimeFilter,
  toggleCategory,
  toggleRuntime,
  activeFilterCount,
  onClearAll,
}: FilterMenuBodyProps) {
  return (
    <>
      <div className="max-h-[70vh] overflow-y-auto">
        <MenuSection label="Show">
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((option) => {
              const active = statusFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStatusFilter(option.key)}
                  title={option.hint}
                  className={cn(
                    'rounded-app-sm flex-1 px-2 py-1 text-[11px] font-medium transition',
                    active
                      ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.25)]'
                      : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </MenuSection>

        <div className="border-border/60 border-t" />

        <MenuSection label="Group by">
          <div className="grid grid-cols-4 gap-1">
            {GROUP_OPTIONS.map((option) => {
              const active = groupBy === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setGroupBy(option.key)}
                  className={cn(
                    'rounded-app-sm px-2 py-1 text-[11px] font-medium transition',
                    active
                      ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.25)]'
                      : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </MenuSection>

        {categoryBuckets.length > 1 && (
          <>
            <div className="border-border/60 border-t" />
            <MenuSection
              label="Category"
              action={
                categoryFilter.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setCategoryFilter([])}
                    className="text-fg-dim hover:text-fg text-[10px] font-medium"
                  >
                    Reset
                  </button>
                ) : null
              }
            >
              <div className="space-y-0.5">
                {categoryBuckets.map((category) => (
                  <CheckRow
                    key={category.key}
                    checked={categoryFilter.includes(category.key)}
                    onToggle={() => toggleCategory(category.key)}
                    leading={
                      <span className={cn('h-1.5 w-1.5 rounded-full', category.dot)} aria-hidden />
                    }
                    label={category.label}
                    count={category.count}
                  />
                ))}
              </div>
            </MenuSection>
          </>
        )}

        {runtimeBuckets.length > 1 && (
          <>
            <div className="border-border/60 border-t" />
            <MenuSection
              label="Runtime"
              action={
                runtimeFilter.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setRuntimeFilter([])}
                    className="text-fg-dim hover:text-fg text-[10px] font-medium"
                  >
                    Reset
                  </button>
                ) : null
              }
            >
              <div className="space-y-0.5">
                {runtimeBuckets.map((runtime) => (
                  <CheckRow
                    key={runtime.key}
                    checked={runtimeFilter.includes(runtime.key)}
                    onToggle={() => toggleRuntime(runtime.key)}
                    leading={
                      <span
                        className={cn(
                          'font-mono text-[9.5px] font-semibold tracking-wide uppercase',
                          runtime.color,
                        )}
                      >
                        {runtime.label}
                      </span>
                    }
                    label=""
                    count={runtime.count}
                  />
                ))}
              </div>
            </MenuSection>
          </>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="border-border/60 bg-surface-overlay/60 flex items-center justify-between border-t px-3 py-2">
          <span className="text-fg-dim text-[10.5px]">
            {activeFilterCount} active{activeFilterCount === 1 ? ' filter' : ' filters'}
          </span>
          <button
            type="button"
            onClick={onClearAll}
            className="text-fg-muted hover:text-fg flex items-center gap-1 text-[11px] font-medium transition"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        </div>
      )}
    </>
  );
}
