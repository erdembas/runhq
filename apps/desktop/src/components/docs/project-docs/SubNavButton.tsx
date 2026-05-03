import { cn } from '@/lib/cn';
import type { ProjectDoc } from '@/types';
import { KIND_META } from './docKindMeta';

interface SubNavButtonProps {
  doc: ProjectDoc;
  active: boolean;
  onSelect: (path: string) => void;
  label?: string;
  depth?: number;
}

export function SubNavButton({ doc, active, onSelect, label, depth = 0 }: SubNavButtonProps) {
  const meta = KIND_META[doc.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect(doc.relative_path)}
      title={doc.relative_path}
      className={cn(
        'group flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-[12px] transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-fg-dim')}>{meta.icon}</span>
      <span className="min-w-0 flex-1 truncate">{label ?? doc.display_name}</span>
    </button>
  );
}
