import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Search } from 'lucide-react';
import {
  LANGUAGE_OPTIONS,
  type LanguageOption,
} from '@/components/ai-provider-manager/languageOptions';
import { cn } from '@/lib/cn';

interface LanguagePickerProps {
  value: string;
  onChange: (next: string) => void;
  options?: LanguageOption[];
  searchPlaceholder?: string;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function LanguagePicker({
  value,
  onChange,
  options = LANGUAGE_OPTIONS,
  searchPlaceholder = 'Search languages…',
}: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = options.find((option) => option.value === value) ?? options[0]!;

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(query.trim());
    if (!normalizedQuery) return options;
    return options.filter(
      (option) =>
        normalize(option.label).includes(normalizedQuery) ||
        normalize(option.value).includes(normalizedQuery),
    );
  }, [options, query]);

  useEffect(() => {
    setFocusIdx((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!rootRef.current || !(event.target instanceof Node)) return;
      if (!rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusIdx((index) => Math.min(filtered.length - 1, index + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusIdx((index) => Math.max(0, index - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const option = filtered[focusIdx];
        if (option) {
          onChange(option.value);
          setOpen(false);
        }
      }
    };

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [filtered, focusIdx, onChange, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${focusIdx}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setFocusIdx(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
          setOpen((currentOpen) => !currentOpen);
        }}
        className={cn(
          'border-border bg-surface-muted/40 text-fg focus:border-accent/60 focus:bg-surface focus:ring-accent/20',
          'flex h-8 w-full items-center gap-2 rounded-md border px-2 text-[12px] transition outline-none focus:ring-2',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current.flag ? (
          <span className="text-[14px] leading-none">{current.flag}</span>
        ) : (
          <Globe className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1 truncate text-left">{current.label}</span>
        <ChevronDown className="text-fg-dim h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <div
          className={cn(
            'border-border bg-surface-raised absolute z-30 mt-1 flex w-full flex-col',
            'rounded-md border shadow-lg',
          )}
        >
          <div className="border-border/60 relative border-b px-2 py-1.5">
            <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-3.5 h-3 w-3 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className={cn(
                'bg-surface-muted/40 text-fg placeholder:text-fg-dim/70',
                'border-border/40 focus:border-accent/40 focus:ring-accent/15',
                'h-7 w-full rounded border pr-2 pl-6 text-[11.5px] transition outline-none focus:ring-2',
              )}
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-fg-dim px-2 py-3 text-center text-[11px]">
                No languages match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((option, index) => {
                const active = option.value === value;
                const focused = index === focusIdx;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-idx={index}
                    onMouseEnter={() => setFocusIdx(index)}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors',
                      focused ? 'bg-fg/5' : 'bg-transparent',
                      active ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {option.flag ? (
                      <span className="text-[14px] leading-none">{option.flag}</span>
                    ) : (
                      <Globe className="text-fg-dim h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{option.label}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
