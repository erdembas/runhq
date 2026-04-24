import { cn } from '@/lib/cn';

interface HandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  role: 'separator';
  'aria-orientation': 'vertical';
  tabIndex: number;
}

interface Props {
  handleProps: HandleProps;
  dragging: boolean;
  /** Extra class names — useful for absolute positioning on the right
   *  edge of a sibling sidebar. */
  className?: string;
  /** Tooltip shown to the user. Defaults to something generic. */
  title?: string;
}

/**
 * Thin vertical splitter grip for sidebar panels. Renders as a 4px wide
 * invisible hit-area with a 1px accent-tinted line in the middle; the
 * line brightens on hover and while dragging so the user gets clear
 * feedback about what they're grabbing.
 *
 * Double-click resets to the default width — matches VSCode / JetBrains
 * behaviour so the muscle memory transfers.
 */
export function ResizeHandle({ handleProps, dragging, className, title }: Props) {
  return (
    <div
      {...handleProps}
      title={title ?? 'Drag to resize · double-click to reset · ←/→ to nudge'}
      className={cn('group relative z-10 w-1 shrink-0 cursor-col-resize select-none', className)}
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors',
          dragging ? 'bg-accent' : 'group-hover:bg-accent/60 bg-transparent',
        )}
      />
    </div>
  );
}
