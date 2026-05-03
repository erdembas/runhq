import type { RefObject } from 'react';
import { Package } from 'lucide-react';
import type { OutdatedPackage } from '@/types';
import { BulkBar } from './BulkBar';
import { EmptyState } from './EmptyState';
import { NotScannedState } from './NotScannedState';
import { OutdatedRow } from './OutdatedRow';
import { SearchRow } from './SearchRow';
import { TriageRail } from './TriageRail';
import { ZeroState } from './ZeroState';
import {
  BUMP_ORDER,
  bumpTone,
  outdatedKey,
  upgradeCommandForOutdated,
  type BumpGroup,
} from './model';

export function OutdatedPanel({
  packages,
  filtered,
  counts,
  query,
  setQuery,
  searchRef,
  bumpFilter,
  setBumpFilter,
  selected,
  toggle,
  selectAllVisible,
  clearSelection,
  hasScan,
  onOpenUrl,
  onRescan,
  scanning,
  runtime,
}: {
  packages: OutdatedPackage[];
  filtered: OutdatedPackage[];
  counts: Record<BumpGroup, number>;
  query: string;
  setQuery: (v: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  bumpFilter: BumpGroup | 'all';
  setBumpFilter: (v: BumpGroup | 'all') => void;
  selected: Set<string>;
  toggle: (key: string) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  hasScan: boolean;
  onOpenUrl: (url: string) => void;
  onRescan: () => void;
  scanning: boolean;
  runtime: string | null;
}) {
  if (!hasScan) {
    return <NotScannedState kind="outdated" onRescan={onRescan} scanning={scanning} />;
  }
  if (packages.length === 0) {
    return (
      <ZeroState
        icon={<Package size={32} className="text-tone-success/80" />}
        title="All packages up to date"
        hint="Every direct dependency matches the latest version published on its registry."
      />
    );
  }

  const total = packages.length;
  const selectedCmds = filtered
    .filter((p) => selected.has(outdatedKey(p)))
    .map((p) => upgradeCommandForOutdated(runtime, p))
    .filter((c): c is string => Boolean(c));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TriageRail
        total={total}
        allLabel="All"
        active={bumpFilter}
        onChange={(v) => setBumpFilter(v as BumpGroup | 'all')}
        tiles={BUMP_ORDER.filter((b) => counts[b] > 0).map((b) => {
          const t = bumpTone(b);
          return {
            key: b,
            label: t.label,
            count: counts[b],
            tone: t,
          };
        })}
      />
      <SearchRow
        searchRef={searchRef}
        query={query}
        setQuery={setQuery}
        placeholder="Search package…"
        shown={filtered.length}
        total={total}
        selectedCount={selected.size}
        onSelectAll={selectAllVisible}
        onClearSelection={clearSelection}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState title="No matches" hint="Try clearing the search or the bump filter." />
        ) : (
          <ul className="py-1">
            {filtered.map((p) => (
              <OutdatedRow
                key={outdatedKey(p)}
                pkg={p}
                selected={selected.has(outdatedKey(p))}
                onToggle={() => toggle(outdatedKey(p))}
                onOpenUrl={onOpenUrl}
                runtime={runtime}
              />
            ))}
          </ul>
        )}
      </div>
      <BulkBar selectedCount={selected.size} commands={selectedCmds} onClear={clearSelection} />
    </div>
  );
}
