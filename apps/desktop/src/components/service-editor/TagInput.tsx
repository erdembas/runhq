import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { CATEGORIES } from '@/lib/categories';
import { cn } from '@/lib/cn';
import { TagChip } from '@/components/ui/TagChip';
import { createPortal } from 'react-dom';

/**
 * Combobox-style tag picker.
 *
 * Replaces the previous "text input + a separate row of predefined chips"
 * pattern, which left users unsure whether to type or click. Here there's a
 * single input: focus reveals a dropdown with the predefined categories and
 * a "Create …" fallback, so typing and picking are two ways into the same
 * affordance rather than competing UI.
 */
export function TagInput({
  tags,
  draft,
  setDraft,
  onAdd,
  onRemove,
}: {
  tags: string[];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  i18n.useLocale();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const q = draft.trim().toLowerCase();
  const available = useMemo(() => CATEGORIES.filter((c) => !tags.includes(c.key)), [tags]);
  const filtered = useMemo(
    () =>
      q
        ? available.filter(
            (c) => c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
          )
        : available,
    [available, q],
  );

  const canCreate = q.length > 0 && !tags.includes(q) && !CATEGORIES.some((c) => c.key === q);

  const totalOptions = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [open]);

  useEffect(() => {
    if (highlight >= totalOptions) setHighlight(0);
  }, [totalOptions, highlight]);

  const commit = (value: string) => {
    onAdd(value);
    setHighlight(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pickAt = (idx: number) => {
    if (idx < filtered.length) {
      const opt = filtered[idx];
      if (opt) commit(opt.key);
    } else if (canCreate) {
      commit(q);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (totalOptions === 0 ? 0 : (h + 1) % totalOptions));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (totalOptions === 0 ? 0 : (h - 1 + totalOptions) % totalOptions));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (totalOptions === 0) return;
      pickAt(open ? highlight : 0);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      const last = tags[tags.length - 1];
      if (last !== undefined) onRemove(last);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'border-border bg-surface-raised rounded-app-sm flex min-h-[32px] flex-wrap items-center gap-1 border px-2 py-1 transition',
          open && 'border-accent',
        )}
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {tags.map((t) => (
          <TagChip key={t} tag={t} onRemove={() => onRemove(t)} />
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={tags.length ? '' : i18n.t('Add category — frontend, worker, …')}
          className="text-fg placeholder:text-fg-dim min-w-[120px] flex-1 bg-transparent text-[11px] focus:outline-none"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="tag-combobox-list"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
            inputRef.current?.focus();
          }}
          className="text-fg-dim hover:text-fg-muted shrink-0 transition"
          aria-label={open ? i18n.t('Close suggestions') : i18n.t('Open suggestions')}
        >
          <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
        </button>
      </div>

      {open &&
        totalOptions > 0 &&
        createPortal(
          <ul
            id="tag-combobox-list"
            role="listbox"
            style={dropdownStyle}
            className="border-border bg-surface-raised rounded-app-sm animate-fade-in max-h-[240px] overflow-y-auto border py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          >
            {filtered.map((c, idx) => {
              const active = highlight === idx;
              return (
                <li
                  key={c.key}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickAt(idx);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[11px] transition',
                    active ? 'bg-surface-overlay text-fg' : 'text-fg-muted',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', c.dot)} />
                  <span className="font-medium">{c.label}</span>
                  <span className="text-fg-dim truncate text-[10px]">{c.description}</span>
                </li>
              );
            })}
            {canCreate && (
              <li
                role="option"
                aria-selected={highlight === filtered.length}
                onMouseEnter={() => setHighlight(filtered.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickAt(filtered.length);
                }}
                className={cn(
                  'border-border/60 flex cursor-pointer items-center gap-2 border-t px-2.5 py-1.5 text-[11px] transition',
                  highlight === filtered.length ? 'bg-surface-overlay text-fg' : 'text-fg-muted',
                )}
              >
                <Plus className="text-accent h-3 w-3 shrink-0" />
                <span>
                  {i18n.rich('Create {value1}', {
                    value1: <span className="text-fg font-medium">&ldquo;{q}&rdquo;</span>,
                  })}
                </span>
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
