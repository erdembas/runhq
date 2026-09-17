'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Layers, Sparkles } from 'lucide-react';
import { agentEffortLevels, effortLabel } from '../lib/agentEffort';
import { SearchableSelect } from './SearchableSelect';

function EffortBars({ filled, count = 4 }: { filled: number; count?: number }) {
  return (
    <span aria-hidden="true" className="inline-flex h-4 shrink-0 items-end gap-[2px]">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-[1px] transition-colors ${index < filled ? 'bg-current' : 'bg-fg/15'}`}
          style={{ height: `${5 + (index * 11) / Math.max(1, count - 1)}px` }}
        />
      ))}
    </span>
  );
}

export function AgentEffortPicker({
  efforts,
  value,
  onChange,
  disabled,
}: {
  efforts: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { ordered, levels } = useMemo(() => agentEffortLevels(efforts), [efforts]);
  const catalogKey = levels.join('\0');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = levels.indexOf(value);
  const saved = !!value && index < 0;
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < 260 && above > below;
    const width = Math.min(340, window.innerWidth - 24);
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      maxHeight: Math.max(80, flip ? above : below),
    });
  }, [open]);
  useEffect(() => {
    if (open && position)
      (
        panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        panel.current?.querySelector<HTMLElement>('[role="radio"]')
      )?.focus();
  }, [open, position]);
  useEffect(() => {
    setOpen(false);
  }, [disabled, catalogKey]);
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
  if (!ordered)
    return (
      <SearchableSelect
        label="Model variant"
        value={value}
        onChange={onChange}
        disabled={disabled}
        compact
        leading={<Layers className="h-3.5 w-3.5" />}
        options={[
          { value: '', label: 'Auto', description: 'Use your agent configuration' },
          ...[...new Set([...levels, ...(value ? [value] : [])])].map((v) => ({
            value: v,
            label: effortLabel(v),
            description: levels.includes(v)
              ? 'Provider variant'
              : 'Saved selection · Not in the current catalog',
          })),
        ]}
      />
    );
  const choices = ['', ...levels];
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Reasoning effort"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        title={`Reasoning effort: ${effortLabel(value)}`}
        onClick={() => setOpen(!open)}
        style={{ outline: 'none' }}
        className={`text-fg-muted hover:text-fg hover:bg-fg/5 focus-visible:ring-fg/25 inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] transition-colors focus-visible:ring-2 disabled:opacity-40 ${open ? 'bg-fg/5' : ''}`}
      >
        <EffortBars count={levels.length} filled={index < 0 || value === 'none' ? 0 : index + 1} />
        {effortLabel(value)}
        <ChevronDown className="text-fg-dim h-3 w-3" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label="Reasoning effort"
            style={position}
            className="border-border/80 bg-surface-raised fixed z-[200] overflow-auto rounded-2xl border p-4 shadow-[0_12px_36px_rgb(0_0_0/0.14)]"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                close(true);
              }
            }}
          >
            <div className="text-fg flex items-center gap-2 text-[12px] font-medium">
              <Sparkles className="text-fg-muted h-3.5 w-3.5" />
              Reasoning effort
            </div>
            <p className="text-fg-muted mt-1 text-[11px] leading-relaxed">
              Choose how much reasoning to use for the next message.
            </p>
            <div
              role="radiogroup"
              aria-label="Reasoning level"
              className="mt-4"
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const current = Math.max(0, choices.indexOf(value));
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? choices.length - 1
                      : (current +
                          (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
                          choices.length) %
                        choices.length;
                onChange(choices[next] ?? '');
                panel.current?.querySelector<HTMLElement>(`[data-level="${next}"]`)?.focus();
              }}
            >
              <button
                type="button"
                role="radio"
                data-level="0"
                aria-checked={!value}
                tabIndex={!value || saved ? 0 : -1}
                onClick={() => onChange('')}
                style={{ outline: 'none' }}
                className={`focus-visible:ring-fg/25 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[11px] focus-visible:ring-2 ${!value ? 'bg-fg/6 text-fg' : 'text-fg-muted hover:bg-fg/4'}`}
              >
                <span>Auto</span>
                <span className="text-fg-dim text-[10px]">Agent default</span>
              </button>
              <div
                className="mt-3 grid gap-1"
                style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}
              >
                {levels.map((level, i) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    data-level={i + 1}
                    aria-label={effortLabel(level)}
                    aria-checked={value === level}
                    tabIndex={value === level ? 0 : -1}
                    onClick={() => onChange(level)}
                    style={{ outline: 'none' }}
                    className="group focus-visible:ring-fg/25 min-w-0 rounded-lg pt-2 pb-1 focus-visible:ring-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`mb-2 block h-2 rounded-full transition-colors ${index >= i ? 'bg-fg/70' : 'bg-fg/10 group-hover:bg-fg/25'}`}
                    />
                    <span
                      className={`block text-[10px] leading-tight ${value === level ? 'text-fg font-semibold' : 'text-fg-dim'}`}
                    >
                      {effortLabel(level)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {saved ? (
              <p className="text-fg-muted mt-3 text-[10px]">
                Saved: {value}. This level is not in the current model catalog.
              </p>
            ) : (
              <p className="text-fg-dim mt-4 text-[10px] leading-relaxed">
                Higher levels can take longer and use more tokens.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
