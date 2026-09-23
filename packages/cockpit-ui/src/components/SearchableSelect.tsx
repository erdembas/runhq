'use client';

import { useLocaleMemo as useMemo } from '../i18n';
import * as i18n from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { filterSelectOptions, type SearchableOption } from '../lib/selectSearch';

export function SearchableSelect({
  value,
  onChange,
  options,
  label,
  placeholder = i18n.t('Select…'),
  searchPlaceholder = i18n.t('Search…'),
  disabled,
  compact,
  searchable = true,
  leading,
  className = '',
  menuWidth = 320,
  indentGrouped = false,
  createOption,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  compact?: boolean;
  searchable?: boolean;
  leading?: ReactNode;
  className?: string;
  menuWidth?: number;
  indentGrouped?: boolean;
  createOption?: (query: string) => SearchableOption | null;
  hint?: string;
}) {
  i18n.useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const matches = filterSelectOptions(options, query);
    const custom = createOption?.(query);
    if (custom && !options.some((option) => option.value === custom.value)) matches.push(custom);
    if (createOption) {
      const exact = matches.findIndex((option) => option.value === query.trim());
      if (exact > 0) matches.unshift(...matches.splice(exact, 1));
    }
    return matches;
  }, [options, query, createOption]);
  const groups = useMemo(() => {
    const result: {
      key: string;
      heading?: SearchableOption;
      start: number;
      options: SearchableOption[];
    }[] = [];
    filtered.forEach((option, index) => {
      const previous = filtered[index - 1];
      const groupId = option.group ? (option.groupId ?? option.group) : undefined;
      const previousGroupId = previous?.group ? (previous.groupId ?? previous.group) : undefined;
      if (!index || groupId !== previousGroupId) {
        result.push({
          key: option.value,
          heading: option.group ? option : undefined,
          start: index,
          options: [],
        });
      }
      result[result.length - 1]?.options.push(option);
    });
    return result;
  }, [filtered]);
  const activeOption = filtered[active];
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  const choose = (option: SearchableOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < 320 && above > below;
    const width = Math.min(Math.max(rect.width, menuWidth), window.innerWidth - 24);
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      maxHeight: Math.max(80, Math.min(390, flip ? above : below)),
    });
  }, [open, menuWidth]);
  useEffect(() => {
    if (!open || !position) return;
    (searchable ? input.current : list.current)?.focus();
  }, [open, position, searchable]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, filtered, position]);
  const expand = () => {
    setQuery('');
    const index = options.findIndex((option) => option.value === value && !option.disabled);
    setActive(index >= 0 ? index : options.findIndex((option) => !option.disabled));
    setOpen(true);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(true);
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) choose(activeOption);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      for (let step = 1; step <= filtered.length; step++) {
        const next = (active + direction * step + filtered.length) % filtered.length;
        if (!filtered[next]?.disabled) {
          setActive(next);
          break;
        }
      }
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
        title={selected?.description || selected?.label}
        onClick={() => (open ? close() : expand())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            expand();
          }
        }}
        className={`text-fg-muted hover:text-fg focus-visible:ring-accent/40 inline-flex min-w-0 items-center gap-2 rounded-lg text-[12px] transition-colors outline-none focus-visible:ring-2 disabled:opacity-40 ${compact ? 'hover:bg-fg/5 h-8 px-2' : 'border-border/70 bg-surface/60 hover:bg-fg/5 border px-3 py-2.5'} ${open ? 'bg-fg/5 text-fg' : ''} ${className}`}
      >
        {leading}
        {selected?.color && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: selected.color }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label || placeholder}</span>
        {selected?.badge && (
          <span className="text-fg-dim bg-fg/5 shrink-0 rounded px-1 py-0.5 text-[9px]">
            {selected.badge}
          </span>
        )}
        <ChevronDown
          className={`text-fg-dim h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panel}
            style={position}
            onKeyDown={onKeyDown}
            className="border-border/80 bg-surface-raised fixed z-[200] flex flex-col overflow-hidden rounded-2xl border p-1.5 shadow-[0_12px_36px_rgb(0_0_0/0.14)]"
          >
            {searchable && (
              <div className="bg-fg/3 focus-within:border-accent/25 mx-1 mt-1 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-transparent px-3 py-1 transition-colors">
                <Search className="text-fg-dim h-4 w-4 shrink-0" />
                <input
                  ref={input}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  style={{ outline: 'none' }}
                  role="combobox"
                  aria-label={i18n.t('Search {value1}', { value1: label.toLowerCase() })}
                  aria-expanded="true"
                  aria-controls={`${id}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={activeOption ? `${id}-${active}` : undefined}
                  className="text-fg placeholder:text-fg-dim min-w-0 flex-1 bg-transparent py-2 text-[12px] outline-none"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                />
                {query && (
                  <button
                    type="button"
                    aria-label={i18n.t('Clear search')}
                    className="text-fg-dim hover:text-fg p-1"
                    onClick={() => {
                      setQuery('');
                      setActive(0);
                      input.current?.focus();
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              aria-activedescendant={!searchable && activeOption ? `${id}-${active}` : undefined}
              tabIndex={searchable ? -1 : 0}
              className="overlay-scroll min-h-0 overflow-auto outline-none"
            >
              {groups.map(({ key, heading, start, options: groupOptions }) => (
                <div
                  key={key}
                  role={heading ? 'group' : 'presentation'}
                  aria-label={heading?.group}
                >
                  {heading && (
                    <div className="bg-surface-raised sticky top-0 z-10 px-1 py-1">
                      <div
                        className="text-fg-dim bg-fg/3 flex h-7 items-center gap-2 rounded-md px-2 text-[10px] font-semibold tracking-wide"
                        style={
                          heading.color
                            ? {
                                backgroundColor: `color-mix(in srgb, ${heading.color} 8%, var(--color-surface-raised))`,
                              }
                            : undefined
                        }
                      >
                        {heading.color && (
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: heading.color }}
                          />
                        )}
                        {heading.group}
                      </div>
                    </div>
                  )}
                  {groupOptions.map((option, offset) => {
                    const index = start + offset;
                    return (
                      <button
                        key={option.value}
                        style={{ scrollMarginTop: heading ? 36 : 0 }}
                        id={`${id}-${index}`}
                        title={
                          option.description
                            ? `${option.label} · ${option.description}`
                            : option.label
                        }
                        data-option-index={index}
                        role="option"
                        aria-selected={value === option.value}
                        aria-disabled={option.disabled || undefined}
                        tabIndex={-1}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(option)}
                        className={`flex w-full items-center gap-2.5 rounded-lg py-2 pr-3 text-left transition-colors ${indentGrouped && option.group ? 'pl-6' : 'pl-3'} ${option.disabled ? 'opacity-40' : active === index ? 'bg-fg/7' : 'hover:bg-fg/5'} ${option.value === value ? 'text-fg' : 'text-fg-muted'}`}
                      >
                        {option.color && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: option.color }}
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[12px] font-medium">
                            <span className="truncate">{option.label}</span>
                            {option.badge && (
                              <span className="bg-fg/5 text-fg-dim shrink-0 rounded px-1.5 py-0.5 text-[9px] font-normal">
                                {option.badge}
                              </span>
                            )}
                          </span>
                          {option.description && (
                            <span
                              className="text-fg-dim mt-0.5 block text-[10px] leading-relaxed break-words"
                              title={option.description}
                            >
                              {option.description}
                            </span>
                          )}
                        </span>
                        {option.value === value && (
                          <Check className="text-accent h-3.5 w-3.5 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!filtered.length && (
                <div role="presentation" className="text-fg-dim px-4 py-7 text-center text-[12px]">
                  {i18n.t('No matches. Try another name or path.')}
                </div>
              )}
            </div>
            {hint && (
              <p className="text-fg-dim mx-2 mt-2 mb-1 text-[10px] leading-relaxed">{hint}</p>
            )}
            {searchable && (
              <div className="border-border/50 text-fg-dim mt-1 flex shrink-0 justify-between border-t px-2 pt-2 pb-1 text-[10px]">
                <span>{i18n.rich('{value1} results', { value1: filtered.length })}</span>
                <span>{i18n.t('↑ ↓ Navigate · Enter Select')}</span>
              </div>
            )}
          </div>,
          trigger.current?.closest('dialog') ?? document.body,
        )}
    </>
  );
}
