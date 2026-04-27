import { useCallback, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { AiChatPanel } from '@/components/ai/AiChatPanel';

/**
 * Host for whichever right-side panel is active in the rail. Lives
 * between the main content area and `<RightActivityBar />`, mirroring
 * VSCode's left-side {sidebar | activity bar} pair (just on the right
 * for us). When `rightPanel === null` this returns `null` and the
 * main column gets the full width; otherwise the panel is resizable
 * by dragging its left edge.
 *
 * Width is shared across both panels so toggling between Activity and
 * AI doesn't reflow the main content (and the user's painstakingly
 * dialled-in width survives the switch).
 */
export function RightSidePanel() {
  const active = useAppStore((s) => s.rightPanel);
  const width = useAppStore((s) => s.rightPanelWidth);
  const setWidth = useAppStore((s) => s.setRightPanelWidth);

  const resizing = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizing.current = true;
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
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released if the pointer left the window */
    }
  }, []);

  if (active == null) return null;

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
      // content column.
      className="chrome-gradient border-border/70 bg-surface-raised relative flex h-full min-h-0 shrink-0 flex-col border-l"
      style={{ width }}
    >
      {/* Left-edge resize handle.
          - Sits flush ON the left border (`left-0`), 6px wide so it's
            easy to grab on Retina without intruding visually.
          - Inner 2px strip lights up on hover/active to teach
            "this edge is draggable" — same idiom as SidebarRail.
          - `z-20` keeps it above the panel content so clicks at the
            very edge aren't swallowed by an inner element. */}
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

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Both panels are mounted to keep their internal state
            (chat history, scroll position, filter selections) alive
            when the user toggles between them. CSS hides the inactive
            one. Cheap by today's standards — neither panel runs a
            heavy render loop in the background. */}
        <div className={active === 'activity' ? 'flex h-full min-h-0 flex-1' : 'hidden'}>
          <ActivityTimeline variant="inline" embedded />
        </div>
        <div className={active === 'ai' ? 'flex h-full min-h-0 flex-1' : 'hidden'}>
          <AiChatPanel variant="inline" />
        </div>
      </div>
    </aside>
  );
}
