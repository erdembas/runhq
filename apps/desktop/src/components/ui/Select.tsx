import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional hint line under the label (eg. project path, service role). */
  description?: string;
  /** Optional hue (0-360) for a leading colored dot — handy for grouping. */
  hue?: number;
  disabled?: boolean;
}

interface SelectProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  ariaLabel?: string;
  /** Visual density; default 'sm' matches the compact feeds in the app. */
  size?: 'sm' | 'md';
  className?: string;
  /** Render an icon inside the trigger (to the left of the label). */
  leading?: React.ReactNode;
  disabled?: boolean;
}

const TRIGGER_SIZE = {
  sm: 'px-2.5 py-1 text-[11.5px] gap-1.5',
  md: 'px-3 py-1.5 text-[13px] gap-2',
} as const;

const ITEM_SIZE = {
  sm: 'px-2 py-1.5 text-[12px] gap-2',
  md: 'px-2.5 py-2 text-[13px] gap-2.5',
} as const;

interface TriggerRect {
  left: number;
  top: number;
  width: number;
  bottom: number;
  viewportHeight: number;
}

/**
 * Lightweight shadcn-style Select.
 *
 * Why not radix? This codebase intentionally hand-rolls its UI primitives
 * (see Dialog, Tabs, Switch). A single select does not justify the dependency
 * footprint; this implementation stays ~150 lines, handles keyboard + portal
 * + click-outside correctly, and matches the existing design language.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  ariaLabel,
  size = 'sm',
  className,
  leading,
  disabled,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<TriggerRect | null>(null);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const currentIdx = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({
      left: r.left,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      viewportHeight: window.innerHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measure();
    const onScroll = (e: Event) => {
      // Close on scroll of any ancestor EXCEPT the list itself — mirrors shadcn.
      if (listRef.current && listRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIdx(currentIdx >= 0 ? currentIdx : 0);
  }, [open, currentIdx]);

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIdx((prev) => {
        const len = options.length;
        if (len === 0) return -1;
        let next = prev;
        for (let i = 0; i < len; i++) {
          next = (next + delta + len) % len;
          if (!options[next]?.disabled) return next;
        }
        return prev;
      });
    },
    [options],
  );

  const onTriggerKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
    },
    [disabled],
  );

  const onListKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIdx(options.length - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[activeIdx];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      } else if (e.key === 'Tab') {
        setOpen(false);
      }
    },
    [activeIdx, moveActive, onChange, options],
  );

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-select-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // Decide whether to flip above — reserve 12px safety gap.
  const menuMaxHeight = 280;
  const flipAbove =
    rect !== null &&
    rect.viewportHeight - rect.bottom < menuMaxHeight + 12 &&
    rect.top > menuMaxHeight + 12;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'border-border/50 bg-surface text-fg/80 hover:bg-fg/5 focus:ring-accent/40 focus:border-accent/50 inline-flex min-w-0 items-center rounded-md border font-medium transition outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
          TRIGGER_SIZE[size],
          open && 'border-accent/50 ring-accent/40 ring-2',
          className,
        )}
      >
        {leading && <span className="text-fg/50 shrink-0">{leading}</span>}
        {selected?.hue !== undefined && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: `hsl(${selected.hue} 70% 60%)` }}
            aria-hidden
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            selected ? 'text-fg/85' : 'text-fg/40',
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={size === 'sm' ? 13 : 15}
          className={cn('text-fg/40 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onListKey}
            className={cn(
              'border-border bg-surface-overlay animate-in fade-in-0 zoom-in-95 fixed z-70 overflow-hidden rounded-md border p-1 shadow-xl duration-100',
              flipAbove ? 'slide-in-from-bottom-1' : 'slide-in-from-top-1',
            )}
            style={{
              left: rect.left,
              top: flipAbove ? undefined : rect.bottom + 4,
              bottom: flipAbove ? rect.viewportHeight - rect.top + 4 : undefined,
              minWidth: rect.width,
              maxWidth: Math.max(rect.width, 280),
              maxHeight: menuMaxHeight,
              overflowY: 'auto',
            }}
            onMouseDown={(e) => {
              // Prevent mousedown from moving focus out of the trigger before
              // the click fires; keyboard handlers remain attached to the
              // listbox via the `FocusOnMount` sentinel below.
              e.preventDefault();
            }}
          >
            <FocusOnMount />
            {options.length === 0 ? (
              <div className={cn('text-fg/40 px-2 py-2 text-[11.5px]')}>No options</div>
            ) : (
              options.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIdx;
                return (
                  <button
                    key={opt.value || `__empty-${i}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-select-idx={i}
                    disabled={opt.disabled}
                    onMouseEnter={() => !opt.disabled && setActiveIdx(i)}
                    onClick={() => {
                      if (opt.disabled) return;
                      onChange(opt.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={cn(
                      'flex w-full items-center rounded-sm text-left transition-colors',
                      ITEM_SIZE[size],
                      isActive ? 'bg-accent/12 text-accent' : 'text-fg/75',
                      opt.disabled && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    {opt.hue !== undefined ? (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: `hsl(${opt.hue} 70% 60%)` }}
                        aria-hidden
                      />
                    ) : (
                      <span className="w-2 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{opt.label}</span>
                      {opt.description && (
                        <span className="text-fg/40 mt-0.5 block truncate text-[10.5px]">
                          {opt.description}
                        </span>
                      )}
                    </span>
                    <Check
                      size={13}
                      className={cn(
                        'shrink-0 transition-opacity',
                        isSelected ? 'text-accent opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function FocusOnMount() {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    // Move focus into the popover so keyboard nav works immediately. We
    // attach it to a zero-size sentinel that hands focus to its parent.
    const host = ref.current?.parentElement;
    host?.focus();
  }, []);
  return <span ref={ref} className="sr-only" aria-hidden />;
}
