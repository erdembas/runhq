import { RailTile } from './RailTile';
import type { Tone } from './model';

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
export function TriageRail({
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
