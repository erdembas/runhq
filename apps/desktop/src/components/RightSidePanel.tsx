import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { AiChatPanel } from '@/components/ai/AiChatPanel';
import { cn } from '@/lib/cn';

/** Keep panel state mounted, but resize the workspace only once per toggle.
 * Animating width repeatedly reflows every visible editor and resizes its PTY.
 */
export function RightSidePanel() {
  i18n.useLocale();
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

  // Mount on first use; keep drafts, filters and scroll positions on close.
  const hasOpenedActivity = useRef(false);
  const hasOpenedAi = useRef(false);
  if (active === 'activity') hasOpenedActivity.current = true;
  if (active === 'ai') hasOpenedAi.current = true;

  const isOpen = active != null;
  const renderedWidth = isOpen ? width : 0;

  return (
    <aside
      className={cn(
        'chrome-gradient bg-surface-raised relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden',
        isOpen && 'border-border/70 border-l',
      )}
      style={{ width: renderedWidth }}
      aria-hidden={!isOpen}
    >
      <div className="absolute inset-y-0 right-0 flex flex-col" style={{ width }}>
        {isOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={i18n.t('Resize side panel')}
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
          {hasOpenedActivity.current && (
            <div className={active === 'activity' ? 'flex h-full min-h-0 flex-1' : 'hidden'}>
              <ActivityTimeline variant="inline" embedded visible={active === 'activity'} />
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
