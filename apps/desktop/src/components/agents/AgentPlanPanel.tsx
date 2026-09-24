import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AgentPlanReview,
  collectAgentPlans,
  type AgentPlanDocument,
  SearchableSelect,
} from '@runhq/cockpit-ui';
import type { AgentItem } from '@runhq/cockpit-types';
import { ROOMY_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';

function PlanDocument({
  sessionId,
  plan,
  disabled,
  onBuild,
}: {
  sessionId: string;
  plan: AgentPlanDocument;
  disabled: boolean;
  onBuild: (body: string) => void;
}) {
  i18n.useLocale();
  const key = `runhq:plan:${sessionId}:${plan.id}`;
  const [override, setOverride] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const body = override ?? plan.body;
  const save = (value: string | null) => {
    setOverride(value);
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      setError('');
    } catch {
      setError(
        i18n.t('Your edit is available in this view but could not be saved on this device.'),
      );
    }
  };
  return (
    <>
      {error && (
        <p role="status" className="text-accent px-5 py-2 text-[11px]">
          {error}
        </p>
      )}
      <AgentPlanReview
        title={plan.title}
        body={body}
        steps={plan.steps}
        editing={editing}
        modified={override !== null}
        disabled={disabled}
        onBody={save}
        onEditing={setEditing}
        onReset={() => save(null)}
        onBuild={() => onBuild(body)}
        preview={
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={ROOMY_MARKDOWN_COMPONENTS}>
            {body}
          </ReactMarkdown>
        }
      />
    </>
  );
}

export function AgentPlanPanel({
  sessionId,
  items,
  planMode,
  selectedId,
  onSelect,
  disabled,
  onBuild,
}: {
  sessionId: string;
  items: AgentItem[];
  planMode: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  onBuild: (body: string) => void;
}) {
  i18n.useLocale();
  const plans = useMemo(() => collectAgentPlans(items, planMode), [items, planMode]);
  const plan = plans.find((entry) => entry.id === selectedId) ?? plans.at(-1);
  if (!plan)
    return (
      <div className="text-fg-muted m-auto max-w-md p-8 text-center">
        <ListChecks className="mx-auto mb-4 h-8 w-8 text-violet-400" />
        <h3 className="text-fg font-medium">{i18n.t('Think it through. Then build.')}</h3>
        <p className="mt-2 text-[13px] leading-relaxed">
          {i18n.t(
            'Choose Plan in the composer and describe your task. Review the agent’s approach here, refine it, and build when you are ready.',
          )}
        </p>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {plans.length > 1 && (
        <div className="border-border flex items-center gap-2 border-b px-5 py-2">
          <span className="text-fg-dim text-[11px]">{i18n.t('Plan')}</span>
          <SearchableSelect
            label={i18n.t('Plan document')}
            compact
            className="min-w-0 flex-1"
            value={plan.id}
            options={plans.map((entry, index) => ({
              value: entry.id,
              label: entry.title,
              description: i18n.t('Document {value1}', { value1: index + 1 }),
            }))}
            onChange={onSelect}
          />
        </div>
      )}
      <PlanDocument
        key={`${sessionId}:${plan.id}`}
        sessionId={sessionId}
        plan={plan}
        disabled={disabled}
        onBuild={onBuild}
      />
    </div>
  );
}
