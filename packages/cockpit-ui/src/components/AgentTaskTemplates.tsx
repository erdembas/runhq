'use client';

import { ArrowUpRight, Bug, ListChecks, PanelsTopLeft, ScanSearch } from 'lucide-react';

import { AGENT_TASK_TEMPLATES, type AgentTaskTemplate } from '../lib/agentTaskTemplates';
export type { AgentTaskTemplate } from '../lib/agentTaskTemplates';

const icons = { plan: ListChecks, fix: Bug, review: ScanSearch, canvas: PanelsTopLeft };
const tones = {
  plan: 'bg-cat-backend/10 text-cat-backend',
  fix: 'bg-accent/10 text-accent',
  review: 'bg-status-running/10 text-status-running',
  canvas: 'bg-cat-frontend/10 text-cat-frontend',
};

export function AgentTaskTemplates({
  onSelect,
  disabled = false,
  selected,
}: {
  onSelect: (template: AgentTaskTemplate) => void;
  disabled?: boolean;
  selected?: AgentTaskTemplate['id'];
}) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,155px),1fr))] gap-2.5"
      aria-label="Task templates"
    >
      {AGENT_TASK_TEMPLATES.map((template) => {
        const Icon = icons[template.id];
        return (
          <button
            type="button"
            key={template.id}
            disabled={disabled}
            aria-pressed={selected === template.id}
            onClick={() => onSelect(template)}
            className={`group border-border bg-surface-raised hover:border-fg/20 hover:bg-fg/3 focus-visible:ring-accent/40 rounded-xl border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${selected === template.id ? 'border-accent/35 bg-accent/4' : ''}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[template.id]}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <ArrowUpRight
                className="text-fg-dim group-hover:text-fg h-3.5 w-3.5 transition-colors"
                aria-hidden
              />
            </div>
            <span className="text-fg block text-[12px] font-medium">{template.title}</span>
            <span className="text-fg-dim mt-1 block text-[11px] leading-relaxed">
              {template.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
