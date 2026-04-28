import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AiProvider } from '@/types';

/**
 * Floating popover that anchors below a trigger element and lets
 * the user pick a configured AI provider. Portaled to `document.body`
 * so it can escape parent overflow:hidden / clip-path constraints
 * (cards, drawers, scroll containers).
 *
 * Positioning is computed against the anchor's bounding rect on
 * mount and re-run on resize/scroll — the user doesn't see the
 * popover detach if they scroll the underlying surface while it's
 * open. We don't follow the anchor with rAF: scrolling auto-closes
 * via the click-outside handler anyway, and a re-position on every
 * scroll tick would be unnecessarily expensive.
 *
 * Used internally by `useAiSurfaceTrigger` — call sites should reach
 * for the hook, not this component directly.
 */
export function ModelChooserPopover<T extends HTMLElement>({
  anchorRef,
  providers,
  onSelect,
  onDismiss,
}: {
  anchorRef: RefObject<T>;
  providers: AiProvider[];
  onSelect: (p: AiProvider) => void;
  onDismiss: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const POPOVER_W = 260;
  const GAP = 6;

  // Position the popover under the trigger's bottom-left corner.
  // Clamp to viewport so it never hangs off-screen on narrow
  // windows or when the trigger sits at the right edge of a card.
  useLayoutEffect(() => {
    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_W - 8));
      const top = rect.bottom + GAP;
      setPos({ top, left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchorRef]);

  // Click-outside / Escape to dismiss. We exclude both the popover
  // body and the anchor — clicking the anchor again should NOT be
  // interpreted as "outside" (it would race the trigger's onClick
  // and re-open the popover after we just closed it).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current && anchorRef.current.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onDismiss]);

  // Don't render until we have a position — avoids a one-frame
  // flash at top-left before useLayoutEffect runs.
  if (!pos) return null;

  const node = (
    <div
      ref={popoverRef}
      role="listbox"
      aria-label="Choose an AI model"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: POPOVER_W,
      }}
      className={cn(
        'bg-surface-raised border-border/80 rounded-app overflow-hidden border',
        'z-[60] shadow-lg shadow-black/30',
      )}
    >
      <div
        className={cn(
          'border-border/60 bg-accent/8 text-accent border-b px-2.5 py-1.5',
          'text-[10.5px] font-medium tracking-wide uppercase',
        )}
      >
        Pick a model to send
      </div>
      <div className="max-h-[280px] overflow-y-auto py-1">
        {providers.length === 0 ? (
          <div className="text-fg-dim px-2.5 py-2 text-[11px]">No providers configured.</div>
        ) : (
          providers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.default}
              onClick={() => onSelect(p)}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                'hover:bg-fg/5',
                p.default && 'bg-accent/8',
              )}
            >
              <Sparkles
                className={cn('h-3 w-3 shrink-0', p.default ? 'text-accent' : 'text-fg-dim/70')}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate text-[11.5px] font-medium',
                    p.default ? 'text-fg' : 'text-fg/85',
                  )}
                >
                  {p.name}
                </div>
                {p.model && (
                  <div className="text-fg-dim/70 truncate font-mono text-[10px]">{p.model}</div>
                )}
              </div>
              {p.default && <Check className="text-accent h-3 w-3 shrink-0" />}
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          onDismiss();
          window.dispatchEvent(new CustomEvent('runhq:open-ai-settings'));
        }}
        className={cn(
          'border-border/60 text-fg-dim hover:text-fg hover:bg-fg/5',
          'flex w-full items-center gap-1.5 border-t px-2.5 py-1.5 text-[11px] transition-colors',
        )}
      >
        <Settings className="h-3 w-3 shrink-0" />
        Manage providers…
      </button>
    </div>
  );

  return createPortal(node, document.body);
}
