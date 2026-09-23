import * as i18n from '@runhq/cockpit-ui/i18n';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { categoryForTags } from '@/lib/categories';

interface Props {
  tag: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function TagChip({ tag, onRemove, onClick, active, size = 'sm' }: Props) {
  i18n.useLocale();
  const category = categoryForTags([tag]);
  const sizing = size === 'md' ? 'text-[11px] px-2 py-0.5' : 'text-[11px] px-1.5 py-0.5';
  return (
    <span
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-app-sm inline-flex items-center gap-1 ring-1 transition',
        sizing,
        category.bg,
        category.color,
        category.ring,
        onClick && 'cursor-pointer hover:brightness-110',
        active && 'ring-2',
      )}
    >
      <span className="font-medium">{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex h-3 w-3 items-center justify-center opacity-60 hover:opacity-100"
          aria-label={i18n.t('Remove {tag}', { tag: tag })}
        >
          <X className="h-2 w-2" />
        </button>
      )}
    </span>
  );
}
