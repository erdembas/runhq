import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import {} from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CommandEntry, ProjectCandidate } from '@/types';
import { NODE_PACKAGE_MANAGERS, rewritePmInCmd, type NodePackageManager } from './types';

export function DetectedSuggestions({
  loading,
  detected,
  existingCmds,
  onPick,
  selectedPm,
  onPmChange,
}: {
  loading: boolean;
  detected: ProjectCandidate | null;
  existingCmds: CommandEntry[];
  onPick: (suggestion: { label: string; cmd: string }) => void;
  selectedPm: NodePackageManager;
  onPmChange: (pm: NodePackageManager) => void;
}) {
  i18n.useLocale();
  const isNode = detected?.runtime === 'node';

  const rewrittenSuggestions = useMemo(() => {
    if (!detected) return [];
    if (!isNode) return detected.suggestions;
    return detected.suggestions.map((s) => ({
      ...s,
      cmd: rewritePmInCmd(s.cmd, selectedPm),
    }));
  }, [detected, isNode, selectedPm]);

  if (loading && !detected) {
    return (
      <div className="text-fg-dim flex items-center gap-1.5 text-[10px]">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        <span>{i18n.t('Inspecting folder…')}</span>
      </div>
    );
  }

  if (!detected || detected.suggestions.length === 0) return null;

  return (
    <div className="border-border/60 bg-surface-muted/40 rounded-app-sm space-y-1.5 border border-dashed p-2">
      <div className="text-fg-muted flex items-center gap-1 text-[9px] tracking-wide uppercase">
        <Sparkles className="text-accent h-2.5 w-2.5" />
        <span>{i18n.t('Detected')}</span>
        <span className="bg-accent/10 text-accent rounded-app-sm px-1 py-0.5 text-[9px] tracking-normal normal-case">
          {detected.runtime}
        </span>
        <span className="text-fg-dim tracking-normal normal-case">{detected.name}</span>
      </div>
      {isNode && (
        <div className="border-border/50 bg-surface-raised/60 rounded-app-sm divide-border/40 inline-flex items-center divide-x overflow-hidden border">
          {NODE_PACKAGE_MANAGERS.map((pm) => (
            <button
              key={pm}
              type="button"
              onClick={() => onPmChange(pm)}
              className={cn(
                'px-3 py-1 text-[11px] font-medium transition',
                selectedPm === pm
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-dim hover:bg-surface-muted hover:text-fg',
              )}
            >
              {pm}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {rewrittenSuggestions.map((s) => {
          const active = existingCmds.some((c) => c.name === s.label);
          return (
            <button
              key={`${s.label}:${s.cmd}`}
              type="button"
              onClick={() => onPick(s)}
              title={
                active
                  ? i18n.t('{value1} (already added)', { value1: s.cmd })
                  : i18n.t('Add as command: {value1}', { value1: s.cmd })
              }
              className={cn(
                'rounded-app-sm group inline-flex max-w-full items-center gap-1.5 border px-2.5 py-1 text-[12px] transition',
                active
                  ? 'border-accent/60 bg-accent/10 text-accent'
                  : 'border-border/60 bg-surface-muted text-fg-muted hover:border-accent/40 hover:text-fg',
              )}
            >
              <span className="truncate font-medium">{s.label}</span>
              <span className="text-fg-dim group-hover:text-fg-muted truncate text-[11px]">
                {s.cmd}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
