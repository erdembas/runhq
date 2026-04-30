import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type DrawerWidth = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  /**
   * Drawer content. Should provide its own header with a Close
   * button — the drawer chrome intentionally doesn't add one so
   * panels with action toolbars (Save / Rescan / Generate notices) keep
   * a single coherent top bar instead of stacking two headers.
   */
  children: ReactNode;
  onClose: () => void;
  /** Optional `aria-label` for assistive tech (no visible title). */
  ariaLabel?: string;
  /**
   * Maximum drawer width. Calibrated against the most common content:
   *
   *   • sm  → 420px — narrow form / single-action surfaces
   *   • md  → 520px — default (Notes editor)
   *   • lg  → 680px — table-heavy (License compliance)
   *   • xl  → 840px — full triage (advisories/outdated)
   *
   * The drawer is `w-full` and capped by the chosen `max-w-*` so
   * narrow viewports still get a usable layout instead of an
   * overflowing fixed-width panel.
   */
  size?: DrawerWidth;
  /**
   * Where the drawer slides in from. `right` is the default and
   * matches the rest of the app's right-side detail patterns
   * (`ProjectDetailDrawer`, the AI/Activity rail). `left` is here
   * for future use (e.g. a navigation tray) and slides from the
   * sidebar side.
   */
  side?: 'right' | 'left';
}

const WIDTH: Record<DrawerWidth, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[680px]',
  xl: 'max-w-[840px]',
};

/**
 * Right-side slide-in drawer, scoped to the nearest positioned
 * ancestor.
 *
 * Matches the existing `ProjectDetailDrawer` pattern instead of
 * floating over the entire viewport: the drawer uses
 * `position: absolute inset-0 p-4` so it fills the dashboard
 * region (main column + activity rail) but leaves the OS title
 * bar and the global sidebar visible and clickable. The aside has
 * `rounded-app-lg` corners and a `max-w-*` cap on the right edge —
 * "a focused sub-tool inside this view" rather than "the rest of
 * the UI is dimmed and inaccessible".
 *
 * Why scoped, not portal-to-body
 * ------------------------------
 * An earlier iteration portaled to `document.body` to dodge the
 * `backdrop-filter` containing-block trap inside `ServiceCard`'s
 * `.glass`. That solved the trapping problem but produced a
 * different one: the drawer now floated over the titlebar /
 * sidebar / activity rail too, which felt like a heavy modal
 * (user feedback: "drawer çok saçma"). The fix is to lift the
 * overlay state UP — out of `ServiceCard` and into the Dashboard
 * root, which has `position: relative` and is uncontaminated by
 * `transform`/`backdrop-filter`. With the parent being a normal
 * positioned ancestor again, the drawer scopes correctly to the
 * dashboard region with no portal needed.
 *
 * Mount contract
 * --------------
 * Render this drawer ONLY inside an ancestor that has
 * `position: relative` AND does NOT use `transform`,
 * `filter`, `backdrop-filter`, `perspective`, `contain`, or
 * `will-change` of any of those — those properties create a new
 * containing block and the `inset-0` will scope to the wrong
 * box. The `Dashboard` root is the canonical mount point.
 */
export function Drawer({ children, onClose, ariaLabel, size = 'md', side = 'right' }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="absolute inset-0 z-60 flex p-4"
      onClick={onClose}
    >
      <div
        aria-hidden
        className="motion-safe:animate-in motion-safe:fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px] motion-safe:duration-200"
      />
      <aside
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-surface border-border rounded-app-lg relative z-10 flex h-full w-full flex-col overflow-hidden border shadow-2xl',
          // Slide-in animation — fast (180ms) so it doesn't feel
          // sluggish on a click-and-glance interaction. The
          // `motion-safe` qualifier respects the OS "reduce
          // motion" setting; reduced-motion users get an instant
          // open with no transform.
          'motion-safe:animate-in motion-safe:duration-200',
          side === 'right'
            ? 'motion-safe:slide-in-from-right ml-auto'
            : 'motion-safe:slide-in-from-left mr-auto',
          WIDTH[size],
        )}
      >
        {children}
      </aside>
    </div>
  );
}
