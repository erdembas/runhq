import { useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, Search, Tag, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { authorHue, initialsFor, timeAgo } from '@/lib/gitDiff';
import { BranchPicker, type BranchPickerOption } from '@/components/ui/BranchPicker';
import type { CommitSummary, ServiceId } from '@/types';

interface GraphPanelProps {
  serviceId: ServiceId;
  refreshTick: number;
  onSelectCommit?: (hash: string) => void;
}

const ROW_H = 32;
const LANE_W = 14;
const LEFT_PAD = 14;
const DOT_R = 4.5;

/** Qualitative palette used to color lanes. Six hues was enough in our
 * tests to visually separate long-lived branches without rainbow-vomit. */
const LANE_COLORS = [
  '#60a5fa', // sky-400
  '#f472b6', // pink-400
  '#4ade80', // green-400
  '#facc15', // yellow-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#22d3ee', // cyan-400
  '#f87171', // red-400
];

interface LaneAssignment {
  /** Lane index this commit is drawn on. */
  lane: number;
  /** Lane state AFTER this commit runs (i.e., which commit each lane is
   *  currently "waiting for" as we walk downward). Used to draw the
   *  continuation lines that pass THROUGH this row without touching it. */
  passingLanes: Array<string | null>;
}

/**
 * Assign a lane index to every commit so the graph has the minimum number
 * of columns while still respecting parent-child relationships.
 *
 * The algorithm walks commits newest-first. Each commit claims the lane
 * its first child expected it on (if any). Otherwise it grabs the left-
 * most free lane. Its first parent inherits the same lane; additional
 * parents (merges) spawn new lanes.
 */
function assignLanes(commits: CommitSummary[]): {
  assignments: LaneAssignment[];
  commitIndex: Map<string, number>;
  totalLanes: number;
} {
  const assignments: LaneAssignment[] = [];
  const commitIndex = new Map<string, number>();
  commits.forEach((c, i) => commitIndex.set(c.hash_full, i));

  // `lanes[i]` = the commit hash we're currently expecting to show up in
  // lane i (because a row above declared it as a parent). null = free.
  const lanes: Array<string | null> = [];
  const commitLane = new Map<string, number>();
  let maxLane = 0;

  for (const c of commits) {
    // 1. Pick this commit's lane.
    let myLane = commitLane.get(c.hash_full);
    if (myLane === undefined) {
      // Not expected by anyone above — take the first free slot.
      myLane = lanes.findIndex((l) => l === null);
      if (myLane === -1) {
        myLane = lanes.length;
        lanes.push(null);
      }
    }
    // This commit has now "consumed" its slot; free the lane in case no
    // parent takes it (root commit, branch tip off-screen).
    lanes[myLane] = null;

    // 2. Place parents into lanes. First parent inherits our lane when
    //    that lane is still free; other parents take fresh slots.
    c.parents.forEach((parent, pIdx) => {
      if (commitLane.has(parent)) return; // already expected
      let lane: number;
      if (pIdx === 0 && lanes[myLane!] === null) {
        lane = myLane!;
      } else {
        const free = lanes.findIndex((l) => l === null);
        if (free === -1) {
          lane = lanes.length;
          lanes.push(null);
        } else {
          lane = free;
        }
      }
      lanes[lane] = parent;
      commitLane.set(parent, lane);
    });

    assignments.push({
      lane: myLane,
      passingLanes: lanes.slice(),
    });
    maxLane = Math.max(maxLane, lanes.length);
  }

  return { assignments, commitIndex, totalLanes: maxLane };
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? '#60a5fa';
}

export function GraphPanel({ serviceId, refreshTick, onSelectCommit }: GraphPanelProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState<string>('__all__');
  const [branches, setBranches] = useState<string[]>([]);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  // Client-side filter — same UX as HistoryPanel's search box. Matches
  // subject, author, full hash, short hash and refs (branch / tag
  // labels). The graph layout still uses the *full* commit set, so the
  // SVG topology never reshuffles when typing — we only dim non-matches.
  // That keeps spatial memory intact while making targets findable.
  const [commitSearch, setCommitSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [list, brs] = await Promise.all([
          ipc.gitLog(
            serviceId,
            branchFilter === '__head__'
              ? null
              : branchFilter === '__all__'
                ? '--all'
                : branchFilter,
            300,
          ),
          ipc.gitBranches(serviceId),
        ]);
        if (cancelled) return;
        setCommits(list);
        setBranches(brs);
      } catch (err) {
        console.error('Failed to load graph', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, branchFilter, refreshTick]);

  const { assignments, commitIndex, totalLanes } = useMemo(() => assignLanes(commits), [commits]);

  // Build a set of matching hashes for the dim-by-default highlight
  // logic. We deliberately don't *filter* commits — that would re-flow
  // the graph and destroy spatial memory. Instead matching rows stay
  // bright while everything else fades, exactly like gitk's `Find`.
  const commitSearchTrim = commitSearch.trim().toLowerCase();
  const matchedHashes = useMemo(() => {
    if (!commitSearchTrim) return null;
    const set = new Set<string>();
    for (const c of commits) {
      const hay = [c.subject, c.author, c.email, c.hash_full, c.hash_short, ...c.refs]
        .join(' ')
        .toLowerCase();
      if (hay.includes(commitSearchTrim)) set.add(c.hash_full);
    }
    return set;
  }, [commits, commitSearchTrim]);
  const matchedCount = matchedHashes?.size ?? 0;

  const branchOptions: BranchPickerOption[] = useMemo(() => {
    const out: BranchPickerOption[] = [
      { value: '__all__', label: 'All branches' },
      { value: '__head__', label: 'Current HEAD only' },
    ];
    for (const b of branches) {
      out.push({ value: b, label: b, group: 'Branches' });
    }
    return out;
  }, [branches]);

  const graphWidth = LEFT_PAD + totalLanes * LANE_W + LANE_W;
  const svgHeight = commits.length * ROW_H;

  const laneX = (lane: number) => LEFT_PAD + lane * LANE_W + LANE_W / 2;
  const rowY = (i: number) => i * ROW_H + ROW_H / 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <BranchPicker
          value={branchFilter}
          onChange={setBranchFilter}
          options={branchOptions}
          className="w-56"
        />
        {/* Inline search — substring match on subject, author, hash, refs */}
        <div className="border-border bg-surface focus-within:border-accent/50 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border px-2 transition-colors">
          <Search size={11} className="text-fg/40 shrink-0" />
          <input
            type="text"
            value={commitSearch}
            onChange={(e) => setCommitSearch(e.target.value)}
            placeholder="Search commits, hashes, authors…"
            spellCheck={false}
            className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          />
          {commitSearch && (
            <button
              onClick={() => setCommitSearch('')}
              className="text-fg/40 hover:text-fg shrink-0 cursor-pointer transition"
              title="Clear"
              type="button"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <span className="text-fg/40 shrink-0 text-[11px] tabular-nums">
          {commitSearchTrim
            ? `${matchedCount}/${commits.length}`
            : `${commits.length} commit${commits.length === 1 ? '' : 's'}`}
        </span>
        {loading && (
          <span className="text-fg/40 flex shrink-0 items-center gap-1 text-[11px]">
            <RefreshCw size={11} className="animate-spin" />
            Loading…
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {commits.length === 0 && !loading ? (
          <div className="text-fg/40 flex h-full items-center justify-center text-xs">
            No commits yet
          </div>
        ) : (
          <div className="relative" style={{ minHeight: svgHeight, paddingLeft: graphWidth }}>
            {/* SVG layer — positioned absolutely so the rows on the right can
                flow natively and stay accessible. */}
            <svg
              className="pointer-events-none absolute top-0 left-0"
              width={graphWidth}
              height={svgHeight}
            >
              {commits.map((c, i) => {
                const a = assignments[i];
                if (!a) return null;
                const x1 = laneX(a.lane);
                const y1 = rowY(i);
                return (
                  <g key={c.hash_full}>
                    {/* Lines down to each parent */}
                    {c.parents.map((p, pIdx) => {
                      const parentIdx = commitIndex.get(p);
                      if (parentIdx === undefined) return null;
                      const pa = assignments[parentIdx];
                      if (!pa) return null;
                      const x2 = laneX(pa.lane);
                      const y2 = rowY(parentIdx);
                      const color = laneColor(pIdx === 0 ? a.lane : pa.lane);
                      // Vertical segment then (optional) gentle curve to the
                      // parent lane. Using a cubic bezier keeps merges
                      // visually smooth at dense zoom levels.
                      const d =
                        x1 === x2
                          ? `M${x1},${y1} L${x2},${y2}`
                          : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
                      return (
                        <path
                          key={p + pIdx}
                          d={d}
                          stroke={color}
                          strokeWidth={1.6}
                          fill="none"
                          opacity={0.85}
                        />
                      );
                    })}
                    {/* Commit dot — merge commits are drawn hollow so they
                        read as "joining" at a glance. */}
                    <circle
                      cx={x1}
                      cy={y1}
                      r={DOT_R}
                      fill={c.parents.length > 1 ? 'var(--color-surface)' : laneColor(a.lane)}
                      stroke={laneColor(a.lane)}
                      strokeWidth={2}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Right-side commit rows */}
            <div className="absolute top-0 right-0 left-0" style={{ paddingLeft: graphWidth }}>
              {commits.map((c) => {
                const hue = authorHue(c.author);
                const isMerge = c.parents.length > 1;
                const isHovered = hoveredHash === c.hash_full;
                // When a search is active, bright = match, dim = miss.
                // Topology never changes; only opacity fades.
                const isDimmed = matchedHashes !== null && !matchedHashes.has(c.hash_full);
                return (
                  <div
                    key={c.hash_full}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 text-[12px] transition-colors',
                      isHovered ? 'bg-fg/6' : '',
                      isDimmed && 'opacity-30',
                    )}
                    style={{ height: ROW_H }}
                    onMouseEnter={() => setHoveredHash(c.hash_full)}
                    onMouseLeave={() => setHoveredHash((cur) => (cur === c.hash_full ? null : cur))}
                    onClick={() => onSelectCommit?.(c.hash_full)}
                    title={c.subject}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
                    >
                      {initialsFor(c.author)}
                    </span>
                    <code className="bg-fg/10 text-fg/60 shrink-0 rounded px-1 py-px font-mono text-[9.5px]">
                      {c.hash_short}
                    </code>
                    {isMerge && (
                      <GitBranch size={10} className="shrink-0 text-sky-400/80" strokeWidth={2} />
                    )}
                    <span className="text-fg truncate">{c.subject}</span>
                    {c.refs.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1">
                        {c.refs.map((ref) => {
                          const clean = ref.replace(/^HEAD -> /, '');
                          const isHead = ref.startsWith('HEAD ');
                          const isTag = clean.startsWith('tag: ');
                          return (
                            <span
                              key={ref}
                              className={cn(
                                'inline-flex items-center gap-0.5 rounded border px-1 py-px text-[9px]',
                                isHead
                                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                                  : isTag
                                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                                    : 'border-sky-400/30 bg-sky-400/10 text-sky-300',
                              )}
                            >
                              {isTag ? <Tag size={8} /> : <GitBranch size={8} />}
                              {clean.replace(/^tag: /, '')}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <span className="text-fg/50 ml-auto shrink-0 text-[10.5px]">{c.author}</span>
                    <span className="text-fg/40 shrink-0 text-[10.5px] tabular-nums">
                      {timeAgo(c.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
