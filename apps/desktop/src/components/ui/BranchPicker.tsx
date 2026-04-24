import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, GitBranch, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface BranchPickerOption {
  value: string;
  label: string;
  /** Optional grouping label. Items with the same `group` are rendered
   *  under one heading; ungrouped items appear at the top. */
  group?: string;
  /** Optional icon override; defaults to a branch glyph for grouped
   *  branches and nothing for the synthetic "All / HEAD" pseudo-options. */
  icon?: ReactNode;
}

interface BranchPickerProps {
  value: string;
  onChange: (value: string) => void;
  options: BranchPickerOption[];
  placeholder?: string;
  /** Width of the trigger. The popover width follows the trigger so the
   *  combobox feels anchored, exactly like shadcn's `<Combobox>`. */
  className?: string;
  /** Disabled state — used while branches are still loading. */
  disabled?: boolean;
}

/**
 * shadcn-style searchable combobox for selecting a branch (or any
 * branch-shaped option set). Behaviourally:
 *
 * - Click trigger → popover opens, search input auto-focused.
 * - Type to filter, ↑/↓ to navigate, ↵ to commit, Esc to dismiss.
 * - Click outside → dismiss without changing selection.
 *
 * No external deps — built directly on a portal so it can escape
 * overflow:hidden ancestors (e.g. the Source Control modal). The
 * keyboard contract mirrors `cmdk`/shadcn so muscle memory carries.
 */
export function BranchPicker({
  value,
  onChange,
  options,
  placeholder = 'Select branch…',
  className,
  disabled,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    flipped: boolean;
  } | null>(null);

  const selected = options.find((o) => o.value === value);

  // Filter + group. The "ungrouped" bucket is rendered first because it
  // always holds the meta-options ("All branches", "Current HEAD"), and
  // burying those below the long branch list was the whole reason the
  // native <select> looked bad in the first place.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
        )
      : options;
    const map = new Map<string, BranchPickerOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return Array.from(map.entries()); // [groupName, items][]
  }, [options, query]);

  // Flatten for keyboard-nav indexing. Group headings don't get an
  // index — they're decoration.
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  // Reset highlight whenever filter changes so ↵ never lands on a stale
  // index that's now outside the filtered list.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  // Position the popover. Anchored to the trigger, width-matched, with a
  // simple top/bottom flip if the natural placement would overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    if (!t) return;
    const rect = t.getBoundingClientRect();
    const margin = 6;
    const desiredHeight = Math.min(360, window.innerHeight - rect.bottom - margin);
    const fitsBelow = window.innerHeight - rect.bottom > 220;
    const flipped = !fitsBelow;
    const top = flipped ? Math.max(margin, rect.top - desiredHeight - 4) : rect.bottom + 4;
    setPos({
      left: rect.left,
      top,
      width: rect.width,
      flipped,
    });
  }, [open]);

  // Outside-click / Esc to dismiss.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Don't bubble up to the parent's Esc handler (e.g. the
        // DiffViewer close-confirm). Closing the popover should feel
        // local, not nuke the surrounding modal.
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onMouseDown, true);
    // Capture so we beat the parent listener if both are attached on
    // window. Stops Esc from also triggering the DiffViewer flow.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Auto-focus the search input on open.
  useEffect(() => {
    if (open) {
      // Defer one tick so the portal node is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Auto-scroll the highlighted item into view.
  useEffect(() => {
    if (!open) return;
    const el = popoverRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = flat[activeIdx];
      if (it) commit(it.value);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(Math.max(0, flat.length - 1));
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'border-border bg-surface text-fg hover:bg-fg/5 flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors',
          'focus:border-accent/60 focus:outline-none',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <GitBranch size={11} className="text-fg/50 shrink-0" />
        <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-fg/50')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown size={11} className="text-fg/40 shrink-0" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            // Standalone listbox (not inside a dialog) — gives our
            // DiffViewer Esc handler a hint to defer to us via the
            // `[role="listbox"]` selector if we ever add it there.
            className="border-border bg-surface-overlay animate-fade-in fixed z-10001 flex flex-col overflow-hidden rounded-md border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            style={{
              left: pos.left,
              top: pos.top,
              width: Math.max(pos.width, 240),
              maxHeight: 360,
            }}
          >
            <div className="border-border bg-surface flex items-center gap-1.5 border-b px-2 py-1.5">
              <Search size={11} className="text-fg/40 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search…"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {flat.length === 0 && (
                <p className="text-fg/40 px-3 py-3 text-center text-[11px]">No matches</p>
              )}
              {groups.map(([groupName, items], gi) => (
                <div key={groupName || `__g${gi}`}>
                  {groupName && (
                    <div className="text-fg/40 px-3 pt-2 pb-1 text-[9.5px] font-semibold tracking-wider uppercase">
                      {groupName}
                    </div>
                  )}
                  {items.map((item) => {
                    const idx = flat.indexOf(item);
                    const isActive = idx === activeIdx;
                    const isSelected = item.value === value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-idx={idx}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => commit(item.value)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
                          isActive ? 'bg-accent/15 text-fg' : 'text-fg/80 hover:bg-fg/8',
                        )}
                      >
                        <span className="text-fg/50 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          {item.icon ?? (item.group ? <GitBranch size={11} /> : null)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {isSelected && <Check size={12} className="text-accent shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
