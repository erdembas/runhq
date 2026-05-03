import { statusLetterStyle } from '@/lib/gitDiff';

export function GitStatusLegend() {
  return (
    <div className="flex items-center gap-1" title="Added · Modified · Deleted · Renamed">
      {(
        [
          ['added', 'A'],
          ['modified', 'M'],
          ['deleted', 'D'],
          ['renamed', 'R'],
        ] as const
      ).map(([status, letter]) => (
        <span
          key={status}
          className="inline-flex items-center justify-center font-bold tabular-nums"
          style={{
            ...statusLetterStyle[status],
            height: 13,
            minWidth: 13,
            borderRadius: 3,
            paddingLeft: 2,
            paddingRight: 2,
            fontSize: 8,
            lineHeight: 1,
          }}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
