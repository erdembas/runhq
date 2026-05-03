import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { type makeAnsiConverter } from '@/lib/ansi';
import { ConsoleLineRow } from '@/components/activity/ConsoleLineRow';
import type { ConsoleLine, ConsoleSection } from '@/components/activity/consoleModel';

export function ConsoleOutput({
  sections,
  ansi,
  isDark,
  microSize,
  metaSize,
  maxHeightClass = 'max-h-80',
}: {
  sections: ConsoleSection[];
  ansi: ReturnType<typeof makeAnsiConverter>;
  isDark: boolean;
  microSize: string;
  metaSize: string;
  maxHeightClass?: string;
}) {
  const totals = useMemo(() => {
    let total = 0;
    let errors = 0;
    let warnings = 0;
    for (const section of sections) {
      total += section.lines.length;
      errors += section.errors;
      warnings += section.warnings;
    }
    return { total, errors, warnings };
  }, [sections]);

  const defaultKey = useMemo(() => {
    if (sections.length === 0) return '';
    const ranked = [...sections].sort((a, b) => {
      if (a.errors !== b.errors) return b.errors - a.errors;
      if (a.warnings !== b.warnings) return b.warnings - a.warnings;
      return b.lines.length - a.lines.length;
    });
    return ranked[0]!.key;
  }, [sections]);

  const [activeKey, setActiveKey] = useState<string>(defaultKey);

  useEffect(() => {
    if (sections.length === 0) return;
    if (!sections.some((section) => section.key === activeKey)) {
      setActiveKey(defaultKey);
    }
  }, [sections, activeKey, defaultKey]);

  const activeSection = sections.find((section) => section.key === activeKey) ?? sections[0];
  const ordered = useMemo(() => {
    if (!activeSection) return [] as ConsoleLine[];
    return [...activeSection.lines].sort((a, b) => {
      if (a.ts_ms !== b.ts_ms) return a.ts_ms - b.ts_ms;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }, [activeSection]);

  const hasTabs = sections.length > 1;

  return (
    <div className="border-border/30 mt-4 border-t pt-3">
      <div
        className={cn(
          'text-fg/45 mb-2 flex items-center gap-2 font-semibold tracking-[0.12em] uppercase',
          microSize,
        )}
      >
        <span>Console output</span>
        <span className="text-fg/25 tabular-nums">
          · {totals.total} line{totals.total === 1 ? '' : 's'}
        </span>
        {hasTabs && (
          <span className="text-fg/25 tabular-nums">
            · {sections.length} command{sections.length === 1 ? '' : 's'}
          </span>
        )}
        {totals.errors > 0 && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-rose-400 normal-case tabular-nums',
              'ml-auto',
            )}
          >
            <XCircle size={10} />
            {totals.errors}
          </span>
        )}
        {totals.warnings > 0 && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-400 normal-case tabular-nums',
              totals.errors === 0 && 'ml-auto',
            )}
          >
            <AlertTriangle size={10} />
            {totals.warnings}
          </span>
        )}
      </div>
      {hasTabs && (
        <div className="overlay-scroll -mx-0.5 mb-2 flex items-center gap-1 overflow-x-auto px-0.5 pb-1">
          {sections.map((section) => {
            const isActive = section.key === (activeSection?.key ?? '');
            return (
              <button
                key={section.key}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveKey(section.key);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono transition',
                  microSize,
                  isActive
                    ? 'border-accent/40 bg-accent/10 text-fg'
                    : 'border-border/40 text-fg/55 hover:border-border/70 hover:text-fg/85',
                )}
                title={`${section.label} · ${section.lines.length} line${
                  section.lines.length === 1 ? '' : 's'
                }`}
              >
                <span className="truncate">{section.label}</span>
                <span className={cn('tabular-nums', isActive ? 'text-fg/55' : 'text-fg/35')}>
                  {section.lines.length}
                </span>
                {section.errors > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1 text-rose-400 tabular-nums">
                    <XCircle size={9} />
                    {section.errors}
                  </span>
                )}
                {section.errors === 0 && section.warnings > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1 text-amber-400 tabular-nums">
                    <AlertTriangle size={9} />
                    {section.warnings}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div
        className={cn(
          'overlay-scroll overflow-auto rounded-md border font-mono',
          maxHeightClass,
          isDark
            ? 'border-black/60 bg-[#1e1e1e] text-[#d4d4d4]'
            : 'border-slate-300 bg-white text-slate-800',
        )}
      >
        {ordered.length === 0 ? (
          <div className={cn('text-fg/35 px-3 py-4 text-center', metaSize)}>
            No console output captured.
          </div>
        ) : (
          <div className="py-1.5">
            {ordered.map((line) => (
              <ConsoleLineRow
                key={line.key}
                line={line}
                ansi={ansi}
                microSize={microSize}
                metaSize={metaSize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
