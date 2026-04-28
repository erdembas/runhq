import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CollapsedRailProps {
  /** Lucide icon (or any glyph) shown at the top of the rail. Acts as
   *  a visual marker for *what* is collapsed — `History` for the
   *  commit list, `FolderTree` for the file tree, etc. */
  icon: ReactNode;
  /** Plain-text label rendered vertically (writing-mode rotated) so
   *  the user can still read what they hid even before hovering. */
  label: string;
  /** Optional badge — small numeric hint (commit count, file count)
   *  rendered below the icon. Keeps important context visible while
   *  the panel is shrunk. */
  badge?: ReactNode;
  /** Tooltip on the rail itself. Should explain what clicking does
   *  (e.g. "Show commit list"). */
  title: string;
  onExpand: () => void;
}

/**
 * 28px-wide vertical rail rendered in place of a side panel when the
 * user has collapsed it. Mimics VSCode's "primary side bar collapsed"
 * affordance: the column shrinks to a thin strip showing an icon, a
 * rotated label and a chevron pointing the way it'll re-expand.
 *
 * Click anywhere on the rail to expand. The whole strip is the hit
 * target so the user doesn't have to aim at the chevron precisely.
 *
 * Designed for tight rail compositions (DiffViewer with AI/Activity
 * panels open) where every horizontal pixel matters but the user
 * still needs a clear way to bring panels back.
 */
export function CollapsedRail({ icon, label, badge, title, onExpand }: CollapsedRailProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={title}
      aria-label={title}
      className={cn(
        'border-border bg-surface-raised/40 group flex w-7 shrink-0 cursor-pointer flex-col',
        'items-center gap-2 border-r py-2 transition-colors',
        'hover:bg-fg/6',
      )}
    >
      <span className="text-fg/50 group-hover:text-fg flex h-4 w-4 items-center justify-center transition-colors">
        {icon}
      </span>
      {badge !== undefined && (
        <span className="text-fg/40 text-[9px] font-medium tabular-nums">{badge}</span>
      )}
      {/* Rotated label uses CSS writing-mode so the glyphs orient
       *  bottom-to-top — natural reading angle when you tilt your head
       *  left, which is the convention for vertical UI text. */}
      <span
        className="text-fg/50 group-hover:text-fg/80 mt-1 flex-1 text-[10px] font-medium tracking-wide uppercase select-none"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </span>
      <ChevronRight
        size={11}
        className="text-fg/40 group-hover:text-fg/70 mt-auto transition-colors"
      />
    </button>
  );
}
