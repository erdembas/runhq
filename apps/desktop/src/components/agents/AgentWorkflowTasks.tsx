import { AgentWorkflowExecutionSettings } from './AgentWorkflowExecutionSettings';
import { Textarea } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Choice';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Check,
  ChevronDown,
  Plus,
  ScanEye,
  Trash2,
  Undo2,
} from 'lucide-react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentBackend } from '@runhq/cockpit-types';
import type { CreateWorkflowStep, WorkflowContext } from '@/lib/ipc/agentWorkflowIpc';
import { AgentWorkflowStudio } from './AgentWorkflowStudio';
import { AgentWorkflowExecution } from './AgentWorkflowExecution';
import { AgentWorkflowCanvas } from './AgentWorkflowCanvas';
import { AgentWorkflowViewToggle } from './AgentWorkflowViewToggle';
import { AgentWorkflowPromptQueue } from './AgentWorkflowPromptQueue';
import { AgentWorkflowReviewPolicy } from './AgentWorkflowReviewPolicy';
import { AgentWorkflowModelControls } from './AgentWorkflowModelControls';
import {
  workflowAncestors,
  workflowRoleReviews,
  workflowRoleUsesAgent,
} from './agentWorkflowGraph';
import {
  WORKFLOW_TEMPLATES,
  setWorkflowExecution,
  workflowExecutionMode,
  workflowHasControlFlow,
  moveWorkflowQueue,
  workflowIsQueue,
  insertWorkflowTask,
  canConnectWorkflowTasks,
  createWorkflowTemplate,
  removeWorkflowTask,
  workflowStepTitle,
  type WorkflowTemplate,
  type WorkflowConversationMode,
} from './agentWorkflowEditor';
import {
  MAX_WORKFLOW_STEPS,
  WORKFLOW_ROLE_OPTIONS,
  isolateConcurrentProducers,
  workflowRoleProduces,
  workflowTasksProblems,
} from './agentWorkflowStepPolicy';

const field =
  'border-border bg-surface text-fg focus:border-accent focus:ring-accent/15 focus:ring-2 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none';
const label = 'text-fg-muted flex flex-col gap-1.5 text-xs';
const button =
  'border-border hover:bg-fg/5 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs disabled:opacity-40';

export function AgentWorkflowTasks({
  steps,
  context,
  projectId,
  onChange,
  producers,
  reviewers,
  poolOptions,
  resolveTarget,
  disabled,
  onQueueCreated,
  onQueueEditingChange,
  onValidationChange,
  lockedIds = [],
  live = false,
}: {
  lockedIds?: string[];
  live?: boolean;
  steps: CreateWorkflowStep[];
  context?: WorkflowContext | null;
  projectId: string;
  onChange: (steps: CreateWorkflowStep[]) => void;
  producers: AgentBackend[];
  reviewers: AgentBackend[];
  poolOptions: { value: string; label: string; description?: string }[];
  resolveTarget: (target: string, candidates: AgentBackend[]) => string;
  disabled?: boolean;
  onQueueCreated?: () => void;
  onQueueEditingChange?: (editing: boolean) => void;
  onValidationChange?: (invalid: boolean) => void;
}) {
  i18n.useLocale();
  const locked = new Set(lockedIds);
  const [environmentDrafts, setEnvironmentDrafts] = useState<
    Record<string, { text: string; invalid: boolean }>
  >({});
  const invalidEnvironment = steps.some((step) => environmentDrafts[step.id]?.invalid);
  useEffect(() => {
    onValidationChange?.(invalidEnvironment);
    return () => onValidationChange?.(false);
  }, [invalidEnvironment, onValidationChange]);
  const [executionChoice, setExecutionChoice] = useState<ReturnType<
    typeof workflowExecutionMode
  > | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [previous, setPrevious] = useState<CreateWorkflowStep[] | null>(null);
  const [queuing, setQueuing] = useState(false);
  useEffect(() => {
    onQueueEditingChange?.(queuing);
    return () => onQueueEditingChange?.(false);
  }, [queuing, onQueueEditingChange]);
  const [conversation, setConversation] = useState<WorkflowConversationMode>(
    steps.some((step) => step.continue_from) ? 'same' : 'separate',
  );
  const current = steps.find((step) => step.id === selected) ?? steps[0];
  const currentLocked = !!current && locked.has(current.id);
  const insertBlocked =
    !!current && steps.some((step) => locked.has(step.id) && step.depends_on.includes(current.id));
  const linear = workflowIsQueue(steps);
  const problems = [
    ...workflowTasksProblems(steps, context),
    ...steps
      .filter((step) => environmentDrafts[step.id]?.invalid)
      .map((step) => ({
        taskId: step.id,
        message: i18n.t('“{id}” has invalid execution settings.', { id: step.id }),
        severity: 'error' as const,
        fix: undefined,
      })),
  ];
  const blocking = problems.filter((problem) => problem.severity === 'error');
  const candidates = (role: string) =>
    workflowRoleUsesAgent(role) ? (workflowRoleReviews(role) ? reviewers : producers) : [];
  const providerName = (target: string) =>
    [...producers, ...reviewers].find((tool) => tool.id === target)?.name ??
    poolOptions.find((pool) => pool.value === target)?.label ??
    target;
  const change = (next: CreateWorkflowStep[]) => {
    if (
      steps.some(
        (old) =>
          locked.has(old.id) &&
          JSON.stringify(old) !== JSON.stringify(next.find((step) => step.id === old.id)),
      )
    )
      return;

    setPrevious(steps);
    setExecutionChoice(null);
    onChange(next);
  };
  const update = (id: string, patch: Partial<CreateWorkflowStep>) =>
    change(steps.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  const applyTemplate = (template: WorkflowTemplate) => {
    if (template === 'queue') {
      setQueuing(true);
      return;
    }
    setQueuing(false);
    setView('map');
    setConversation('separate');
    const next = createWorkflowTemplate(template, producers[0]?.id ?? '', reviewers[0]?.id ?? '');
    change(next);
    setSelected(next[0]?.id ?? null);
  };
  const insert = (role: 'implement' | 'review') => {
    if (!current) return;
    const next = insertWorkflowTask(
      steps,
      current.id,
      role,
      (role === 'review' ? reviewers : producers)[0]?.id ?? '',
      reviewers[0]?.id ?? '',
      steps.some((step) => step.continue_from) ? 'same' : conversation,
      context?.workspace_mode !== 'direct',
    );
    if (!next || next.steps.length > MAX_WORKFLOW_STEPS) return;
    const mode = executionChoice ?? workflowExecutionMode(steps);
    change(
      !live && !context && mode !== 'custom' ? setWorkflowExecution(next.steps, mode) : next.steps,
    );
    setExecutionChoice(mode);
    setSelected(next.id);
  };
  const promptSlots =
    current &&
    context?.workspace_mode !== 'direct' &&
    !steps.some((step) => step.depends_on.includes(current.id))
      ? 2
      : 1;
  const connect = (source: string, target: string) => {
    if (disabled || locked.has(target) || !canConnectWorkflowTasks(steps, source, target)) return;
    const step = steps.find((entry) => entry.id === target)!;
    update(target, { depends_on: [...step.depends_on, source] });
  };
  const readableProblem = (message: string) =>
    steps.reduce(
      (text, step, index) =>
        text.replaceAll(`“${step.id}”`, i18n.t('Step {value1}', { value1: index + 1 })),
      message,
    );

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">{i18n.t('Choose how the work gets done')}</legend>
      {!live && (
        <details className="group/templates">
          <summary className="text-fg-muted cursor-pointer text-xs">
            {i18n.t('Start from a template')}
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {WORKFLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={disabled}
                onClick={() => applyTemplate(template.id)}
                className="border-border bg-surface hover:border-accent/50 hover:bg-accent/5 rounded-xl border p-3 text-left disabled:opacity-40"
              >
                <span className="text-fg flex items-center justify-between gap-2 text-xs font-medium">
                  {template.name}
                  <ArrowRight className="text-fg-dim size-3.5" />
                </span>
                <span className="text-fg-dim mt-1 block text-[11px] leading-relaxed">
                  {template.description}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
      {queuing ? (
        <AgentWorkflowPromptQueue
          projectId={projectId}
          producers={producers}
          reviewers={reviewers}
          disabled={disabled}
          onCancel={() => setQueuing(false)}
          onApply={(next, mode) => {
            change(next);
            setSelected(next[0]?.id ?? null);
            setConversation(mode);
            setQueuing(false);
            setView('map');
            onQueueCreated?.();
          }}
        />
      ) : (
        <>
          <AgentWorkflowStudio
            toolbar={
              <>
                <span className="text-fg text-xs font-medium">{i18n.t('Your workflow')}</span>
                <span className="text-fg-dim text-[11px]">
                  {i18n.plural('{count} step', '{count} steps', steps.length)}
                </span>
                <AgentWorkflowViewToggle value={view} onChange={setView} />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {previous && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        onChange(previous);
                        setEnvironmentDrafts({});
                        setExecutionChoice(null);
                        setPrevious(null);
                      }}
                    >
                      {i18n.rich('{value1} Undo', { value1: <Undo2 className="size-3" /> })}
                    </button>
                  )}
                  <span className="text-fg-dim text-[11px]">
                    {i18n.rich('After step {value1}', {
                      value1: current ? steps.indexOf(current) + 1 : '—',
                    })}
                  </span>
                  <button
                    type="button"
                    className={button}
                    disabled={
                      disabled ||
                      insertBlocked ||
                      !current ||
                      steps.length + promptSlots > MAX_WORKFLOW_STEPS
                    }
                    onClick={() => insert('implement')}
                  >
                    {i18n.rich('{value1} Add prompt', { value1: <Plus className="size-3.5" /> })}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={
                      disabled ||
                      insertBlocked ||
                      !current ||
                      !reviewers.length ||
                      steps.length >= MAX_WORKFLOW_STEPS
                    }
                    onClick={() => insert('review')}
                  >
                    {i18n.rich('{value1} Add review', { value1: <ScanEye className="size-3.5" /> })}
                  </button>
                </div>
              </>
            }
          >
            <div className="p-3">
              <AgentWorkflowExecution
                value={executionChoice ?? workflowExecutionMode(steps)}
                disabled={
                  disabled || lockedIds.length > 0 || !!context || workflowHasControlFlow(steps)
                }
                controlFlow={!!context || workflowHasControlFlow(steps)}
                onChange={(mode) => {
                  change(setWorkflowExecution(steps, mode));
                  setExecutionChoice(mode);
                }}
              />
            </div>
            <div
              className={`workflow-studio-content grid min-w-0 ${view === 'list' ? 'lg:grid-cols-[300px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(360px,38%)]'}`}
            >
              <div className="min-h-0 min-w-0 overflow-auto">
                {view === 'list' && (
                  <ol aria-label={i18n.t('Steps in execution order')} className="space-y-2 p-3">
                    {steps.map((step, index) => (
                      <li
                        key={step.id}
                        className={`flex items-center gap-2 rounded-lg border p-2 ${current?.id === step.id ? 'border-accent bg-accent/5' : 'border-border'}`}
                      >
                        <button
                          type="button"
                          aria-pressed={current?.id === step.id}
                          onClick={() => setSelected(step.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="text-fg-dim text-[10px]">
                            {index + 1} ·{' '}
                            {
                              WORKFLOW_ROLE_OPTIONS.find((option) => option.value === step.role)
                                ?.label
                            }
                            {locked.has(step.id) ? ` · ${i18n.t('Already started')}` : ''}
                          </span>
                          <span className="text-fg block truncate text-xs">
                            {workflowStepTitle(step)}
                          </span>
                          <span className="text-fg-dim block text-[10px]">
                            {workflowRoleUsesAgent(step.role)
                              ? providerName(step.target)
                              : WORKFLOW_ROLE_OPTIONS.find((option) => option.value === step.role)
                                  ?.label}
                            {step.continue_from
                              ? ` · ${i18n.t('Continues an earlier conversation')}`
                              : ''}
                          </span>
                        </button>
                        {linear &&
                          ([-1, 1] as const).map((delta) => (
                            <button
                              key={delta}
                              type="button"
                              className="text-fg-muted p-1 disabled:opacity-25"
                              aria-label={i18n.t(
                                delta < 0 ? 'Move step {value1} up' : 'Move step {value1} down',
                                { value1: index + 1 },
                              )}
                              disabled={
                                disabled ||
                                locked.has(step.id) ||
                                !steps[index + delta] ||
                                locked.has(steps[index + delta]!.id)
                              }
                              onClick={() =>
                                change(moveWorkflowQueue(steps, step.id, delta, locked))
                              }
                            >
                              {delta < 0 ? (
                                <ArrowUp className="size-3.5" />
                              ) : (
                                <ArrowDown className="size-3.5" />
                              )}
                            </button>
                          ))}
                      </li>
                    ))}
                    {!linear && (
                      <li className="text-fg-dim text-[11px]">
                        {i18n.t(
                          'This workflow has parallel branches. Use the map to change dependencies.',
                        )}
                      </li>
                    )}
                  </ol>
                )}
                <div hidden={view !== 'map'} className="h-full">
                  <AgentWorkflowCanvas
                    steps={steps}
                    selected={current?.id}
                    onSelect={setSelected}
                    providerName={providerName}
                    disabled={disabled}
                    problems={
                      new Set(
                        blocking.flatMap((problem) => (problem.taskId ? [problem.taskId] : [])),
                      )
                    }
                    onConnect={({ source, target }) => connect(source, target)}
                    canConnect={(source, target) =>
                      !locked.has(target) && canConnectWorkflowTasks(steps, source, target)
                    }
                    onDisconnect={(source, target) => {
                      if (disabled || locked.has(target)) return;
                      const step = steps.find((entry) => entry.id === target);
                      if (step)
                        update(target, {
                          depends_on: step.depends_on.filter((id) => id !== source),
                        });
                    }}
                    lockedIds={lockedIds}
                  />
                </div>
              </div>
              {current && (
                <fieldset
                  disabled={disabled || currentLocked}
                  className="border-border bg-surface workflow-studio-inspector min-w-0 space-y-4 border-t p-4 lg:overflow-y-auto lg:border-t-0 lg:border-l"
                >
                  {currentLocked && (
                    <p className="text-fg-dim text-xs">
                      {i18n.t(
                        'This step has already started. You can add new steps after it or edit waiting steps.',
                      )}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-fg text-xs font-semibold">
                      {i18n.rich('Step {value1}', { value1: steps.indexOf(current) + 1 })}
                    </h4>
                    <button
                      type="button"
                      className="text-fg-dim hover:text-tone-critical-fg rounded p-1 disabled:opacity-30"
                      aria-label={i18n.t('Remove selected step')}
                      disabled={disabled || currentLocked || steps.length <= 1}
                      onClick={() => {
                        change(removeWorkflowTask(steps, current.id));
                        setSelected(null);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <details
                    key={current.id}
                    className="group/dependencies border-border/70 rounded-lg border p-2.5 text-xs"
                  >
                    <summary className="text-fg-muted flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      {i18n.rich('Run after · {value1}', {
                        value1: current.depends_on.length
                          ? i18n.plural('{count} step', '{count} steps', current.depends_on.length)
                          : i18n.t('Starts immediately'),
                      })}
                      <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/dependencies:rotate-180" />
                    </summary>
                    <p className="text-fg-dim mt-2 text-[11px]">
                      {i18n.t('Wait for all selected steps to finish.')}
                    </p>
                    <div className="mt-2 max-h-36 space-y-2 overflow-auto">
                      {steps
                        .filter((step) => step.id !== current.id)
                        .map((step) => {
                          const checked = current.depends_on.includes(step.id);
                          return (
                            <label
                              key={step.id}
                              className="text-fg-muted flex items-start gap-2 text-[11px]"
                            >
                              <Checkbox
                                checked={checked}
                                disabled={
                                  disabled ||
                                  currentLocked ||
                                  (!checked && !canConnectWorkflowTasks(steps, step.id, current.id))
                                }
                                onChange={() =>
                                  checked
                                    ? update(current.id, {
                                        depends_on: current.depends_on.filter(
                                          (id) => id !== step.id,
                                        ),
                                      })
                                    : connect(step.id, current.id)
                                }
                              />
                              <span className="line-clamp-2">
                                {steps.indexOf(step) + 1}. {workflowStepTitle(step)}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </details>
                  <label className={label}>
                    {i18n.rich('Action{value1}', {
                      value1: (
                        <SearchableSelect
                          label={i18n.t('Step action')}
                          searchable={false}
                          value={current.role}
                          options={WORKFLOW_ROLE_OPTIONS}
                          disabled={disabled || currentLocked}
                          onChange={(role) => {
                            const next = role as CreateWorkflowStep['role'];
                            const target = candidates(next).some(
                              (tool) => tool.id === current.target,
                            )
                              ? current.target
                              : (candidates(next)[0]?.id ?? '');
                            update(current.id, {
                              role: next,
                              review_policy: workflowRoleReviews(next)
                                ? current.review_policy || 'on_findings'
                                : '',
                              target,
                              ...(target !== current.target ? { model: '', effort: '' } : {}),
                              workspace:
                                context?.workspace_mode !== 'direct' &&
                                workflowRoleProduces(next) &&
                                workflowRoleUsesAgent(next)
                                  ? current.workspace
                                  : 'shared',
                              execution: {
                                ...current.execution,
                                ...(!workflowRoleUsesAgent(next) ||
                                workflowRoleReviews(next) ||
                                target !== current.target
                                  ? { agent_profile: '' }
                                  : {}),
                                command: next === 'shell' ? (current.execution?.command ?? '') : '',
                              },
                              continue_from:
                                workflowRoleProduces(next) && next !== 'shell'
                                  ? current.continue_from
                                  : undefined,
                            });
                          }}
                        />
                      ),
                    })}
                  </label>
                  {workflowRoleProduces(current.role) && workflowRoleUsesAgent(current.role) && (
                    <label className={label}>
                      {i18n.rich('Conversation{value1}', {
                        value1: (
                          <SearchableSelect
                            label={i18n.t('Step conversation')}
                            searchable={false}
                            disabled={disabled || currentLocked}
                            value={current.continue_from ?? ''}
                            options={[
                              { value: '', label: i18n.t('New conversation') },
                              ...steps
                                .filter(
                                  (step) =>
                                    workflowRoleProduces(step.role) &&
                                    workflowRoleUsesAgent(step.role) &&
                                    step.workspace !== 'own' &&
                                    workflowAncestors(steps, current.id).has(step.id),
                                )
                                .map((step) => ({
                                  value: step.id,
                                  label: i18n.t('Continue step {value1}', {
                                    value1: steps.indexOf(step) + 1,
                                  }),
                                  description: workflowStepTitle(step),
                                })),
                            ]}
                            onChange={(id) => {
                              const source = steps.find((step) => step.id === id);
                              update(current.id, {
                                continue_from: id || undefined,
                                ...(source ? { target: source.target, workspace: 'shared' } : {}),
                                ...(source && source.target !== current.target
                                  ? {
                                      model: '',
                                      effort: '',
                                      execution: { ...current.execution, agent_profile: '' },
                                    }
                                  : {}),
                              });
                            }}
                          />
                        ),
                      })}
                    </label>
                  )}
                  <label className={label}>
                    {i18n.rich('What should happen?{value1}', {
                      value1: (
                        <Textarea
                          rows={10}
                          className={field}
                          value={current.prompt}
                          placeholder={i18n.t('Describe what this step should do…')}
                          onChange={(event) => update(current.id, { prompt: event.target.value })}
                        />
                      ),
                    })}
                  </label>
                  {workflowRoleUsesAgent(current.role) && (
                    <>
                      <label className={label}>
                        {i18n.rich('Agent{value1}', {
                          value1: (
                            <SearchableSelect
                              label={i18n.t('Step agent')}
                              searchable={false}
                              disabled={disabled || currentLocked}
                              value={current.target}
                              options={[
                                ...candidates(current.role).map((tool) => ({
                                  value: tool.id,
                                  label: tool.name,
                                })),
                                ...poolOptions,
                              ]}
                              onChange={(value) => {
                                const target = resolveTarget(value, candidates(current.role));
                                update(current.id, {
                                  target,
                                  ...(target !== current.target
                                    ? {
                                        model: '',
                                        effort: '',
                                        execution: { ...current.execution, agent_profile: '' },
                                      }
                                    : {}),
                                });
                              }}
                            />
                          ),
                        })}
                      </label>
                      <AgentWorkflowModelControls
                        projectId={projectId}
                        workingDirectory={context?.working_directory}
                        target={current.target}
                        model={current.model}
                        effort={current.effort}
                        agent={current.execution?.agent_profile ?? ''}
                        allowProfile={workflowRoleProduces(current.role)}
                        disabled={disabled || currentLocked}
                        onChange={({ model, effort, agent }) =>
                          update(current.id, {
                            model,
                            effort,
                            ...(agent !== undefined
                              ? { execution: { ...current.execution, agent_profile: agent } }
                              : {}),
                          })
                        }
                      />
                    </>
                  )}
                  {workflowRoleReviews(current.role) && (
                    <AgentWorkflowReviewPolicy
                      value={current.review_policy}
                      disabled={disabled || currentLocked}
                      onChange={(review_policy) => update(current.id, { review_policy })}
                    />
                  )}
                  <details className="group/settings border-border/70 rounded-lg border p-2.5 text-xs">
                    <summary className="text-fg-muted flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      {i18n.t('Advanced step settings')}
                      <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/settings:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-3">
                      <AgentWorkflowExecutionSettings
                        key={current.id}
                        step={current}
                        steps={steps}
                        direct={context?.workspace_mode === 'direct'}
                        environmentDraft={environmentDrafts[current.id]?.text}
                        onEnvironmentDraftChange={(text, invalid) =>
                          setEnvironmentDrafts((drafts) => ({
                            ...drafts,
                            [current.id]: { text, invalid },
                          }))
                        }
                        disabled={disabled || currentLocked}
                        onChange={(execution) => update(current.id, { execution })}
                      />

                      <label className="text-fg-muted flex items-start gap-2 text-[11px]">
                        {i18n.rich('{value1}Give this step a separate working copy', {
                          value1: (
                            <Checkbox
                              checked={current.workspace === 'own'}
                              disabled={
                                disabled ||
                                currentLocked ||
                                !workflowRoleProduces(current.role) ||
                                current.role === 'shell' ||
                                context?.workspace_mode === 'direct'
                              }
                              onChange={(event) =>
                                update(current.id, {
                                  workspace: event.target.checked ? 'own' : 'shared',
                                })
                              }
                            />
                          ),
                        })}
                      </label>
                      <p className="text-fg-dim text-[10px]">
                        {i18n.rich('Step ID: {value1}', { value1: current.id })}
                      </p>
                    </div>
                  </details>
                </fieldset>
              )}
            </div>
          </AgentWorkflowStudio>
          {blocking.length ? (
            <div
              className="border-tone-warning/25 bg-tone-warning/5 rounded-xl border p-3"
              role="status"
            >
              <p className="text-fg mb-1 text-xs font-medium">{i18n.t('A few things to finish')}</p>
              <ul className="text-fg-muted list-inside list-disc space-y-1 text-[11px]">
                {blocking.map((problem) => (
                  <li key={problem.message}>{readableProblem(problem.message)}</li>
                ))}
              </ul>
              {blocking.some((problem) => problem.fix === 'isolate-concurrent-producers') && (
                <button
                  type="button"
                  className={`${button} mt-2`}
                  onClick={() => change(isolateConcurrentProducers(steps))}
                >
                  {i18n.t('Use separate working copies')}
                </button>
              )}
            </div>
          ) : (
            <p className="text-status-running flex items-center gap-1.5 text-[11px]">
              {i18n.rich('{value1} Steps are connected and ready.', {
                value1: <Check className="size-3.5" />,
              })}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
