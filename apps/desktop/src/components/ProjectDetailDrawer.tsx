import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdvisoriesPanel } from '@/components/project-detail-drawer/AdvisoriesPanel';
import { DrawerHeader } from '@/components/project-detail-drawer/DrawerHeader';
import { OutdatedPanel } from '@/components/project-detail-drawer/OutdatedPanel';
import { TabRow } from '@/components/project-detail-drawer/TabRow';
import {
  EMPTY_ADVISORIES,
  EMPTY_PACKAGES,
  SEVERITY_ORDER,
  advisoryKey,
  filterAndSortAdvisories,
  filterAndSortOutdated,
  outdatedKey,
  type BumpGroup,
  type DetailTab,
  type ProjectDetailDrawerProps,
  type Severity,
} from '@/components/project-detail-drawer/model';

export type { DetailTab } from '@/components/project-detail-drawer/model';

/**
 * Project detail drawer — "triage cockpit" for a single project.
 */
export function ProjectDetailDrawer({
  project,
  initialTab,
  scanning,
  lastScanAt,
  editors,
  onRescan,
  onClose,
  onOpenPath,
  onOpenInEditor,
  onOpenUrl,
  onJump,
}: ProjectDetailDrawerProps) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [bumpFilter, setBumpFilter] = useState<BumpGroup | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Honour a tab swap from the caller (user clicks a different chip on
  // the card while the drawer is already up).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Clear selection when the user flips tabs — it's scoped per-tab
  // (you're either bulk-copying advisories or bulk-copying outdated,
  // never mixing).
  useEffect(() => {
    setSelected(new Set());
    setQuery('');
  }, [tab, project.service_id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when typing in an input/textarea/contentEditable
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (!inField && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Stabilise the empty-array fallback — otherwise each render produces a
  // new `[]` reference and the downstream `useMemo`s run every time.
  const advisories = useMemo(() => project.audit?.advisories ?? EMPTY_ADVISORIES, [project.audit]);
  const outdated = useMemo(() => project.outdated?.packages ?? EMPTY_PACKAGES, [project.outdated]);

  const advisoryCounts: Record<Severity, number> = useMemo(() => {
    const c: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const a of advisories) {
      if ((SEVERITY_ORDER as readonly string[]).includes(a.severity)) {
        c[a.severity as Severity]++;
      } else {
        c.low++;
      }
    }
    return c;
  }, [advisories]);

  const outdatedCounts: Record<BumpGroup, number> = useMemo(() => {
    const c: Record<BumpGroup, number> = { major: 0, minor: 0, patch: 0, other: 0 };
    for (const p of outdated) {
      const key = (p.bump as BumpGroup | null) ?? 'other';
      if (key in c) c[key]++;
      else c.other++;
    }
    return c;
  }, [outdated]);

  const filteredAdvisories = useMemo(
    () => filterAndSortAdvisories(advisories, query, severityFilter),
    [advisories, query, severityFilter],
  );

  const filteredOutdated = useMemo(
    () => filterAndSortOutdated(outdated, query, bumpFilter),
    [outdated, query, bumpFilter],
  );

  // Visible rows (whichever tab is active) — drives keyboard nav, bulk
  // select-all, and "Showing X of Y" caption.
  const visibleKeys = useMemo(() => {
    if (tab === 'advisories') {
      return filteredAdvisories.map((a, i) => advisoryKey(a, i));
    }
    return filteredOutdated.map((p) => outdatedKey(p));
  }, [tab, filteredAdvisories, filteredOutdated]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visibleKeys));
  }, [visibleKeys]);

  // Floating drawer shell — scoped to the Dashboard root (absolute
  // inset-0 spans main column + activity panel together) rather than
  // the viewport. App-level sidebar and titlebar stay visible because
  // they're rendered outside the Dashboard root.
  return (
    <div
      className="absolute inset-0 z-[60] flex p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Project details"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        role="presentation"
      />
      <aside
        className="bg-surface border-border rounded-app-lg relative z-10 ml-auto flex h-full w-full max-w-[560px] flex-col overflow-hidden border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <DrawerHeader
          project={project}
          scanning={scanning}
          lastScanAt={lastScanAt}
          editors={editors}
          onRescan={onRescan}
          onClose={onClose}
          onOpenPath={onOpenPath}
          onOpenInEditor={onOpenInEditor}
          onJump={onJump}
        />

        <TabRow
          tab={tab}
          setTab={setTab}
          advisoryCounts={advisoryCounts}
          outdatedCounts={outdatedCounts}
        />

        {tab === 'advisories' ? (
          <AdvisoriesPanel
            advisories={advisories}
            filtered={filteredAdvisories}
            counts={advisoryCounts}
            query={query}
            setQuery={setQuery}
            searchRef={searchRef}
            severityFilter={severityFilter}
            setSeverityFilter={setSeverityFilter}
            selected={selected}
            toggle={toggle}
            selectAllVisible={selectAllVisible}
            clearSelection={clearSelection}
            hasScan={project.audit !== null}
            onOpenUrl={onOpenUrl}
            onRescan={onRescan}
            scanning={scanning}
            runtime={project.runtime}
            projectName={project.name}
          />
        ) : (
          <OutdatedPanel
            packages={outdated}
            filtered={filteredOutdated}
            counts={outdatedCounts}
            query={query}
            setQuery={setQuery}
            searchRef={searchRef}
            bumpFilter={bumpFilter}
            setBumpFilter={setBumpFilter}
            selected={selected}
            toggle={toggle}
            selectAllVisible={selectAllVisible}
            clearSelection={clearSelection}
            hasScan={project.outdated !== null}
            onOpenUrl={onOpenUrl}
            onRescan={onRescan}
            scanning={scanning}
            runtime={project.runtime}
          />
        )}
      </aside>
    </div>
  );
}
