import { ExternalLink, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buildSingleAdvisoryChatPayload } from '@/lib/ai/advisoryPayload';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import type { Advisory } from '@/types';
import { CommandBar } from './CommandBar';
import { SelectCheckbox } from './SelectCheckbox';
import { severityTone, upgradeCommandForAdvisory } from './model';

export function AdvisoryRow({
  advisory,
  selected,
  onToggle,
  onOpenUrl,
  projectName,
  runtime,
}: {
  advisory: Advisory;
  selected: boolean;
  onToggle: () => void;
  onOpenUrl: (url: string) => void;
  /** Project name + runtime are passed through (rather than a
   *  pre-bound `onAnalyze` callback) so each row can host its own
   *  `useAiSurfaceTrigger` and anchor its model picker right under
   *  the row's Sparkles button. Going through a parent callback
   *  would force a single shared anchor and the popover would
   *  always pop under the bulk Ask AI button — the wrong row. */
  projectName: string;
  runtime: string | null;
}) {
  const tone = severityTone(advisory.severity);
  const cmd = upgradeCommandForAdvisory(runtime, advisory);
  const Icon = tone.icon;
  const {
    triggerRef: analyzeTriggerRef,
    onClick: onAnalyzeClick,
    popover: analyzePopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const payload = buildSingleAdvisoryChatPayload({
        advisory,
        projectName,
        runtime,
      });
      return {
        origin: 'advisory',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  return (
    <li
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={cn(
        'group/row hover:bg-fg/3 focus-visible:bg-fg/3 relative flex cursor-pointer gap-2.5 px-4 py-2.5 transition outline-none',
        selected && 'bg-accent/5',
      )}
    >
      <SelectCheckbox selected={selected} onToggle={onToggle} />

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Title row: severity chip · package · vulnerable range · open-CVE link */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[9px] font-semibold tracking-wider uppercase',
              tone.chipFilled,
            )}
          >
            <Icon size={9} />
            {advisory.severity}
          </span>
          <span className="text-fg truncate text-[12px] font-semibold">{advisory.package}</span>
          {advisory.vulnerable_range && (
            <span className="text-fg/40 shrink-0 font-mono text-[10px] tabular-nums">
              {advisory.vulnerable_range}
            </span>
          )}
          {/* Action slot — pinned to the row's right edge with a fixed
              footprint so rows with/without an external CVE URL still
              line up. Holds two primary affordances:
                • "Analyze with AI" — per-CVE deep dive. Always visible
                  because it's the highest-value action on the row;
                  hiding it behind hover would hide the entire feature
                  on first sight.
                • "Open advisory in browser" — only renders when the
                  source provided a URL. */}
          <span className="ml-auto flex shrink-0 items-center justify-end gap-0.5">
            <button
              ref={analyzeTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAnalyzeClick();
              }}
              className={cn(
                'text-fg/55 hover:text-accent hover:bg-accent/10 inline-flex items-center',
                'gap-0.5 rounded px-1 py-0.5 transition',
                // Subtle accent tint on the icon so the button reads
                // as the "smart" affordance even when not hovered.
                'group-hover/row:text-accent/80',
              )}
              title={
                advisory.id ? `Analyze ${advisory.id} with AI` : `Analyze this advisory with AI`
              }
              aria-label="Analyze advisory with AI"
            >
              <Sparkles size={11} />
            </button>
            {analyzePopover}
            {advisory.url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUrl(advisory.url!);
                }}
                className="text-fg/55 hover:text-accent hover:bg-fg/5 inline-flex items-center rounded px-1 py-0.5 transition"
                title={`Open ${advisory.id ?? 'advisory'} in browser`}
                aria-label="Open advisory in browser"
              >
                <ExternalLink size={11} />
              </button>
            )}
          </span>
        </div>

        {/* Description — why you should care. */}
        <p className="text-fg/70 line-clamp-2 text-[11px] leading-snug">{advisory.title}</p>

        {/* Command bar — the actual deliverable of this row. Primary
            action, clearly chunked with an integrated copy button. */}
        {cmd && <CommandBar value={cmd} />}

        {/* Footer metadata — low-contrast, informational only. */}
        {(advisory.fix_version || advisory.id) && (
          <div className="text-fg/40 flex items-center gap-2 text-[10px]">
            {advisory.fix_version && (
              <span className="inline-flex items-center gap-1">
                <span className="text-fg/35">fix</span>
                <span className="text-tone-success-fg font-mono tabular-nums">
                  {advisory.fix_version}
                </span>
              </span>
            )}
            {advisory.fix_version && advisory.id && (
              <span aria-hidden className="text-fg/25">
                ·
              </span>
            )}
            {advisory.id && <span className="font-mono tabular-nums">{advisory.id}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
