/* global Element, EventTarget */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

type Placement = 'top' | 'bottom';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  placement: Placement;
}

const GAP = 10;
const EDGE = 10;
const SHOW_DELAY_MS = 260;

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<Element | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const hide = () => {
      clearShowTimer();
      targetRef.current = null;
      setTooltip(null);
    };

    const showFor = (target: Element, delay: number) => {
      const text = readTooltipText(target);
      if (!text) {
        hide();
        return;
      }
      clearShowTimer();
      targetRef.current = target;
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        setTooltip(positionFor(target, text));
      }, delay);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = findTooltipTarget(event.target);
      if (!target || target === targetRef.current) return;
      showFor(target, SHOW_DELAY_MS);
    };

    const onPointerOut = (event: PointerEvent) => {
      const active = targetRef.current;
      if (!active) return;
      const next = event.relatedTarget;
      if (next instanceof Node && active.contains(next)) return;
      hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = findTooltipTarget(event.target);
      if (target) showFor(target, 80);
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', hideOnEscape);

    function hideOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') hide();
    }

    return () => {
      clearShowTimer();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', hideOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current || !targetRef.current) return;
    const next = positionFor(targetRef.current, tooltip.text, tooltipRef.current);
    if (
      Math.abs(next.x - tooltip.x) > 0.5 ||
      Math.abs(next.y - tooltip.y) > 0.5 ||
      next.placement !== tooltip.placement
    ) {
      setTooltip(next);
    }
  }, [tooltip]);

  if (!tooltip || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={cn(
        'pointer-events-none fixed z-[500] max-w-[320px] rounded-md border px-2.5 py-1.5',
        'border-border-strong/70 bg-surface-overlay/95 text-fg text-[11.5px] leading-snug font-medium whitespace-pre-line',
        'shadow-[0_14px_42px_rgba(0,0,0,0.36)] backdrop-blur-md',
        'animate-in fade-in-0 zoom-in-95 duration-100',
      )}
      style={{
        left: tooltip.x,
        top: tooltip.y,
        transform: tooltip.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {tooltip.text}
      <span
        aria-hidden
        className={cn(
          'bg-surface-overlay border-border-strong/70 absolute h-2 w-2 rotate-45 border',
          tooltip.placement === 'top'
            ? 'bottom-[-4px] left-1/2 -translate-x-1/2 border-t-0 border-l-0'
            : 'top-[-4px] left-1/2 -translate-x-1/2 border-r-0 border-b-0',
        )}
      />
    </div>,
    document.body,
  );
}

function findTooltipTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[title], [data-runhq-tooltip]');
}

function readTooltipText(target: Element): string | null {
  const title = target.getAttribute('title');
  if (title !== null) {
    const text = title.trim();
    target.removeAttribute('title');
    if (!text) {
      target.removeAttribute('data-runhq-tooltip');
      return null;
    }
    target.setAttribute('data-runhq-tooltip', title);
    ensureAccessibleName(target, text);
    return text;
  }
  const stored = target.getAttribute('data-runhq-tooltip')?.trim();
  return stored || null;
}

function ensureAccessibleName(target: Element, text: string): void {
  if (target.hasAttribute('aria-label')) return;
  if (!['BUTTON', 'A', 'INPUT'].includes(target.tagName)) return;
  if ((target.textContent ?? '').trim().length > 0) return;
  target.setAttribute('aria-label', text);
}

function positionFor(target: Element, text: string, tooltip?: HTMLDivElement): TooltipState {
  const rect = target.getBoundingClientRect();
  const width = tooltip?.offsetWidth ?? 0;
  const height = tooltip?.offsetHeight ?? 0;
  const centerX = rect.left + rect.width / 2;
  const half = width > 0 ? width / 2 : 0;
  const x =
    half > 0 ? Math.min(Math.max(centerX, EDGE + half), window.innerWidth - EDGE - half) : centerX;
  let placement: Placement = rect.top > (height || 48) + GAP + EDGE ? 'top' : 'bottom';
  if (
    placement === 'bottom' &&
    height > 0 &&
    rect.bottom + GAP + height > window.innerHeight - EDGE
  ) {
    placement = 'top';
  }
  const y = placement === 'top' ? rect.top - GAP : rect.bottom + GAP;
  return { text, x, y, placement };
}
