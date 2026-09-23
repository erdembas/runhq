import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function BulkBar({
  selectedCount,
  commands,
  onClear,
}: {
  selectedCount: number;
  commands: string[];
  onClear: () => void;
}) {
  i18n.useLocale();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(t);
    }
  }, [copied]);

  if (selectedCount === 0) return null;

  const script = commands.join('\n');
  const hasScript = commands.length > 0;

  return (
    <div className="border-border/70 bg-surface/95 shrink-0 border-t px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-fg/80 text-[11px] font-medium tabular-nums">
          {i18n.rich('{selectedCount} selected', { selectedCount: selectedCount })}
        </span>
        <span className="text-fg/35 text-[10px] tabular-nums">
          {hasScript
            ? i18n.t('({value1} commands)', { value1: commands.length })
            : i18n.t('(no commands available)')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="text-fg/55 hover:text-fg hover:bg-fg/5 rounded px-2 py-1 text-[11px] transition"
          >
            {i18n.t('Clear')}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!hasScript) return;
              try {
                await navigator.clipboard.writeText(script);
                setCopied(true);
              } catch {
                /* clipboard blocked */
              }
            }}
            disabled={!hasScript}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition',
              hasScript
                ? copied
                  ? 'bg-tone-success/12 text-tone-success-fg'
                  : 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'bg-fg/5 text-fg/30 cursor-not-allowed',
            )}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? i18n.t('Script copied') : i18n.t('Copy commands as script')}
          </button>
        </div>
      </div>
    </div>
  );
}
