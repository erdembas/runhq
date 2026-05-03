import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { FilterMenuBody } from '@/components/sidebar-filter-menu/FilterMenuBody';
import { cn } from '@/lib/cn';
import { CATEGORIES, categoryForTags } from '@/lib/categories';
import { RUNTIMES, inferRuntimeFromCmds, runtimeFromTags } from '@/lib/runtimes';
import { useAppStore } from '@/store/useAppStore';

const POPOVER_WIDTH = 264;
const POPOVER_GAP = 6;

export function SidebarFilterMenu() {
  const services = useAppStore((s) => s.services);
  const categoryFilter = useAppStore((s) => s.categoryFilter);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const statusFilter = useAppStore((s) => s.sidebarStatusFilter);
  const groupBy = useAppStore((s) => s.sidebarGroupBy);
  const setCategoryFilter = useAppStore((s) => s.setCategoryFilter);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const setStatusFilter = useAppStore((s) => s.setSidebarStatusFilter);
  const setGroupBy = useAppStore((s) => s.setSidebarGroupBy);
  const resetAll = useAppStore((s) => s.resetSidebarFilters);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const { categoryBuckets, runtimeBuckets } = useMemo(() => {
    const categoryCounts = new Map<string, number>();
    const runtimeCounts = new Map<string, number>();

    for (const service of services) {
      const category = categoryForTags(service.tags).key;
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

      const runtime = runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds);
      if (runtime) runtimeCounts.set(runtime, (runtimeCounts.get(runtime) ?? 0) + 1);
    }

    return {
      categoryBuckets: CATEGORIES.filter(
        (category) => (categoryCounts.get(category.key) ?? 0) > 0,
      ).map((category) => ({
        ...category,
        count: categoryCounts.get(category.key) ?? 0,
      })),
      runtimeBuckets: RUNTIMES.filter((runtime) => (runtimeCounts.get(runtime.key) ?? 0) > 0).map(
        (runtime) => ({
          ...runtime,
          count: runtimeCounts.get(runtime.key) ?? 0,
        }),
      ),
    };
  }, [services]);

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (groupBy !== 'none' ? 1 : 0) +
    categoryFilter.length +
    runtimeFilter.length;

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const compute = () => {
      const button = triggerRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.min(
        Math.max(8, rect.right - POPOVER_WIDTH),
        viewportWidth - POPOVER_WIDTH - 8,
      );
      const popoverHeight = popoverRef.current?.offsetHeight ?? 420;
      const belowTop = rect.bottom + POPOVER_GAP;
      const top =
        belowTop + popoverHeight > viewportHeight - 8
          ? Math.max(8, rect.top - POPOVER_GAP - popoverHeight)
          : belowTop;

      setPos({ top, left });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  const toggleCategory = (key: string) => {
    setCategoryFilter(
      categoryFilter.includes(key)
        ? categoryFilter.filter((current) => current !== key)
        : [...categoryFilter, key],
    );
  };

  const toggleRuntime = (key: string) => {
    setRuntimeFilter(
      runtimeFilter.includes(key)
        ? runtimeFilter.filter((current) => current !== key)
        : [...runtimeFilter, key],
    );
  };

  const popover = open && pos && (
    <div
      ref={popoverRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      className="border-border bg-surface-raised rounded-app-lg animate-fade-in z-[60] overflow-hidden border shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
    >
      <FilterMenuBody
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        categoryBuckets={categoryBuckets}
        runtimeBuckets={runtimeBuckets}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        runtimeFilter={runtimeFilter}
        setRuntimeFilter={setRuntimeFilter}
        toggleCategory={toggleCategory}
        toggleRuntime={toggleRuntime}
        activeFilterCount={activeFilterCount}
        onClearAll={resetAll}
      />
    </div>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Filter & group"
        aria-expanded={open}
        title="Filter & group"
        className={cn(
          'rounded-app-sm text-fg-muted hover:bg-surface-overlay hover:text-fg relative inline-flex h-5 w-5 items-center justify-center transition',
          open && 'bg-surface-overlay text-fg',
          activeFilterCount > 0 && !open && 'text-accent',
        )}
      >
        <SlidersHorizontal className="h-3 w-3" />
        {activeFilterCount > 0 && (
          <span className="bg-accent text-accent-fg absolute -top-0.5 -right-0.5 flex h-2 w-2 items-center justify-center rounded-full" />
        )}
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}
