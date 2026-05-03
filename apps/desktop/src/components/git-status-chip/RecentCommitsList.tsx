import { timeAgo } from '@/lib/gitDiff';
import type { CommitSummary } from '@/types';

interface RecentCommitsListProps {
  commits: CommitSummary[];
  expanded: boolean;
  onToggle: () => void;
  onCopyHash: (hash: string) => void;
}

export function RecentCommitsList({
  commits,
  expanded,
  onToggle,
  onCopyHash,
}: RecentCommitsListProps) {
  if (commits.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-fg-dim hover:text-fg flex w-full items-center gap-1 text-[10px] tracking-wide uppercase transition"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Recent commits</span>
        <span className="tabular-nums">({commits.length})</span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5">
          {commits.map((commit) => (
            <li
              key={commit.hash_full}
              className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => onCopyHash(commit.hash_short)}
                className="text-fg-dim hover:text-fg font-mono transition focus:outline-none"
                title={`Copy ${commit.hash_short}`}
              >
                {commit.hash_short}
              </button>
              <span className="text-fg-muted min-w-0 flex-1 truncate" title={commit.subject}>
                {commit.subject}
              </span>
              <span className="text-fg-dim shrink-0 text-[10px] tabular-nums">
                {timeAgo(commit.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
