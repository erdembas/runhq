import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { formatReleaseDate } from './model';
import type { WhatsNewRelease } from '@/lib/whatsnew';

interface ReleaseRowProps {
  release: WhatsNewRelease;
  selected: boolean;
  isRunning: boolean;
  isLatest: boolean;
  onSelect: () => void;
}

export function ReleaseRow({ release, selected, isRunning, isLatest, onSelect }: ReleaseRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group rounded-app-sm relative flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-muted/50 hover:text-fg',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            selected ? 'bg-accent' : 'bg-border group-hover:bg-fg-dim',
          )}
        />
        <span className="font-mono text-[12px] font-semibold tracking-tight tabular-nums">
          v{release.version}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isLatest && <Badge tone="accent">Latest</Badge>}
          {isRunning && <Badge tone="success">Running</Badge>}
        </div>
      </div>
      <span className="text-fg-dim/90 ml-4 truncate text-[11px]">
        {formatReleaseDate(release.releasedAt)}
      </span>
      <span className="text-fg-dim ml-4 line-clamp-1 text-[11px]">{release.headline}</span>
    </button>
  );
}
