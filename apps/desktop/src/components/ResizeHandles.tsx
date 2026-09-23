import * as i18n from '@runhq/cockpit-ui/i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Invisible resize handles overlayed at the window's 4 edges and 4 corners.
 *
 * Why we need this even though `decorations: true` is set in Tauri:
 * on macOS with `titleBarStyle: "Overlay"` the visible window border is
 * effectively 0-1px, so users can't reliably grab the OS-level resize zone.
 * We draw 6-10px transparent strips with the correct CSS resize cursors and
 * defer the actual drag to Tauri's native `startResizeDragging`, giving us
 * native window behaviour with a much more generous grab area.
 */

type Dir =
  'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

function startResize(dir: Dir) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    void getCurrentWindow()
      .startResizeDragging(dir)
      .catch(() => {
        // startResizeDragging rejects when the window is not resizable
        // (e.g. fullscreen) — a no-op is the correct behaviour here.
      });
  };
}

// Thickness tuned so the strips feel grabbable without stealing clicks from
// adjacent chrome (title-bar buttons, status-bar icons, sidebar resize).
// Corners are noticeably larger than edges so diagonal resize is easy to hit.
const EDGE = 8;
const CORNER = 18;

export function ResizeHandles() {
  i18n.useLocale();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]" data-resize-handles>
      {/* Edges (drawn first so corners paint on top) */}
      <div
        onPointerDown={startResize('North')}
        className="pointer-events-auto absolute top-0 right-0 left-0"
        style={{ height: EDGE, cursor: 'ns-resize' }}
      />
      <div
        onPointerDown={startResize('South')}
        className="pointer-events-auto absolute right-0 bottom-0 left-0"
        style={{ height: EDGE, cursor: 'ns-resize' }}
      />
      <div
        onPointerDown={startResize('West')}
        className="pointer-events-auto absolute top-0 bottom-0 left-0"
        style={{ width: EDGE, cursor: 'ew-resize' }}
      />
      <div
        onPointerDown={startResize('East')}
        className="pointer-events-auto absolute top-0 right-0 bottom-0"
        style={{ width: EDGE, cursor: 'ew-resize' }}
      />

      {/* Corners */}
      <div
        onPointerDown={startResize('NorthWest')}
        className="pointer-events-auto absolute top-0 left-0"
        style={{ width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      />
      <div
        onPointerDown={startResize('NorthEast')}
        className="pointer-events-auto absolute top-0 right-0"
        style={{ width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      />
      <div
        onPointerDown={startResize('SouthWest')}
        className="pointer-events-auto absolute bottom-0 left-0"
        style={{ width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      />
      <div
        onPointerDown={startResize('SouthEast')}
        className="pointer-events-auto absolute right-0 bottom-0"
        style={{ width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      />
    </div>
  );
}
