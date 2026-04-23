/**
 * Global "is this element currently scrolling?" tracker.
 *
 * Partners with the CSS in `styles.css` that makes scrollbar thumbs
 * transparent by default and visible only when a scrollable element
 * is either (a) hovered or (b) marked `data-scrolling="true"`.
 *
 * This module handles case (b) — mouse-wheel / trackpad / keyboard /
 * programmatic scroll, where the cursor may not be over the scrolling
 * element. We flag the element on `scroll`, then clear the flag after
 * a short idle window so the thumb fades back out.
 *
 * Implementation notes:
 *   • Listener is attached in the *capture* phase at the document
 *     root so it catches scroll events from every descendant without
 *     each scroll container having to opt in.
 *   • `passive: true` — we never call preventDefault, and passive
 *     listeners keep scrolling silky on trackpads.
 *   • Per-element idle timers live in a WeakMap so detached DOM nodes
 *     get garbage-collected without us manually cleaning up.
 *   • IDLE_MS is tuned to match the visual fade: too short and the
 *     thumb strobes between frames during a slow scroll; too long and
 *     the thumb hangs around after the user has stopped scrolling,
 *     defeating the auto-hide promise.
 */

const IDLE_MS = 700;

// eslint-disable-next-line no-undef -- DOM globals (Element, Event) are provided by lib.dom.d.ts; the `no-undef` rule pre-dates TypeScript's own resolution and flags them redundantly.
const timers = new WeakMap<Element, number>();

function onScroll(event: Event) {
  const target = event.target;
  // eslint-disable-next-line no-undef
  if (!(target instanceof Element)) return;
  target.setAttribute('data-scrolling', 'true');
  const existing = timers.get(target);
  if (existing !== undefined) window.clearTimeout(existing);
  const handle = window.setTimeout(() => {
    target.removeAttribute('data-scrolling');
    timers.delete(target);
  }, IDLE_MS);
  timers.set(target, handle);
}

let installed = false;

export function installScrollIdleTracker(): void {
  if (installed || typeof document === 'undefined') return;
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  installed = true;
}
