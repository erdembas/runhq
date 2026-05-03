import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ActionButtonProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  badge?: string;
}

export function ActionButton({
  disabled,
  loading,
  onClick,
  icon,
  label,
  title,
  badge,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'btn-chrome text-fg rounded-app-sm relative flex h-7 min-w-0 items-center justify-center gap-1.5 px-2 text-[11.5px] font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {loading ? <RefreshCw className="h-3 w-3 shrink-0 animate-spin" /> : icon}
      <span className="truncate">{label}</span>
      {badge !== undefined && !loading && (
        <span className="bg-accent/25 text-accent rounded px-1 font-mono text-[9.5px] leading-[14px] tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
