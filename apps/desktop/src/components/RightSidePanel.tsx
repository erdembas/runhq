import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { AiChatPanel } from '@/components/ai/AiChatPanel';
import { cn } from '@/lib/cn';

/**
 * Host for whichever right-side panel is active in the rail. Lives
 * between the main content area and `<RightActivityBar />`, mirroring
 * VSCode's left-side {sidebar | activity bar} pair (just on the right
 * for us).
 *
 * Open/close is animated rather than mount/unmount: when the user
 * toggles a panel off (or hits the `toggle_ai_panel` /
 * `toggle_activity_panel` shortcut) the aside slides closed by
 * easing its width to 0 — same idiom as `SidebarRail`'s collapse
 * animation, just on the opposite edge. Hard-unmounting the panel
 * (the previous behaviour) made the main content snap into the
 * freed space with no visual continuity, which felt jarring next
 * to the smoothly-animated left rail.
 *
 * Layout trick: the outer `<aside>` collapses its width while the
 * inner content wrapper stays anchored to the right edge at full
 * width via `position: absolute; right: 0`. With `overflow-hidden`
 * on the aside, the inner panel is *clipped from the left* as the
 * aside narrows — visually reading as "the panel slides out toward
 * the right" while the main column expands. Letting the inner
 * panel re-flow during the animation would force every chat row /
 * activity entry to re-layout for ~200ms, which both looks ugly
 * and burns CPU; the absolute-anchoring approach keeps the panel's
 * internal layout completely static.
 *
 * Width is shared across both panels (Activity, AI) so toggling
 * between them doesn't reflow the main content (and the user's
 * painstakingly dialled-in width survives the switch). Both panels
 * stay mounted the whole time — chat history / scroll position /
 * filter selections survive a close-and-reopen, and the inactive
 * panel's render cost is effectively free since neither runs a
 * hot loop in the background.
 */
export function RightSidePanel() {
  const active = useAppStore((s) => s.rightPanel);
  const width = useAppStore((s) => s.rightPanelWidth);
  const setWidth = useAppStore((s) => s.setRightPanelWidth);

  const resizing = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  // Mirrored into React state so the wrapper className flips
  // `transition-[width]` off mid-drag — without this the easing
  // curve fights every pointermove and resizing feels sticky.
  const [isResizing, setIsResizing] = useState(false);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizing.current = true;
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWRef.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizing.current) return;
      // The panel sits to the LEFT of the rail, so dragging the
      // grip leftward should *grow* the panel — same inversion as
      // the old ActivityTimeline overlay-resize logic.
      const delta = startXRef.current - e.clientX;
      setWidth(startWRef.current + delta);
    },
    [setWidth],
  );

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = false;
    setIsResizing(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released if the pointer left the window */
    }
  }, []);

  // While the aside is closed but mid-animation we still want the
  // browser to compute layout — but as soon as the close transition
  // ends we can disable pointer events entirely on the inner panel
  // so the (hidden) chat composer / activity controls don't steal
  // focus from elements the user can actually see.
  const [contentInteractive, setContentInteractive] = useState(active != null);
  useEffect(() => {
    if (active != null) {
      setContentInteractive(true);
      return;
    }
    // Match the CSS transition duration below. A short delay is
    // fine — pointer events are only disabled to prevent accidental
    // focus-stealing, not for safety, so we don't need precision.
    const t = window.setTimeout(() => setContentInteractive(false), 220);
    return () => window.clearTimeout(t);
  }, [active]);

  // Per-panel lazy mount: each inner panel (`<ActivityTimeline>`,
  // `<AiChatPanel>`) is multi-thousand lines and runs IPC
  // subscriptions / state machines on mount, so we defer mounting
  // until the user first opens that specific panel. Once mounted
  // we keep it mounted forever (chat history / scroll position
  // / filter selections survive close-and-reopen), so this is a
  // one-time cost paid exactly when the user signals interest in
  // the panel — not at app startup.
  //
  // The outer `<aside>` itself is always mounted regardless: it's
  // a single empty div at width 0 when nothing has ever been
  // opened, which is what lets the FIRST open animate from 0 → W
  // instead of popping in fully formed.
  const hasOpenedActivity = useRef(false);
  const hasOpenedAi = useRef(false);
  if (active === 'activity') hasOpenedActivity.current = true;
  if (active === 'ai') hasOpenedAi.current = true;

  const isOpen = active != null;
  const renderedWidth = isOpen ? width : 0;

  return (
    <aside
      // Chrome is intentionally a *byte-for-byte* match to
      // `SidebarRail`'s wrapper (left panel): same `chrome-gradient`
      // surface treatment, same `bg-surface-raised` base, same
      // `border-border/70`. The two side panels read as a matched
      // pair flanking the dashboard — anything subtler (a different
      // base shade, a different border alpha) makes the right side
      // visually feel like it's a different "kind" of UI than the
      // left, even when the user can't articulate why. The only
      // difference is `border-l` (vs left panel's `border-r`)
      // because each panel borders the side that faces the main
      // content column. The border collapses with the panel: it's
      // hidden when `isOpen` is false so a 1px sliver doesn't sit
      // wedged against the activity bar at rest.
      className={cn(
        'chrome-gradient bg-surface-raised relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden',
        isOpen && 'border-border/70 border-l',
        // Easing curve matched to SidebarRail (`duration-200`) so
        // the two panels read as part of the same animation system.
        // Disabled mid-resize so the user's drag isn't fought by
        // the easing function.
        !isResizing && 'transition-[width] duration-200 ease-out',
      )}
      style={{ width: renderedWidth }}
      aria-hidden={!isOpen}
    >
      {/* Inner content wrapper — anchored to the right edge at the
          panel's full width. The aside collapses around it; the
          wrapper's content never re-flows during the open/close
          animation, only its visible window changes. */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex flex-col',
          // Pointer events are blocked while the panel is "closed"
          // (post-transition) so the still-mounted chat composer /
          // activity controls can't steal focus from visible UI.
          contentInteractive ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        style={{ width }}
      >
        {/* Left-edge resize handle.
            - Sits flush ON the left border (`left-0`), 6px wide so it's
              easy to grab on Retina without intruding visually.
            - Inner 2px strip lights up on hover/active to teach
              "this edge is draggable" — same idiom as SidebarRail.
            - `z-20` keeps it above the panel content so clicks at the
              very edge aren't swallowed by an inner element.
            - Only rendered while the panel is actually open; a
              draggable edge on a 0-width element is unreachable
              anyway and would just give the user a weird ghost
              cursor on the boundary. */}
        {isOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="group absolute top-0 bottom-0 left-0 z-20 w-1.5 cursor-col-resize"
          >
            <div className="group-hover:bg-accent/40 group-active:bg-accent/60 absolute top-0 bottom-0 left-0 w-[2px] transition-colors" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Each panel is mounted on first open and then kept
              mounted so its internal state (chat history, scroll
              position, filter selections) survives toggling away
              and back. CSS hides the inactive one once both have
              been mounted. The `hasOpened*` refs guard the very
              first paint so the multi-thousand-line components
              don't pay their mount cost at app startup just
              because the aside shell is always present (we need
              the shell so the open animation has a 0-width state
              to transition out of). */}
          {hasOpenedActivity.current && (
            <div className={active === 'activity' ? 'flex h-full min-h-0 flex-1' : 'hidden'}>
              <ActivityTimeline variant="inline" embedded />
            </div>
          )}
          {hasOpenedAi.current && (
            <div className={active === 'ai' ? 'flex h-full min-h-0 flex-1' : 'hidden'}>
              <AiChatPanel variant="inline" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
