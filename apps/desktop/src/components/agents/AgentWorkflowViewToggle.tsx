import * as i18n from '@runhq/cockpit-ui/i18n';
import { ListOrdered, Workflow } from 'lucide-react';

export function AgentWorkflowViewToggle({
  value,
  onChange,
}: {
  value: 'map' | 'list';
  onChange: (value: 'map' | 'list') => void;
}) {
  i18n.useLocale();
  return (
    <div
      role="group"
      aria-label={i18n.t('Workflow editor view')}
      className="border-border/60 bg-surface-muted inline-flex gap-1 rounded-lg border p-1"
    >
      {(['map', 'list'] as const).map((view) => {
        const Icon = view === 'map' ? Workflow : ListOrdered;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={value === view}
            onClick={() => onChange(view)}
            className={`focus-visible:ring-accent/40 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition outline-none focus-visible:ring-2 ${value === view ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-dim hover:text-fg'}`}
          >
            <Icon className="size-3.5" />
            {view === 'map' ? i18n.t('Workflow map') : i18n.t('Prompt list')}
          </button>
        );
      })}
    </div>
  );
}
