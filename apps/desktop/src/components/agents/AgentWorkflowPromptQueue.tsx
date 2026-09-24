import { Textarea } from '@/components/ui/Input';
import { Checkbox, Radio } from '@/components/ui/Choice';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentBackend } from '@runhq/cockpit-types';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  createWorkflowPromptQueue,
  type WorkflowConversationMode,
  type WorkflowExecutionMode,
} from './agentWorkflowEditor';
import { AgentWorkflowExecution } from './AgentWorkflowExecution';
import { AgentWorkflowReviewPolicy } from './AgentWorkflowReviewPolicy';
import type { WorkflowReviewPolicy } from '@/lib/ipc/agentWorkflowIpc';
import { MAX_WORKFLOW_STEPS, moveWorkflowStep } from './agentWorkflowStepPolicy';
import {
  AgentWorkflowModelControls,
  type WorkflowModelSettings,
} from './AgentWorkflowModelControls';

const button =
  'border-border hover:bg-fg/5 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs disabled:opacity-40';
const field =
  'border-border bg-surface text-fg focus:border-accent focus:ring-accent/15 focus:ring-2 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none';

export function AgentWorkflowPromptQueue({
  projectId,
  producers,
  reviewers,
  disabled,
  onApply,
  onCancel,
}: {
  projectId: string;
  producers: AgentBackend[];
  reviewers: AgentBackend[];
  disabled?: boolean;
  onApply: (steps: CreateWorkflowStep[], mode: WorkflowConversationMode) => void;
  onCancel: () => void;
}) {
  i18n.useLocale();
  const [rows, setRows] = useState([
    { id: 1, prompt: '', review: false, model: '', effort: '' },
    { id: 2, prompt: '', review: false, model: '', effort: '' },
  ]);
  const nextId = useRef(3);
  const [execution, setExecution] = useState<WorkflowExecutionMode>('sequence');
  const [conversation, setConversation] = useState<WorkflowConversationMode>('separate');
  const [producer, setProducer] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [reviewPolicy, setReviewPolicy] = useState<WorkflowReviewPolicy>('on_findings');
  const [reviewSettings, setReviewSettings] = useState<WorkflowModelSettings>({
    model: '',
    effort: '',
  });
  const target = producer || producers[0]?.id || '';
  const reviewTarget = reviewer || reviewers[0]?.id || '';
  const steps = createWorkflowPromptQueue(
    rows,
    target,
    reviewTarget,
    conversation,
    {
      ...reviewSettings,
      review_policy: reviewPolicy,
    },
    execution,
  );
  return (
    <fieldset
      disabled={disabled}
      className="border-accent/30 bg-accent/3 space-y-4 rounded-xl border p-4"
    >
      <legend className="text-fg px-1 text-sm font-medium">
        {i18n.t('Write your prompt queue')}
      </legend>
      <p className="text-fg-muted text-xs">
        {i18n.t('Choose when prompts start, then add reviews wherever you need a second opinion.')}
      </p>
      <AgentWorkflowExecution
        value={execution}
        disabled={disabled}
        onChange={(mode) => {
          setExecution(mode);
          if (mode === 'parallel') setConversation('separate');
        }}
      />
      {execution === 'parallel' && (
        <p className="text-fg-dim text-xs">
          {i18n.t('Parallel prompts use separate conversations and working copies.')}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2" aria-label={i18n.t('Queue conversation mode')}>
        {(
          [
            [
              'separate',
              i18n.t('Separate conversations'),
              i18n.t('Each prompt opens a new agent task in the same working copy.'),
            ],
            [
              'same',
              i18n.t('Same conversation'),
              i18n.t('Keep the prompt agent’s conversation and context between steps.'),
            ],
          ] as const
        ).map(([value, title, description]) => (
          <label
            key={value}
            className={`bg-surface flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${conversation === value ? 'border-accent' : 'border-border'}`}
          >
            <Radio
              name="queue-conversation"
              disabled={disabled || (execution === 'parallel' && value === 'same')}
              value={value}
              checked={conversation === value}
              onChange={() => setConversation(value)}
            />
            <span className="text-fg text-xs">
              {title}
              <span className="text-fg-dim mt-1 block text-[11px]">{description}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-fg-muted space-y-1 text-xs">
          <span>{i18n.t('Prompt agent')}</span>
          <SearchableSelect
            label={i18n.t('Queue prompt agent')}
            disabled={disabled}
            searchable={false}
            value={target}
            options={producers.map((agent) => ({ value: agent.id, label: agent.name }))}
            onChange={(value) => {
              if (value === target) return;
              setProducer(value);
              setRows(rows.map((row) => ({ ...row, model: '', effort: '' })));
            }}
          />
        </label>
        <div className="text-fg-muted space-y-1 text-xs">
          <span>{i18n.t('Review agent')}</span>
          <SearchableSelect
            label={i18n.t('Queue review agent')}
            disabled={disabled}
            searchable={false}
            value={reviewTarget}
            options={reviewers.map((agent) => ({ value: agent.id, label: agent.name }))}
            onChange={(value) => {
              if (value === reviewTarget) return;
              setReviewer(value);
              setReviewSettings({ model: '', effort: '' });
            }}
          />
          <AgentWorkflowModelControls
            projectId={projectId}
            target={reviewTarget}
            {...reviewSettings}
            disabled={disabled}
            label={i18n.t('Review model and reasoning')}
            onChange={setReviewSettings}
          />
        </div>
      </div>
      <AgentWorkflowReviewPolicy
        value={reviewPolicy}
        onChange={setReviewPolicy}
        disabled={disabled}
      />
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.id} className="border-border bg-surface space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`queued-prompt-${row.id}`} className="text-fg text-xs font-medium">
                {i18n.rich('Prompt {value1}', { value1: index + 1 })}
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={i18n.t('Move prompt {value1} up', { value1: index + 1 })}
                  disabled={index === 0}
                  className="text-fg-muted p-1 disabled:opacity-30"
                  onClick={() => setRows(moveWorkflowStep(rows, index, -1))}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={i18n.t('Move prompt {value1} down', { value1: index + 1 })}
                  disabled={index === rows.length - 1}
                  className="text-fg-muted p-1 disabled:opacity-30"
                  onClick={() => setRows(moveWorkflowStep(rows, index, 1))}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={i18n.t('Remove prompt {value1}', { value1: index + 1 })}
                  disabled={rows.length <= 1}
                  className="text-fg-muted p-1 disabled:opacity-30"
                  onClick={() => setRows(rows.filter((entry) => entry.id !== row.id))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <Textarea
              id={`queued-prompt-${row.id}`}
              className={field}
              rows={3}
              value={row.prompt}
              placeholder={
                index === 0
                  ? i18n.t('What should the agent do first?')
                  : i18n.t('What should happen next?')
              }
              onChange={(event) =>
                setRows(
                  rows.map((entry) =>
                    entry.id === row.id ? { ...entry, prompt: event.target.value } : entry,
                  ),
                )
              }
            />
            <AgentWorkflowModelControls
              projectId={projectId}
              target={target}
              model={row.model}
              effort={row.effort}
              disabled={disabled}
              label={i18n.t('Prompt {value1} model and reasoning', { value1: index + 1 })}
              onChange={(settings) =>
                setRows(
                  rows.map((entry) => (entry.id === row.id ? { ...entry, ...settings } : entry)),
                )
              }
            />
            {index < rows.length - 1 ? (
              <label className="text-fg-muted flex items-center gap-2 text-[11px]">
                {i18n.rich('{checkbox}Review prompt {number}', {
                  checkbox: (
                    <Checkbox
                      checked={row.review}
                      onChange={(event) =>
                        setRows(
                          rows.map((entry) =>
                            entry.id === row.id
                              ? { ...entry, review: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                  ),
                  number: i18n.number(index + 1),
                })}
              </label>
            ) : (
              <p className="text-fg-dim text-[11px]">
                {i18n.t('A final independent review is included before applying changes.')}
              </p>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={button}
        disabled={steps.length >= MAX_WORKFLOW_STEPS}
        onClick={() => {
          const id = nextId.current++;
          setRows([...rows, { id, prompt: '', review: false, model: '', effort: '' }]);
        }}
      >
        {i18n.rich('{value1} Another prompt', { value1: <Plus className="size-3.5" /> })}
      </button>
      <p className="text-fg-dim text-[11px]">
        {i18n.t(
          'Reviews use independent conversations. Their decision policy still applies when findings arrive.',
        )}
      </p>
      {steps.length > MAX_WORKFLOW_STEPS && (
        <p role="alert" className="text-tone-warning-fg text-xs">
          {i18n.rich('Keep the queue within {MAX_WORKFLOW_STEPS} steps, including reviews.', {
            MAX_WORKFLOW_STEPS: MAX_WORKFLOW_STEPS,
          })}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`${button} bg-accent text-accent-fg`}
          disabled={
            disabled ||
            rows.some((row) => !row.prompt.trim()) ||
            !target ||
            !reviewTarget ||
            steps.length > MAX_WORKFLOW_STEPS
          }
          onClick={() => onApply(steps, conversation)}
        >
          {i18n.rich('Use this queue · {value1} steps', { value1: steps.length })}
        </button>
        <button type="button" className={button} onClick={onCancel}>
          {i18n.t('Cancel')}
        </button>
      </div>
    </fieldset>
  );
}
