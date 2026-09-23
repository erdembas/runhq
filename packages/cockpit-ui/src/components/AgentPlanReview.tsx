'use client';

import * as i18n from '../i18n';
import type { ReactNode } from 'react';
import { Check, Circle, Code2, Eye, ListChecks, Loader2, Play, RotateCcw } from 'lucide-react';
import type { AgentPlanStep } from '../lib/agentPlans';

export function AgentPlanReview({
  title,
  body,
  steps,
  editing,
  modified,
  disabled,
  preview,
  onBody,
  onEditing,
  onReset,
  onBuild,
}: {
  title: string;
  body: string;
  steps: AgentPlanStep[];
  editing: boolean;
  modified: boolean;
  disabled: boolean;
  preview: ReactNode;
  onBody: (value: string) => void;
  onEditing: (value: boolean) => void;
  onReset: () => void;
  onBuild: () => void;
}) {
  i18n.useLocale();
  const complete = steps.filter((step) => step.status === 'completed').length;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
        <div className="rounded-lg bg-violet-400/10 p-2 text-violet-500">
          <ListChecks className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-fg truncate text-[13px] font-medium">{title}</h3>
          <p className="text-fg-dim text-[11px]">
            {modified
              ? i18n.t('Edited locally · included when you build')
              : i18n.t('Review the approach before implementation')}
          </p>
        </div>
        <button
          aria-pressed={editing}
          onClick={() => onEditing(!editing)}
          className="text-fg-muted hover:bg-fg/5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px]"
        >
          {editing ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
          {editing ? i18n.t('Preview') : i18n.t('Edit plan')}
        </button>
        {modified && (
          <button
            onClick={onReset}
            title={i18n.t('Reset to agent plan')}
            aria-label={i18n.t('Reset to agent plan')}
            className="text-fg-muted rounded p-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          disabled={disabled || !body.trim()}
          onClick={onBuild}
          className="bg-accent text-accent-fg flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium disabled:opacity-40"
        >
          {i18n.rich('{value1}Build this plan', { value1: <Play className="h-3.5 w-3.5" /> })}
        </button>
      </div>
      {!!steps.length && !modified && (
        <div className="border-border bg-surface-muted/40 space-y-2 border-b px-5 py-3">
          <div className="text-fg-dim flex justify-between text-[11px]">
            <span>{i18n.t('Agent-reported progress')}</span>
            <span>
              {complete} / {steps.length}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={i18n.t('Plan progress')}
            aria-valuenow={complete}
            aria-valuemax={steps.length}
            aria-valuemin={0}
            className="bg-fg/5 h-1 rounded-full"
          >
            <div
              className="bg-status-running h-full rounded-full transition-all"
              style={{ width: `${(complete / steps.length) * 100}%` }}
            />
          </div>
          <ol className="grid max-h-40 gap-1.5 overflow-auto pt-1">
            {steps.map((step, index) => (
              <li key={index} className="text-fg-muted flex items-start gap-2 text-[12px]">
                {step.status === 'completed' ? (
                  <Check className="text-status-running mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : step.status === 'in_progress' ? (
                  <Loader2 className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Circle className="text-fg-dim mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {editing ? (
        <textarea
          aria-label={i18n.t('Edit implementation plan')}
          className="text-fg min-h-40 flex-1 resize-none bg-transparent p-5 font-mono text-[12px] leading-6 outline-none"
          value={body}
          maxLength={150000}
          onChange={(event) => onBody(event.target.value)}
        />
      ) : (
        <div className="overlay-scroll text-fg min-h-0 flex-1 overflow-auto p-5 text-[13px] leading-relaxed break-words">
          {preview}
        </div>
      )}
    </section>
  );
}
