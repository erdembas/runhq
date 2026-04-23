import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Skull,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { IS_MAC } from '@/lib/platform';
import type { Advisory, DetectedEditor, OutdatedPackage, ProjectOverview } from '@/types';

/**
 * Project detail drawer — "triage cockpit" for a single project.
 *
 * The dashboard answers "how many?"; this drawer answers "*which* packages,
 * *what* CVE, *what* fix version — and what do I paste into my terminal?".
 * It replaces the old filter-chip + group-header pattern with a **triage
 * rail** (severity tiles double as filters + summary), promotes the
 * upgrade command from a hover tooltip to the primary deliverable, and
 * adds **multi-select + copy-as-script** so a Monday-morning sweep across
 * 61 outdated packages becomes one paste, not 61 clicks.
 *
 * Modern patterns deliberately in use:
 *   • Hover-reveal row actions (copy, open) — sakin sakin listen, noisy
 *     only while interacting with a specific row.
 *   • Sticky triage rail — counts never leave the viewport while scrolling.
 *   • Tab tone — if critical CVEs > 0, the Advisories tab underline goes
 *     red; if outdated majors > 0, Outdated goes amber. The tab layout
 *     alone tells the user where to look first.
 *   • Keyboard: `/` focuses search, `Esc` closes, `Enter` copies the
 *     upgrade command of the currently hovered/focused row, `x`/Space
 *     toggles selection, `Cmd+A` selects all *visible* rows.
 */
export type DetailTab = 'advisories' | 'outdated';

interface ProjectDetailDrawerProps {
  project: ProjectOverview;
  initialTab: DetailTab;
  scanning: boolean;
  lastScanAt: number | null;
  editors: DetectedEditor[];
  onRescan: () => void;
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenInEditor: (command: string, path: string) => void;
  onOpenUrl: (url: string) => void;
  onJump: (serviceId: string) => void;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const BUMP_ORDER = ['major', 'minor', 'patch', 'other'] as const;
type BumpGroup = (typeof BUMP_ORDER)[number];

const EMPTY_ADVISORIES: Advisory[] = [];
const EMPTY_PACKAGES: OutdatedPackage[] = [];

// ---- Tone palettes -------------------------------------------------------

type Tone = {
  /** Small accent colour for text (e.g. the current→latest pill). */
  text: string;
  /** Foreground + translucent background chip (filled filter tiles). */
  chipFilled: string;
  /** Ring used on active tiles. */
  ring: string;
  /** Short label used in tab indicators. */
  underline: string;
  icon: typeof Shield;
};

function severityTone(s: string): Tone {
  switch (s) {
    case 'critical':
      return {
        text: 'text-red-300',
        chipFilled: 'bg-red-500/15 text-red-300',
        ring: 'ring-red-500/50',
        underline: 'bg-red-400',
        icon: Skull,
      };
    case 'high':
      return {
        text: 'text-orange-300',
        chipFilled: 'bg-orange-500/15 text-orange-300',
        ring: 'ring-orange-500/50',
        underline: 'bg-orange-400',
        icon: ShieldAlert,
      };
    case 'medium':
      return {
        text: 'text-yellow-300',
        chipFilled: 'bg-yellow-500/15 text-yellow-300',
        ring: 'ring-yellow-500/50',
        underline: 'bg-yellow-400',
        icon: Shield,
      };
    case 'low':
      return {
        text: 'text-blue-300',
        chipFilled: 'bg-blue-500/15 text-blue-300',
        ring: 'ring-blue-500/40',
        underline: 'bg-blue-400',
        icon: Shield,
      };
    default:
      return {
        text: 'text-fg/60',
        chipFilled: 'bg-fg/10 text-fg/60',
        ring: 'ring-fg/30',
        underline: 'bg-fg/40',
        icon: Shield,
      };
  }
}

function bumpTone(b: BumpGroup): Tone & { label: string } {
  switch (b) {
    case 'major':
      return {
        text: 'text-orange-300',
        chipFilled: 'bg-orange-500/15 text-orange-300',
        ring: 'ring-orange-500/50',
        underline: 'bg-orange-400',
        icon: Package,
        label: 'Major',
      };
    case 'minor':
      return {
        text: 'text-yellow-300',
        chipFilled: 'bg-yellow-500/15 text-yellow-300',
        ring: 'ring-yellow-500/50',
        underline: 'bg-yellow-400',
        icon: Package,
        label: 'Minor',
      };
    case 'patch':
      return {
        text: 'text-emerald-300',
        chipFilled: 'bg-emerald-500/15 text-emerald-300',
        ring: 'ring-emerald-500/50',
        underline: 'bg-emerald-400',
        icon: Package,
        label: 'Patch',
      };
    default:
      return {
        text: 'text-fg/55',
        chipFilled: 'bg-fg/10 text-fg/55',
        ring: 'ring-fg/30',
        underline: 'bg-fg/40',
        icon: Package,
        label: 'Other',
      };
  }
}

// ---- Scan freshness formatter -------------------------------------------

function scanFreshness(at: number | null): string {
  if (at == null) return 'Never scanned';
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return 'Scanned just now';
  if (diff < 3_600_000) return `Scanned ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Scanned ${Math.floor(diff / 3_600_000)}h ago`;
  return `Scanned ${Math.floor(diff / 86_400_000)}d ago`;
}

// ---- Main component ------------------------------------------------------

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

// ---- Header -------------------------------------------------------------

function DrawerHeader({
  project,
  scanning,
  lastScanAt,
  editors,
  onRescan,
  onClose,
  onOpenPath,
  onOpenInEditor,
  onJump,
}: {
  project: ProjectOverview;
  scanning: boolean;
  lastScanAt: number | null;
  editors: DetectedEditor[];
  onRescan: () => void;
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenInEditor: (command: string, path: string) => void;
  onJump: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const branch = project.git_status?.branch ?? null;
  const dirty = project.git_status?.is_dirty ?? false;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(project.cwd);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
    } catch {
      /* clipboard blocked — no UX recourse from here */
    }
  };

  return (
    <header className="border-border/70 shrink-0 border-b px-4 pt-3 pb-2.5">
      {/* Identity row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-fg truncate text-[14px] font-semibold">{project.name}</h3>
          {project.runtime && (
            <span className="bg-fg/8 text-fg/55 shrink-0 rounded px-1.5 py-px text-[9px] font-medium tracking-wider uppercase">
              {project.runtime}
            </span>
          )}
          {branch && (
            <span
              className="text-fg/55 border-border inline-flex min-w-0 shrink items-center gap-1 rounded border px-1.5 py-px text-[10px]"
              title={`Branch: ${branch}${dirty ? ' (dirty)' : ''}`}
            >
              <span className="truncate font-mono">{branch}</span>
              {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" />}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <OverflowMenu
            open={menuOpen}
            setOpen={setMenuOpen}
            items={[
              {
                label: 'Jump to project',
                icon: <ExternalLink size={12} />,
                onClick: () => onJump(project.service_id),
              },
              {
                // "Open in..." fans out detected editors so the user can
                // pick the right IDE per project (VS Code for TS, RubyMine
                // for Rails, etc.) without us guessing from `editors[0]`.
                // Finder/Explorer sits below a divider as the non-editor
                // escape hatch — same "Open in..." family, different tool.
                label: 'Open in…',
                icon: <Code2 size={12} />,
                children:
                  editors.length > 0
                    ? [
                        ...editors.map((ed) => ({
                          label: ed.name,
                          icon: <Code2 size={12} />,
                          onClick: () => onOpenInEditor(ed.command, project.cwd),
                        })),
                        { separator: true as const },
                        {
                          label: IS_MAC ? 'Open in Finder' : 'Open in Explorer',
                          icon: <FolderOpen size={12} />,
                          onClick: () => onOpenPath(project.cwd),
                        },
                      ]
                    : [
                        {
                          label: IS_MAC ? 'Open in Finder' : 'Open in Explorer',
                          icon: <FolderOpen size={12} />,
                          onClick: () => onOpenPath(project.cwd),
                        },
                      ],
              },
              { separator: true },
              {
                label: pathCopied ? 'Path copied' : 'Copy project path',
                icon: pathCopied ? <Check size={12} /> : <Copy size={12} />,
                onClick: copyPath,
              },
            ]}
          />
          <IconBtn label="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </IconBtn>
        </div>
      </div>

      {/* Path + scan freshness row */}
      <div className="mt-1 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={copyPath}
          title={pathCopied ? 'Copied' : 'Click to copy project path'}
          className="text-fg/40 hover:text-fg/70 min-w-0 truncate text-left font-mono text-[10px] transition"
        >
          {pathCopied ? 'Path copied' : project.cwd}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-[10px]">
          <span className="text-fg/40 tabular-nums">{scanFreshness(lastScanAt)}</span>
          <button
            type="button"
            onClick={onRescan}
            disabled={scanning}
            className={cn(
              'text-fg/55 hover:text-accent hover:bg-fg/5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition',
              scanning && 'hover:text-fg/55 cursor-not-allowed opacity-60 hover:bg-transparent',
            )}
            title={scanning ? 'Scan in progress…' : 'Rescan dependencies (all projects)'}
          >
            {scanning ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            <span>{scanning ? 'Scanning' : 'Rescan'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ---- Tabs ---------------------------------------------------------------

function TabRow({
  tab,
  setTab,
  advisoryCounts,
  outdatedCounts,
}: {
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  advisoryCounts: Record<Severity, number>;
  outdatedCounts: Record<BumpGroup, number>;
}) {
  const advTotal =
    advisoryCounts.critical +
    advisoryCounts.high +
    advisoryCounts.medium +
    advisoryCounts.low +
    advisoryCounts.info;
  const outTotal =
    outdatedCounts.major + outdatedCounts.minor + outdatedCounts.patch + outdatedCounts.other;

  // Pick the strongest tone each tab deserves. Critical > high > medium
  // for advisories; major > minor > patch for outdated. The tab
  // underline colour matches so "where should I look first?" is visible
  // peripherally, without reading counts.
  const advTone =
    advisoryCounts.critical > 0
      ? severityTone('critical')
      : advisoryCounts.high > 0
        ? severityTone('high')
        : advisoryCounts.medium > 0
          ? severityTone('medium')
          : advTotal > 0
            ? severityTone('low')
            : null;

  const outTone =
    outdatedCounts.major > 0
      ? bumpTone('major')
      : outdatedCounts.minor > 0
        ? bumpTone('minor')
        : outTotal > 0
          ? bumpTone('patch')
          : null;

  return (
    <div className="border-border/70 flex shrink-0 border-b">
      <TabButton
        label="Advisories"
        count={advTotal}
        active={tab === 'advisories'}
        onClick={() => setTab('advisories')}
        tone={advTone}
      />
      <TabButton
        label="Outdated"
        count={outTotal}
        active={tab === 'outdated'}
        onClick={() => setTab('outdated')}
        tone={outTone}
      />
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: Tone | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-medium transition',
        active ? 'text-fg' : 'text-fg/50 hover:text-fg/80',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] tabular-nums',
          active ? (tone ? tone.text : 'text-fg/60') : 'text-fg/35',
        )}
      >
        {count}
      </span>
      {active && (
        <span
          className={cn(
            'absolute inset-x-4 -bottom-px h-[2px] rounded-full',
            tone ? tone.underline : 'bg-accent',
          )}
        />
      )}
    </button>
  );
}

// ---- Advisories panel ---------------------------------------------------

function AdvisoriesPanel({
  advisories,
  filtered,
  counts,
  query,
  setQuery,
  searchRef,
  severityFilter,
  setSeverityFilter,
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
  advisories: Advisory[];
  filtered: Advisory[];
  counts: Record<Severity, number>;
  query: string;
  setQuery: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  severityFilter: Severity | 'all';
  setSeverityFilter: (v: Severity | 'all') => void;
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
    return <NotScannedState kind="audit" onRescan={onRescan} scanning={scanning} />;
  }
  if (advisories.length === 0) {
    return (
      <ZeroState
        icon={<ShieldCheck size={32} className="text-emerald-500/80" />}
        title="No known vulnerabilities"
        hint="The latest audit found no open CVEs for the direct or transitive dependencies of this project."
      />
    );
  }

  const total = advisories.length;
  const selectedCmds = filtered
    .filter((a, i) => selected.has(advisoryKey(a, i)))
    .map((a) => upgradeCommandForAdvisory(runtime, a))
    .filter((c): c is string => Boolean(c));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TriageRail
        total={total}
        allLabel="All"
        active={severityFilter}
        onChange={(v) => setSeverityFilter(v as Severity | 'all')}
        tiles={SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => ({
          key: s,
          label: capitalise(s),
          count: counts[s],
          tone: severityTone(s),
        }))}
      />
      <SearchRow
        searchRef={searchRef}
        query={query}
        setQuery={setQuery}
        placeholder="Search package, CVE, title…"
        shown={filtered.length}
        total={total}
        selectedCount={selected.size}
        onSelectAll={selectAllVisible}
        onClearSelection={clearSelection}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState title="No matches" hint="Try clearing the search or the severity filter." />
        ) : (
          <ul className="py-1">
            {filtered.map((a, idx) => (
              <AdvisoryRow
                key={advisoryKey(a, idx)}
                advisory={a}
                selected={selected.has(advisoryKey(a, idx))}
                onToggle={() => toggle(advisoryKey(a, idx))}
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

function AdvisoryRow({
  advisory,
  selected,
  onToggle,
  onOpenUrl,
  runtime,
}: {
  advisory: Advisory;
  selected: boolean;
  onToggle: () => void;
  onOpenUrl: (url: string) => void;
  runtime: string | null;
}) {
  const tone = severityTone(advisory.severity);
  const cmd = upgradeCommandForAdvisory(runtime, advisory);
  const Icon = tone.icon;

  return (
    <li
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={cn(
        'group/row hover:bg-fg/3 focus-visible:bg-fg/3 relative flex cursor-pointer gap-2.5 px-4 py-2.5 transition outline-none',
        selected && 'bg-accent/5',
      )}
    >
      <SelectCheckbox selected={selected} onToggle={onToggle} />

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Title row: severity chip · package · vulnerable range · open-CVE link */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[9px] font-semibold tracking-wider uppercase',
              tone.chipFilled,
            )}
          >
            <Icon size={9} />
            {advisory.severity}
          </span>
          <span className="text-fg truncate text-[12px] font-semibold">{advisory.package}</span>
          {advisory.vulnerable_range && (
            <span className="text-fg/40 shrink-0 font-mono text-[10px] tabular-nums">
              {advisory.vulnerable_range}
            </span>
          )}
          {/* Slot — fixed position + width so rows without an `advisory.url`
              still end their title line at the same x-coordinate as rows
              that do have the external-link button. Kept persistently
              visible (not hover-only) because "open the CVE advisory"
              is the primary triage action on this row — the user has
              to read the GHSA write-up before deciding whether to
              upgrade, pin, or accept the risk. Hiding it behind hover
              would bury the one thing most likely to be clicked. */}
          <span className="ml-auto flex w-[22px] shrink-0 items-center justify-end">
            {advisory.url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUrl(advisory.url!);
                }}
                className="text-fg/55 hover:text-accent hover:bg-fg/5 inline-flex items-center rounded px-1 py-0.5 transition"
                title={`Open ${advisory.id ?? 'advisory'} in browser`}
                aria-label="Open advisory in browser"
              >
                <ExternalLink size={11} />
              </button>
            )}
          </span>
        </div>

        {/* Description — why you should care. */}
        <p className="text-fg/70 line-clamp-2 text-[11px] leading-snug">{advisory.title}</p>

        {/* Command bar — the actual deliverable of this row. Primary
            action, clearly chunked with an integrated copy button. */}
        {cmd && <CommandBar value={cmd} />}

        {/* Footer metadata — low-contrast, informational only. */}
        {(advisory.fix_version || advisory.id) && (
          <div className="text-fg/40 flex items-center gap-2 text-[10px]">
            {advisory.fix_version && (
              <span className="inline-flex items-center gap-1">
                <span className="text-fg/35">fix</span>
                <span className="font-mono text-emerald-400/85 tabular-nums">
                  {advisory.fix_version}
                </span>
              </span>
            )}
            {advisory.fix_version && advisory.id && (
              <span aria-hidden className="text-fg/25">
                ·
              </span>
            )}
            {advisory.id && <span className="font-mono tabular-nums">{advisory.id}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Upgrade command bar — a self-contained "pill" with a shell prompt,
 * the full command, and an inline copy button on the right. Replaces
 * the old pattern where a bare `<code>` block sat next to a floating
 * copy icon with the fix version and CVE id awkwardly trailing on the
 * same line.
 *
 * The integrated copy button + "Copy"/"Copied" label gives a clear
 * affordance without relying on a tooltip hover. The `$` prompt makes
 * it obvious the string is a terminal command, not just "some text
 * about a version".
 */
function CommandBar({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="group/cmd bg-fg/4 hover:bg-fg/6 border-border/60 flex items-stretch overflow-hidden rounded-md border transition">
      <code
        className="text-fg/75 min-w-0 flex-1 truncate px-2.5 py-1 font-mono text-[10.5px] tabular-nums"
        title={value}
      >
        <span className="text-fg/30 mr-1 select-none">$</span>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          'border-border/60 inline-flex shrink-0 items-center gap-1 border-l px-2.5 text-[10px] font-medium tracking-wide transition',
          copied ? 'bg-emerald-500/15 text-emerald-300' : 'text-fg/55 hover:bg-fg/8 hover:text-fg',
        )}
        title={copied ? 'Copied to clipboard' : 'Copy command'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy command'}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

// ---- Outdated panel -----------------------------------------------------

function OutdatedPanel({
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
  searchRef: React.RefObject<HTMLInputElement>;
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
        icon={<Package size={32} className="text-emerald-500/80" />}
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

function OutdatedRow({
  pkg,
  selected,
  onToggle,
  onOpenUrl,
  runtime,
}: {
  pkg: OutdatedPackage;
  selected: boolean;
  onToggle: () => void;
  onOpenUrl: (url: string) => void;
  runtime: string | null;
}) {
  const tone = bumpTone((pkg.bump as BumpGroup | null) ?? 'other');
  const registryUrl = pkg.homepage || registryFallbackUrl(pkg.name);
  const cmd = upgradeCommandForOutdated(runtime, pkg);

  return (
    <li
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={cn(
        'group/row hover:bg-fg/3 focus-visible:bg-fg/3 relative flex cursor-pointer items-center gap-2 px-4 py-1.5 transition outline-none',
        selected && 'bg-accent/5',
      )}
    >
      <SelectCheckbox selected={selected} onToggle={onToggle} />
      <span className="text-fg min-w-0 flex-1 truncate text-[12px] font-medium">{pkg.name}</span>
      {/*
        Version column — both values right-aligned in fixed-width
        boxes so the right edge of the list is clean (users read
        from the right edge: the "latest" is what matters). The
        arrow sits in a fixed-width slot between them so its x
        position is stable across rows regardless of how long the
        current/latest strings happen to be.
      */}
      <div className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] tabular-nums">
        <span className="text-fg/45 inline-block w-[60px] text-right">{pkg.current || '—'}</span>
        <span className="text-fg/25 inline-block w-3 text-center">→</span>
        <span className={cn('inline-block w-[64px] text-right font-semibold', tone.text)}>
          {pkg.latest || '—'}
        </span>
      </div>
      {/*
        Actions slot — fixed width so rows don't reflow when icons fade
        in on hover, and so rows where cmd/registryUrl happen to be
        null still end their version column at the same x-coordinate
        as every other row. Previously this was a `shrink-0` flex box
        whose width tracked its children, which caused the adjacent
        version column to drift left whenever a row had fewer buttons.
      */}
      <div
        className={cn(
          'flex w-[44px] shrink-0 items-center justify-end gap-0.5 transition',
          'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
        )}
      >
        {cmd && <CopyButton value={cmd} label="Copy upgrade command" />}
        {registryUrl && (
          <IconBtn
            size="sm"
            label={pkg.homepage ? 'Open package page' : 'Open on npm'}
            onClick={() => onOpenUrl(registryUrl)}
          >
            <ExternalLink size={11} />
          </IconBtn>
        )}
      </div>
    </li>
  );
}

// ---- Triage rail --------------------------------------------------------

interface Tile {
  key: string;
  label: string;
  count: number;
  tone: Tone;
}

/**
 * Horizontal row of count tiles that doubles as a filter. Replaces the
 * old "filter chips + group headers" redundancy — the user sees the
 * breakdown once (here), and clicking a tile filters the list below.
 * The "All" tile leads as a clear reset.
 */
function TriageRail({
  total,
  allLabel,
  active,
  onChange,
  tiles,
}: {
  total: number;
  allLabel: string;
  active: string;
  onChange: (v: string) => void;
  tiles: Tile[];
}) {
  return (
    <div
      className="border-border/60 bg-surface shrink-0 border-b px-3 py-2"
      role="tablist"
      aria-label="Filter by severity"
    >
      <div className="flex items-stretch gap-1.5 overflow-x-auto">
        <RailTile
          label={allLabel}
          count={total}
          active={active === 'all'}
          onClick={() => onChange('all')}
          neutral
        />
        <span aria-hidden className="bg-border/60 my-1 w-px shrink-0" />
        {tiles.map((t) => (
          <RailTile
            key={t.key}
            label={t.label}
            count={t.count}
            active={active === t.key}
            onClick={() => onChange(active === t.key ? 'all' : t.key)}
            tone={t.tone}
          />
        ))}
      </div>
    </div>
  );
}

function RailTile({
  label,
  count,
  active,
  onClick,
  tone,
  neutral,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: Tone;
  neutral?: boolean;
}) {
  // Single-line tile: UPPERCASE label + count inline. Keeps the rail
  // short (one band above the search) and scannable — the count
  // reads as a number, not a headline under a sub-headline.
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'group/tile inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 transition',
        'ring-1 ring-inset',
        active
          ? tone
            ? cn(tone.chipFilled, tone.ring)
            : 'bg-accent/15 text-accent ring-accent/50'
          : 'ring-border hover:bg-fg/4 hover:ring-fg/20',
      )}
    >
      <span
        className={cn(
          'text-[9.5px] leading-none font-semibold tracking-widest uppercase',
          active ? (tone ? tone.text : 'text-accent') : neutral ? 'text-fg/60' : 'text-fg/50',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-[11.5px] leading-none font-semibold tabular-nums',
          active ? (tone ? tone.text : 'text-accent') : 'text-fg/75',
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ---- Search + selection row --------------------------------------------

function SearchRow({
  searchRef,
  query,
  setQuery,
  placeholder,
  shown,
  total,
  selectedCount,
  onSelectAll,
  onClearSelection,
}: {
  searchRef: React.RefObject<HTMLInputElement>;
  query: string;
  setQuery: (v: string) => void;
  placeholder: string;
  shown: number;
  total: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="border-border/60 bg-surface shrink-0 border-b px-3 py-2">
      <div className="border-border focus-within:border-accent/60 bg-surface flex items-center gap-1.5 rounded-md border px-2">
        <Search size={12} className="text-fg/40" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="text-fg placeholder:text-fg/30 w-full bg-transparent py-1.5 text-[11px] focus:outline-none"
          aria-label="Filter packages"
        />
        <kbd className="text-fg/35 border-border hidden rounded border px-1 font-mono text-[9px] sm:inline-block">
          /
        </kbd>
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-fg/30 hover:text-fg"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className="text-fg/40 tabular-nums">
          {shown === total ? `${total} total` : `${shown} of ${total}`}
        </span>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-fg/55 hover:text-fg transition"
          >
            Clear selection
          </button>
        ) : (
          shown > 0 && (
            <button
              type="button"
              onClick={onSelectAll}
              className="text-fg/55 hover:text-fg transition"
            >
              Select all visible
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ---- Bulk bar -----------------------------------------------------------

/**
 * Sticky bottom bar that appears while one or more rows are selected.
 * The primary win is **one click to copy a multi-package upgrade
 * script** — a Monday-morning expo bump across 30 packages becomes one
 * paste instead of 30 hover+copy cycles.
 */
function BulkBar({
  selectedCount,
  commands,
  onClear,
}: {
  selectedCount: number;
  commands: string[];
  onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(t);
    }
  }, [copied]);

  if (selectedCount === 0) return null;

  const script = commands.join('\n');
  const hasScript = commands.length > 0;

  return (
    <div className="border-border/70 bg-surface/95 shrink-0 border-t px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-fg/80 text-[11px] font-medium tabular-nums">
          {selectedCount} selected
        </span>
        <span className="text-fg/35 text-[10px] tabular-nums">
          {hasScript ? `(${commands.length} commands)` : '(no commands available)'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="text-fg/55 hover:text-fg hover:bg-fg/5 rounded px-2 py-1 text-[11px] transition"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!hasScript) return;
              try {
                await navigator.clipboard.writeText(script);
                setCopied(true);
              } catch {
                /* clipboard blocked */
              }
            }}
            disabled={!hasScript}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition',
              hasScript
                ? copied
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'bg-fg/5 text-fg/30 cursor-not-allowed',
            )}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Script copied' : 'Copy commands as script'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Misc cells ---------------------------------------------------------

function SelectCheckbox({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition',
        selected
          ? 'bg-accent border-accent text-white'
          : 'border-fg/25 hover:border-fg/50 opacity-0 group-hover/row:opacity-100 focus:opacity-100',
      )}
      aria-label={selected ? 'Deselect row' : 'Select row'}
    >
      {selected && <Check size={9} strokeWidth={3} />}
    </button>
  );
}

function ZeroState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon}
      <p className="text-fg/80 text-[13px] font-medium">{title}</p>
      <p className="text-fg/45 max-w-[280px] text-[11px]">{hint}</p>
    </div>
  );
}

function NotScannedState({
  kind,
  onRescan,
  scanning,
}: {
  kind: 'audit' | 'outdated';
  onRescan: () => void;
  scanning: boolean;
}) {
  const copy =
    kind === 'audit'
      ? {
          title: 'No audit run yet',
          hint: 'Scan dependencies to fetch open CVEs and advisories for this project.',
        }
      : {
          title: 'No outdated check yet',
          hint: 'Scan dependencies to compare the current lockfile against the latest registry versions.',
        };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-fg/80 text-[13px] font-medium">{copy.title}</p>
      <p className="text-fg/45 max-w-[280px] text-[11px]">{copy.hint}</p>
      <button
        type="button"
        onClick={onRescan}
        disabled={scanning}
        className={cn(
          'bg-accent/15 text-accent hover:bg-accent/25 mt-1 inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-medium transition',
          scanning && 'cursor-not-allowed opacity-60',
        )}
      >
        {scanning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        {scanning ? 'Scanning…' : 'Scan dependencies'}
      </button>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-fg/60 text-[12px] font-medium">{title}</p>
      <p className="text-fg/40 max-w-[280px] text-[11px]">{hint}</p>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
  size = 'md',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows are clickable to toggle selection; nested action buttons
        // must not also flip the selection when tapped.
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={cn(
        'text-fg/55 hover:text-fg hover:bg-fg/5 rounded-md transition',
        size === 'sm' ? 'p-1' : 'p-1.5',
      )}
    >
      {children}
    </button>
  );
}

// ---- Overflow menu ------------------------------------------------------

interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  separator?: boolean;
  /**
   * Nested items turn this row into a submenu parent. The row opens on
   * hover/focus and items inside close the whole menu on click — this is
   * the standard desktop affordance (Finder, VS Code, Linear) and keeps
   * the top-level list short while still exposing "Open in..." variants.
   */
  children?: MenuItem[];
}

function OverflowMenu({
  open,
  setOpen,
  items,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  items: MenuItem[];
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className={cn(
          'text-fg/55 hover:text-fg hover:bg-fg/5 rounded-md p-1.5 transition',
          open && 'text-fg bg-fg/5',
        )}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="bg-surface border-border rounded-app absolute top-full right-0 z-10 mt-1 flex min-w-[180px] flex-col gap-0.5 border p-1 shadow-xl"
        >
          {items.map((it, i) => (
            <MenuRow
              key={it.label ?? `item-${i}`}
              item={it}
              index={i}
              close={() => setOpen(false)}
            />
          ))}
        </div>
      )}
      {open && (
        <span aria-hidden className="text-fg/40 pointer-events-none absolute right-1 -bottom-2">
          <ChevronDown size={6} />
        </span>
      )}
    </div>
  );
}

/**
 * A single row inside the overflow menu. Handles three shapes:
 *   - separator (horizontal line)
 *   - terminal item (runs onClick, closes menu)
 *   - parent with `children` (expands a flyout submenu on hover/focus)
 *
 * The submenu pops to the **left** because the overflow menu itself is
 * pinned to the drawer's right edge — opening rightward would clip off
 * the viewport on a narrow window. Using a shared wrapper for hover
 * ensures the submenu stays open while the cursor travels from the
 * parent row to its children (no "closes mid-slide" frustration).
 */
function MenuRow({ item, index, close }: { item: MenuItem; index: number; close: () => void }) {
  const [subOpen, setSubOpen] = useState(false);

  if (item.separator) {
    return <span key={`sep-${index}`} aria-hidden className="bg-border/60 my-0.5 h-px" />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={subOpen}
          onFocus={() => setSubOpen(true)}
          onClick={() => setSubOpen((v) => !v)}
          className={cn(
            'text-fg/80 hover:bg-fg/5 hover:text-fg flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11.5px] transition',
            subOpen && 'bg-fg/5 text-fg',
          )}
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          <ChevronRight size={11} className="text-fg/40 -mr-0.5" />
        </button>
        {subOpen && (
          <div
            role="menu"
            className="bg-surface border-border rounded-app absolute top-0 right-full z-20 mr-1 flex min-w-[180px] flex-col gap-0.5 border p-1 shadow-xl"
          >
            {item.children.map((child, ci) => (
              <MenuRow key={child.label ?? `sub-${ci}`} item={child} index={ci} close={close} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        item.onClick?.();
        close();
      }}
      className="text-fg/80 hover:bg-fg/5 hover:text-fg flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11.5px] transition"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}

// ---- Upgrade command helpers -------------------------------------------

function upgradeCommandForAdvisory(runtime: string | null, a: Advisory): string | null {
  // Only pin to fix_version when it looks like a plain semver — ranges
  // like ">=2.3.4" don't translate cleanly into `@x.y.z` for the
  // package manager, so we fall back to @latest.
  const pinned = a.fix_version && /^\d+(\.\d+){0,2}$/.test(a.fix_version) ? a.fix_version : null;
  return upgradeCommand(runtime, a.package, pinned);
}

function upgradeCommandForOutdated(runtime: string | null, p: OutdatedPackage): string | null {
  const pinned = p.latest && /^\d+(\.\d+){0,2}(-[\w.]+)?$/.test(p.latest) ? p.latest : null;
  return upgradeCommand(runtime, p.name, pinned);
}

/**
 * Build the most-likely upgrade command for a package given the project's
 * detected runtime. Returns `null` for runtimes we can't confidently
 * generate for — better silence than a misleading `yarn upgrade` on a
 * pnpm repo.
 *
 * These commands are intentionally *conservative*: they upgrade the
 * specific package and leave the lockfile resolver to do the right thing.
 * A full `npm audit fix --force` could cascade breaking changes, which is
 * a decision the user should make, not a button.
 */
function upgradeCommand(
  runtime: string | null,
  pkg: string,
  version?: string | null,
): string | null {
  if (!pkg) return null;
  const target = version ? `${pkg}@${version}` : `${pkg}@latest`;
  switch (runtime) {
    case 'node':
    case 'npm':
      return `npm install ${target}`;
    case 'pnpm':
      return version ? `pnpm update ${pkg}@${version}` : `pnpm update ${pkg} --latest`;
    case 'yarn':
      return `yarn up ${target}`;
    case 'bun':
      return `bun update ${target}`;
    case 'rust':
    case 'cargo':
      return version ? `cargo add ${pkg}@${version}` : `cargo update -p ${pkg}`;
    case 'go':
      return `go get ${pkg}@${version ?? 'latest'}`;
    case 'python':
    case 'pip':
      return version ? `pip install --upgrade ${pkg}==${version}` : `pip install --upgrade ${pkg}`;
    case 'poetry':
      return version ? `poetry add ${pkg}@${version}` : `poetry update ${pkg}`;
    case 'uv':
      return version
        ? `uv pip install --upgrade ${pkg}==${version}`
        : `uv pip install --upgrade ${pkg}`;
    default:
      return null;
  }
}

// ---- Copy button --------------------------------------------------------

/**
 * Single-row copy button with a 1.5s "copied" visual confirmation.
 *
 * Silently swallows clipboard API failures (e.g. permission denied in
 * locked-down environments). The user sees the normal icon state rather
 * than an error, because there's nothing actionable they can do about it
 * from the drawer.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      title={copied ? 'Copied' : `${label}: ${value}`}
      aria-label={copied ? 'Copied to clipboard' : label}
      className={cn(
        'rounded p-1 transition',
        copied ? 'text-emerald-400' : 'text-fg/45 hover:text-accent hover:bg-fg/5',
      )}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// ---- Registry fallback --------------------------------------------------

/**
 * When the scanner didn't find an explicit `homepage` (common for npm when
 * the package.json omits it), fall back to the npm registry page for the
 * name. Better UX than a dead icon, and the registry page always has the
 * changelog link + the README.
 */
function registryFallbackUrl(name: string): string | null {
  if (!name) return null;
  return `https://www.npmjs.com/package/${name}`;
}

// ---- Filtering & sorting ------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const BUMP_RANK: Record<BumpGroup, number> = {
  major: 0,
  minor: 1,
  patch: 2,
  other: 3,
};

function filterAndSortAdvisories(
  items: Advisory[],
  query: string,
  severityFilter: Severity | 'all',
): Advisory[] {
  const q = query.trim().toLowerCase();
  const out: Advisory[] = [];
  for (const a of items) {
    const sev = (SEVERITY_ORDER as readonly string[]).includes(a.severity)
      ? (a.severity as Severity)
      : 'low';
    if (severityFilter !== 'all' && sev !== severityFilter) continue;
    if (q) {
      const hay = `${a.package} ${a.id ?? ''} ${a.title}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(a);
  }
  out.sort((a, b) => {
    const ra =
      SEVERITY_RANK[(a.severity as Severity) in SEVERITY_RANK ? (a.severity as Severity) : 'low'];
    const rb =
      SEVERITY_RANK[(b.severity as Severity) in SEVERITY_RANK ? (b.severity as Severity) : 'low'];
    if (ra !== rb) return ra - rb;
    return a.package.localeCompare(b.package);
  });
  return out;
}

function filterAndSortOutdated(
  items: OutdatedPackage[],
  query: string,
  bumpFilter: BumpGroup | 'all',
): OutdatedPackage[] {
  const q = query.trim().toLowerCase();
  const out: OutdatedPackage[] = [];
  for (const p of items) {
    const key = (p.bump as BumpGroup | null) ?? 'other';
    const group: BumpGroup = (BUMP_ORDER as readonly string[]).includes(key) ? key : 'other';
    if (bumpFilter !== 'all' && group !== bumpFilter) continue;
    if (q) {
      const hay = `${p.name} ${p.current} ${p.latest}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(p);
  }
  out.sort((a, b) => {
    const ka = ((a.bump as BumpGroup | null) ?? 'other') as BumpGroup;
    const kb = ((b.bump as BumpGroup | null) ?? 'other') as BumpGroup;
    const ra = BUMP_RANK[(ka in BUMP_RANK ? ka : 'other') as BumpGroup];
    const rb = BUMP_RANK[(kb in BUMP_RANK ? kb : 'other') as BumpGroup];
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ---- Row key helpers ----------------------------------------------------

function advisoryKey(a: Advisory, idx: number): string {
  return `${a.package}::${a.id ?? ''}::${idx}`;
}

function outdatedKey(p: OutdatedPackage): string {
  return `${p.name}::${p.current}`;
}

// ---- Utils --------------------------------------------------------------

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
