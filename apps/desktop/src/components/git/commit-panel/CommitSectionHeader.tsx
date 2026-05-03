import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface CommitSectionHeaderProps {
  title: string;
  count: number;
  totalCount?: number;
  searching?: boolean;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}

export function CommitSectionHeader({
  title,
  count,
  totalCount,
  searching,
  expanded,
  onToggle,
  actions,
}: CommitSectionHeaderProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const showRatio = searching && typeof totalCount === 'number' && totalCount !== count;

  return (
    <div className="text-fg/60 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
      <button
        onClick={onToggle}
        className="hover:text-fg flex min-w-0 flex-1 items-center gap-1 text-left transition"
      >
        <Chevron size={11} className="text-fg/40" />
        <span>{title}</span>
        <span className="bg-fg/10 text-fg/60 rounded px-1 py-px text-[9px] tabular-nums">
          {showRatio ? `${count}/${totalCount}` : count}
        </span>
      </button>
      {actions}
    </div>
  );
}
