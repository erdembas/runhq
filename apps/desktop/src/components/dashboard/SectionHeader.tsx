import { cn } from '@/lib/cn';

export function SectionHeader({
  icon,
  dotClass,
  dotStyle,
  label,
  labelClass,
  labelStyle,
  tone,
  count,
  runningCount,
  onClick,
  actions,
}: {
  icon?: React.ReactNode;
  dotClass?: string;
  dotStyle?: React.CSSProperties;
  label: string;
  labelClass?: string;
  labelStyle?: React.CSSProperties;
  tone?: 'accent';
  count: number;
  runningCount: number;
  onClick?: () => void;
  actions?: React.ReactNode;
}) {
  const headerTint =
    tone === 'accent'
      ? 'bg-accent/5 border-accent/20 hover:bg-accent/10'
      : 'hover:bg-surface-muted/60';
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';
  return (
    <div
      className={cn(
        'group/header rounded-app relative flex items-center gap-2.5 border px-3 py-2 transition',
        tone === 'accent' ? 'border-accent/25' : 'border-transparent',
        headerTint,
      )}
    >
      <Wrapper
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 text-left',
          onClick && 'transition hover:opacity-85',
        )}
      >
        {icon && (
          <span className="text-accent bg-accent/10 flex h-5 w-5 items-center justify-center rounded-md">
            {icon}
          </span>
        )}
        {(dotClass || dotStyle) && (
          <span className={cn('h-2 w-2 rounded-sm', dotClass)} style={dotStyle} />
        )}
        <h2
          className={cn(
            'text-[12px] font-semibold tracking-[0.12em] uppercase',
            tone === 'accent' ? 'text-accent' : (labelClass ?? 'text-fg'),
          )}
          style={labelStyle}
        >
          {label}
        </h2>
        <span className="bg-surface-muted text-fg-dim rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {count}
        </span>
        {runningCount > 0 && (
          <span className="bg-status-running/15 text-status-running inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
            <span className="bg-status-running h-1.5 w-1.5 rounded-full" />
            {runningCount} on
          </span>
        )}
      </Wrapper>
      {actions && (
        <div className="flex items-center gap-0.5 opacity-40 transition group-hover/header:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

export function HeaderAction({
  title,
  onClick,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: 'run' | 'danger';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'run'
      ? 'hover:bg-status-running/12 hover:text-status-running'
      : tone === 'danger'
        ? 'hover:bg-status-error/12 hover:text-status-error'
        : 'hover:bg-accent/10 hover:text-fg';
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'text-fg-dim flex h-7 w-7 items-center justify-center rounded-md transition',
        toneClass,
      )}
    >
      {children}
    </button>
  );
}
