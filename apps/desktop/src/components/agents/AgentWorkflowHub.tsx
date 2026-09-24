import { AgentPipelineHub } from './AgentPipelineHub';
import { open as openWorkflowFile } from '@tauri-apps/plugin-dialog';
import { parseRecipe, portableAgentRecipe, type AgentRecipe } from './agentLibraryModel';
import { recipeStepsToCreateSteps } from './agentWorkflowRecipeBridge';
import { workflowExecutionError } from './workflowExecutionMessages';
import { Input, Textarea } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Choice';
import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AgentItem } from '@runhq/cockpit-types';
import { agentIsActive, SearchableSelect } from '@runhq/cockpit-ui';
import {
  agentWorkflowIpc,
  type AgentWorkflow,
  type CreateWorkflowStep,
  type WorkflowCheck,
  type WorkflowWorktree,
} from '@/lib/ipc/agentWorkflowIpc';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { agentCapacityPreferences, agentOccupiedSlots } from './agentCapacity';
import {
  chooseAgentAccount,
  isPoolTarget,
  parseAccountCooldowns,
  parseAccountPool,
  poolTarget,
  type AgentAccountPool,
} from './agentAccountRouting';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentDiscovery } from './useAgentDiscovery';

export interface AgentWorkflowRecipe {
  title?: string;
  prompt: string;
  backend?: string;
  model?: string;
  effort?: string;
  reviewer?: string;
  setupCommands?: string[];
  checkCommands?: string[];
  acceptance?: string;
  /** A saved division of labour, when the recipe carries one. */
  steps?: CreateWorkflowStep[];
}
const field =
  'border-fg/15 bg-surface text-fg w-full rounded-lg border px-3 py-2 text-xs focus:border-accent focus:ring-accent/15 focus:ring-2 focus:outline-none';
const button =
  'border-fg/15 hover:bg-fg/5 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40';
const label = 'text-fg-muted flex flex-col gap-1.5 text-xs';
const stages: Record<string, string> = {
  get awaiting_review() {
    return i18n.t('Review needs your decision');
  },
  get waiting() {
    return i18n.t('Waiting for a task');
  },
  get launching() {
    return i18n.t('Starting workflow');
  },
  get launch_failed() {
    return i18n.t('Queued start paused');
  },
  get launch_paused() {
    return i18n.t('Queued start paused');
  },
  get setup_ready() {
    return i18n.t('Setup ready');
  },
  get setting_up() {
    return i18n.t('Setting up');
  },
  get setup_failed() {
    return i18n.t('Setup failed');
  },
  get implementation_ready() {
    return i18n.t('Ready to implement');
  },
  get implementing() {
    return i18n.t('Implementing');
  },
  get implementation_failed() {
    return i18n.t('Implementation stopped');
  },
  get review_ready() {
    return i18n.t('Ready for review');
  },
  get reviewing() {
    return i18n.t('Reviewing');
  },
  get review_failed() {
    return i18n.t('Review stopped');
  },
  get checks_ready() {
    return i18n.t('Ready for checks');
  },
  get checking() {
    return i18n.t('Running checks');
  },
  get checks_failed() {
    return i18n.t('Checks failed');
  },
  get ready() {
    return i18n.t('Ready to apply');
  },
  get integrating() {
    return i18n.t('Applying');
  },
  get integrated() {
    return i18n.t('Applied');
  },
  get integration_failed() {
    return i18n.t('Apply failed');
  },
  get cancelled() {
    return i18n.t('Stopped');
  },
  get interrupted() {
    return i18n.t('Interrupted');
  },
};
const lines = (value: string) =>
  value
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
const activeStages = [
  'waiting',
  'launching',
  'setting_up',
  'implementing',
  'reviewing',
  'checking',
  'integrating',
];

import { useAgentProjectOptions } from './useAgentProjectOptions';
import { AgentWorkflowTasks } from './AgentWorkflowTasks';
import { AgentWorkflowLiveEditor } from './AgentWorkflowLiveEditor';
import { AgentWorkflowBoard } from './AgentWorkflowBoard';
import { AgentWorkflowLaunchDialog } from './AgentWorkflowLaunchDialog';
import { workflowLaunchCandidates, type WorkflowLaunchChoice } from './agentWorkflowLaunch';
import {
  workflowPollInterval,
  workflowReviewNeedsDecision,
  workflowRunnableTasks,
  workflowTasksInExecutionOrder,
} from './agentWorkflowGraph';
import {
  newWorkflowStep,
  workflowRoleProduces,
  workflowStepsProblem,
} from './agentWorkflowStepPolicy';

export function AgentWorkflowHub({
  projectId,
  onOpenSession,
  visible = true,
  initialRecipe,
  requestedWorkflowId,
  requestRevision = 0,
  onWorkflowRequestHandled,
  shell = false,
}: {
  projectId?: string;
  onOpenSession?: (id: string, workflowId?: string) => void;
  visible?: boolean;
  initialRecipe?: AgentWorkflowRecipe;
  requestedWorkflowId?: string | null;
  requestRevision?: number;
  onWorkflowRequestHandled?: () => void;
  shell?: boolean;
}) {
  i18n.useLocale();
  const projects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const projectOptions = useAgentProjectOptions(projects, visible);
  const sessions = useVisibleStore(useAgentStore, (s) => s.sessions, visible);
  const tools = useVisibleStore(useAgentStore, (s) => s.tools, visible);
  useAgentDiscovery(visible);
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [importOptions, setImportOptions] = useState<AgentRecipe[]>([]);
  const [importing, setImporting] = useState(false);
  const [importedName, setImportedName] = useState('');
  const [showPackages, setShowPackages] = useState(false);
  const [creating, setCreating] = useState(!!initialRecipe);
  const handledRequest = useRef<string>();
  useEffect(() => {
    if (!requestedWorkflowId) {
      handledRequest.current = undefined;
      return;
    }
    if (!visible) return;
    const request = `${requestedWorkflowId}:${requestRevision}`;
    if (handledRequest.current === request) return;
    handledRequest.current = request;
    setSelected(requestedWorkflowId);
    setCreating(false);
    onWorkflowRequestHandled?.();
  }, [requestedWorkflowId, requestRevision, visible, onWorkflowRequestHandled]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const [launchChoice, setLaunchChoice] = useState<'create' | string | null>(null);
  const [newProject, setNewProject] = useState(projectId ?? '');
  // A recipe now seeds the first step rather than a pair of fixed fields.
  const backend = initialRecipe?.backend ?? '';
  const reviewer = initialRecipe?.reviewer ?? '';
  const model = initialRecipe?.model ?? '';
  const reviewModel = '';
  const effort = initialRecipe?.effort ?? '';
  const [autoProgress, setAutoProgress] = useState(true);
  const [concurrency, setConcurrency] = useState(0);
  const [liveDraft, setLiveDraft] = useState<AgentWorkflow | null>(null);
  const [queueEditing, setQueueEditing] = useState(false);
  const [objective, setObjective] = useState(initialRecipe?.prompt ?? '');
  const [acceptance, setAcceptance] = useState(initialRecipe?.acceptance ?? '');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [setup, setSetup] = useState(initialRecipe?.setupCommands?.join('\n') ?? '');
  const [checks, setChecks] = useState(initialRecipe?.checkCommands?.join('\n') ?? '');
  const [findings, setFindings] = useState<AgentItem[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [destination, setDestination] = useState<'working_tree' | 'branch'>('working_tree');
  const [branchName, setBranchName] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [transferPaths, setTransferPaths] = useState('');
  const [inventory, setInventory] = useState<WorkflowWorktree[] | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const available = tools.filter(
    (t) => t.enabled !== false && t.available && t.adapter !== 'terminal',
  );
  const reviewers = available.filter((t) => ['codex', 'claude'].includes(t.adapter ?? t.id));
  // A workflow step runs as one connection, so a pool is offered as a target and resolved the
  // moment it is chosen: the form then shows, and stores, the identity that will actually run.
  const libraryRecords = useVisibleStore(useAgentLibraryStore, (s) => s.records, visible);
  const accountPools = useMemo(() => {
    const parsed: AgentAccountPool[] = [];
    for (const [key, saved] of Object.entries(libraryRecords)) {
      if (!key.startsWith('pool:')) continue;
      try {
        parsed.push(parseAccountPool(saved.value));
      } catch {
        // An unreadable pool is not offered rather than shown as an empty target.
      }
    }
    return parsed.sort((left, right) => left.name.localeCompare(right.name));
  }, [libraryRecords]);
  const poolOptions = accountPools.map((pool) => ({
    value: poolTarget(pool.id),
    label: i18n.t('{value1} (pool)', { value1: pool.name }),
    description: i18n.t('RunHQ picks a free account'),
  }));
  const resolvePool = (value: string, candidates: typeof available) => {
    if (!isPoolTarget(value)) return value;
    const pool = accountPools.find((entry) => poolTarget(entry.id) === value);
    if (!pool) return '';
    return (
      chooseAgentAccount({
        pool: {
          ...pool,
          accounts: pool.accounts.filter((id) => candidates.some((t) => t.id === id)),
        },
        accounts: candidates.map((tool) => ({
          id: tool.id,
          name: tool.name,
          adapter: tool.adapter ?? '',
          enabled: tool.enabled !== false,
          available: tool.available,
        })),
        cooldowns: parseAccountCooldowns(libraryRecords['preferences:cooldowns']?.value),
        capacity: agentCapacityPreferences(libraryRecords['preferences:capacity']?.value),
        occupied: agentOccupiedSlots(
          useAgentStore.getState().sessions,
          useAgentQueueStore.getState().queues,
        ),
        now: Date.now(),
      }).accountId ?? ''
    );
  };
  const [steps, setSteps] = useState<CreateWorkflowStep[]>([]);
  // The default division of labour is the one this screen always ran: implement, then review.
  useEffect(() => {
    setSteps((current) => {
      if (current.length) {
        // Discovery can finish after the editor first mounts. Fill missing defaults without
        // replacing any account the person already chose.
        let changed = false;
        const next = current.map((step) => {
          const target =
            step.target ||
            (workflowRoleProduces(step.role)
              ? backend || available[0]?.id || ''
              : reviewer || reviewers[0]?.id || '');
          if (target === step.target) return step;
          changed = true;
          return { ...step, target };
        });
        return changed ? next : current;
      }
      const seeded = initialRecipe?.steps?.length
        ? // A recipe that saved its own division of labour defines the steps outright.
          initialRecipe.steps
        : [
            {
              ...newWorkflowStep('implement', backend || available[0]?.id || '', 'implement'),
              model,
              effort,
            },
            newWorkflowStep('review', reviewer || reviewers[0]?.id || '', 'review', ['implement']),
          ];
      // Older recipes recorded roles under one objective, with no separate task instruction.
      return seeded.map((step) => ({
        ...step,
        prompt:
          step.prompt ||
          (initialRecipe?.prompt.trim()
            ? workflowRoleProduces(step.role)
              ? initialRecipe.prompt
              : 'Independently inspect the completed work against the workflow objective and acceptance criteria. Report findings with file references.'
            : workflowRoleProduces(step.role)
              ? 'Implement the change described in the brief and meet the success criteria.'
              : 'Review the completed work against the brief and success criteria. Report any issues with file references.'),
      }));
    });
  }, [available, reviewers, backend, reviewer, model, effort, initialRecipe]);
  const openImportedWorkflow = (recipe: AgentRecipe) => {
    const importedSteps = recipeStepsToCreateSteps(recipe.workflowSteps ?? [], (target) =>
      resolvePool(target, available),
    );
    setSteps(
      importedSteps.length
        ? importedSteps
        : [
            {
              ...newWorkflowStep('implement', resolvePool(recipe.backend, available), 'implement'),
              prompt: recipe.prompt,
              model: recipe.model,
              effort: recipe.effort,
              mode: recipe.mode,
            },
            newWorkflowStep('review', reviewers[0]?.id ?? '', 'review', ['implement']),
          ],
    );
    setObjective(recipe.prompt);
    setAcceptance(recipe.acceptance);
    setSetup(recipe.setupCommands);
    setChecks(recipe.checkCommands);
    setImportedName(recipe.name);
    setAutoProgress(false);
    setImportOptions([]);
    setCreating(true);
  };
  const importWorkflow = async () => {
    setImporting(true);
    setError(null);
    try {
      const path = await openWorkflowFile({
        multiple: false,
        filters: [{ name: i18n.t('Workflow file'), extensions: ['json'] }],
      });
      if (typeof path !== 'string') return;
      const data = (await agentWorkflowIpc.importRecipes(path)) as {
        version?: number;
        recipes?: unknown[];
      };
      if (data.version !== 1 || !Array.isArray(data.recipes) || !data.recipes.length)
        throw new Error(i18n.t('Unsupported recipe file'));
      const recipes = data.recipes.map((value) => portableAgentRecipe(parseRecipe(value)));
      if (recipes.length === 1) openImportedWorkflow(recipes[0]!);
      else setImportOptions(recipes);
    } catch (error) {
      setError(String(error));
    } finally {
      setImporting(false);
    }
  };
  const stepsProblem = workflowStepsProblem(steps);
  const chosenProject = projectId || newProject || projects[0]?.id || '';
  const chosenBackend = backend || available[0]?.id || '';
  const chosenReviewer = reviewer || reviewers[0]?.id || '';
  const rows = workflows.filter((w) => !projectId || w.project_id === projectId);
  const current = rows.find((w) => w.id === selected) || rows[0];
  useEffect(() => {
    setTransferPaths('');
  }, [current?.id]);
  const loadInventory = async () => {
    setInventoryLoading(true);
    try {
      setInventory(await agentWorkflowIpc.inventory());
    } catch (e) {
      setError(String(e));
    } finally {
      setInventoryLoading(false);
    }
  };
  const refresh = useCallback(async () => {
    setWorkflows(await agentWorkflowIpc.list());
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      // While several agents are moving at once the board has to keep up; while nothing is
      // running there is nothing to keep up with.
      let interval = 5000;
      try {
        const next = await agentWorkflowIpc.list();
        interval = workflowPollInterval(next);
        if (live) setWorkflows(next);
      } catch (e) {
        if (live) setError(String(e));
      }
      if (live) timer = setTimeout(() => void poll(), interval);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [visible]);
  const reviewId = current?.review_session_id;
  const reviewRevision = reviewId ? sessions[reviewId]?.revision : undefined;
  useEffect(() => {
    setAccepted(false);
  }, [
    current?.id,
    current?.review_fingerprint,
    current?.preview?.target_fingerprint,
    current?.stage,
  ]);
  useEffect(() => {
    setFindings([]);
    if (!visible || !reviewId) return;
    let live = true;
    void ipc
      .agentSnapshot(reviewId)
      .then((snapshot) => {
        if (live)
          setFindings(
            snapshot.items.filter((item) => item.kind === 'assistant' || item.kind === 'result'),
          );
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [reviewId, reviewRevision, visible]);
  const action = async (work: () => Promise<AgentWorkflow>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError(null);
    try {
      const workflow = await work();
      setWorkflows((previous) => [workflow, ...previous.filter((w) => w.id !== workflow.id)]);
      setSelected(workflow.id);
      await useAgentStore.getState().refresh(true);
    } catch (e) {
      setError(String(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const open = (id: string) => {
    if (onOpenSession) onOpenSession(id, current?.id);
    else useAgentStore.getState().select(id);
  };
  const create = (choice: WorkflowLaunchChoice) =>
    action(async () => {
      const workflow = await agentWorkflowIpc.create({
        project_id: chosenProject,
        backend: steps[0]?.target || chosenBackend,
        model: steps[0]?.model || model,
        effort: steps[0]?.effort || effort,
        reviewer_backend: steps.find((step) => step.role === 'review')?.target || chosenReviewer,
        reviewer_model: steps.find((step) => step.role === 'review')?.model || reviewModel,
        steps: workflowTasksInExecutionOrder(steps),
        objective,
        acceptance,
        base_ref: baseRef,
        setup_commands: lines(setup),
        check_commands: lines(checks),
        auto_progress: autoProgress,
        // 0 lets the account capacity settings decide how many tasks run at once.
        concurrency,
      });
      // Keep the saved workflow accessible if launching fails; submitting again must not duplicate it.
      setWorkflows((previous) => [
        workflow,
        ...previous.filter((entry) => entry.id !== workflow.id),
      ]);
      setSelected(workflow.id);
      setCreating(false);
      setLaunchChoice(null);
      return choice.mode === 'draft'
        ? workflow
        : agentWorkflowIpc.launch(
            workflow.id,
            choice.mode === 'after' ? choice.sessionId : undefined,
          );
    });
  const launchWorkflow =
    launchChoice && launchChoice !== 'create'
      ? workflows.find((entry) => entry.id === launchChoice)
      : undefined;
  const launchTasks = workflowLaunchCandidates(
    sessions,
    launchWorkflow?.project_id ?? chosenProject,
    launchWorkflow
      ? [
          launchWorkflow.implementation_session_id,
          ...launchWorkflow.steps.flatMap((step) => (step.session_id ? [step.session_id] : [])),
        ]
      : [],
  );
  const chooseLaunch = (choice: WorkflowLaunchChoice) => {
    if (launchChoice === 'create') {
      void create(choice);
      return;
    }
    if (!launchWorkflow || choice.mode === 'draft') return;
    void action(async () => {
      const result = await agentWorkflowIpc.launch(
        launchWorkflow.id,
        choice.mode === 'after' ? choice.sessionId : undefined,
      );
      setLaunchChoice(null);
      return result;
    });
  };
  const requestStart = (stepId?: string) => {
    if (!current) return;
    if (current.steps.every((step) => !step.started_at)) {
      const others = workflowLaunchCandidates(sessions, current.project_id, [
        current.implementation_session_id,
      ]);
      if (others.length) setLaunchChoice(current.id);
      else void action(() => agentWorkflowIpc.launch(current.id));
    } else
      void action(() =>
        stepId
          ? agentWorkflowIpc.runStep(current.id, stepId)
          : agentWorkflowIpc.schedule(current.id),
      );
  };
  /** A step names a connection or a pool; both have to read as themselves. */
  const providerName = (target: string) => {
    if (!target) return '';
    if (isPoolTarget(target)) {
      const pool = accountPools.find((entry) => poolTarget(entry.id) === target);
      return pool ? i18n.t('{value1} (pool)', { value1: pool.name }) : i18n.t('Pool was removed');
    }
    return tools.find((tool) => tool.id === target)?.name ?? target;
  };
  const running = !!current && activeStages.includes(current.stage);
  const readyCount = current ? workflowRunnableTasks(current.steps ?? []).length : 0;
  const implementationSession = current ? sessions[current.implementation_session_id] : undefined;
  const implementationActive =
    !!implementationSession && agentIsActive(implementationSession.status);
  const reviewActive =
    !!reviewId && !!sessions[reviewId] && agentIsActive(sessions[reviewId].status);
  if (showPackages)
    return (
      <AgentPipelineHub
        visible={visible}
        onBack={() => setShowPackages(false)}
        onOpenSession={onOpenSession}
      />
    );
  return (
    <section
      aria-label={i18n.t('Agent workflows')}
      className="bg-bg text-fg flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      {visible && launchChoice && (
        <AgentWorkflowLaunchDialog
          tasks={launchTasks}
          busy={busy}
          error={error ? workflowExecutionError(error) : null}
          canSaveDraft={launchChoice === 'create'}
          onChoose={chooseLaunch}
          onClose={() => setLaunchChoice(null)}
        />
      )}
      <header className="border-fg/10 flex flex-wrap items-center justify-between gap-3 border-b p-4">
        {!shell && (
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {i18n.rich('{value1} Agent workflows', {
                value1: <GitPullRequest className="text-accent h-4 w-4" />,
              })}
            </h2>
            <p className="text-fg-dim mt-1 text-xs">
              {i18n.t(
                'Describe the goal. Let your agents work through the steps. Review the result.',
              )}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setShowPackages(true)}>
            {i18n.t('Pipeline packages')}
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || importing || creating}
            onClick={() => void importWorkflow()}
          >
            <Upload className="h-3.5 w-3.5" />
            {i18n.t('Import workflow')}
          </button>
          <button
            type="button"
            className={button}
            disabled={inventoryLoading}
            onClick={() => void loadInventory()}
          >
            {i18n.rich('{value1} Worktrees', {
              value1: inventoryLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitBranch className="h-3.5 w-3.5" />
              ),
            })}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => void refresh().catch((e) => setError(String(e)))}
            title={i18n.t('Refresh workflows')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={button}
            disabled={importing}
            onClick={() => setCreating((v) => !v)}
          >
            {i18n.rich('{value1} New workflow', { value1: <Plus className="h-3.5 w-3.5" /> })}
          </button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="border-danger/20 bg-danger/5 text-danger m-4 rounded-lg border p-3 text-xs"
        >
          {workflowExecutionError(error)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {inventory && (
          <details open className="border-fg/10 mb-4 rounded-xl border p-4">
            <summary className="cursor-pointer text-xs font-medium">
              {i18n.rich('Worktree inventory · {value1}', {
                value1: inventory.filter((entry) => !projectId || entry.project_id === projectId)
                  .length,
              })}
            </summary>
            <div className="mt-3 space-y-2">
              {inventory
                .filter((entry) => !projectId || entry.project_id === projectId)
                .map((entry) => (
                  <button
                    key={entry.session_id}
                    type="button"
                    onClick={() => {
                      if (entry.workflow_id) {
                        setSelected(entry.workflow_id);
                        setCreating(false);
                      } else open(entry.session_id);
                    }}
                    className="border-fg/10 hover:bg-fg/3 w-full rounded-lg border p-3 text-left"
                  >
                    <span className="flex flex-wrap gap-3 text-xs">
                      <strong>{entry.branch ?? i18n.t('Detached checkout')}</strong>
                      <span>
                        {entry.missing
                          ? i18n.t('Missing directory')
                          : entry.active
                            ? i18n.t('In use')
                            : entry.dirty
                              ? i18n.t('Contains changes')
                              : i18n.t('Clean')}
                      </span>
                      <span className="text-fg-dim">
                        {i18n.rich('{value1} MiB{value2}', {
                          value1: i18n.number(entry.size_bytes / 1024 / 1024, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                            useGrouping: false,
                          }),
                          value2: entry.size_incomplete ? i18n.t(' or more') : '',
                        })}
                      </span>
                    </span>
                    <span className="text-fg-dim mt-1 block text-[10px] break-all">
                      {i18n.rich('{value1} · base {value2}', {
                        value1: entry.path,
                        value2: entry.base_revision.slice(0, 12),
                      })}
                    </span>
                    {entry.status && (
                      <pre className="text-fg-dim mt-2 max-h-24 overflow-auto text-[10px]">
                        {entry.status}
                      </pre>
                    )}
                  </button>
                ))}
            </div>
          </details>
        )}
        {!!importOptions.length && !creating && (
          <section
            className="border-border mb-4 space-y-3 rounded-xl border p-5"
            aria-label={i18n.t('Choose a workflow')}
          >
            <h3 className="text-sm font-semibold">{i18n.t('Choose a workflow')}</h3>
            <p className="text-fg-muted text-xs">
              {i18n.t(
                'Open as a one-time draft. Nothing runs until you start it; no recipe is saved.',
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {importOptions.map((recipe, index) => (
                <button
                  key={index}
                  type="button"
                  className={`${button} justify-start`}
                  onClick={() => openImportedWorkflow(recipe)}
                >
                  {recipe.name}
                </button>
              ))}
            </div>
            <button type="button" className={button} onClick={() => setImportOptions([])}>
              {i18n.t('Cancel')}
            </button>
          </section>
        )}
        {creating ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (queueEditing) return;
              if (workflowLaunchCandidates(sessions, chosenProject).length)
                setLaunchChoice('create');
              else void create({ mode: autoProgress ? 'now' : 'draft' });
            }}
            className="w-full min-w-0 space-y-5"
          >
            <div>
              <h3 className="text-fg text-lg font-semibold">
                {importedName || i18n.t('What would you like to get done?')}
              </h3>
              <p className="text-fg-muted mt-1 text-xs">
                {i18n.t(
                  'Open as a one-time draft. Nothing runs until you start it; no recipe is saved.',
                )}
              </p>
            </div>
            <fieldset disabled={busy} className="space-y-5">
              <div className="grid items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                <label className={label}>
                  {i18n.rich('Project{value1}', {
                    value1: (
                      <SearchableSelect
                        label={i18n.t('Workflow project')}
                        indentGrouped
                        value={chosenProject}
                        disabled={!!projectId || busy}
                        options={projectOptions}
                        onChange={setNewProject}
                        searchPlaceholder={i18n.t('Find a project or group…')}
                      />
                    ),
                  })}
                </label>
                <label className={label}>
                  {i18n.rich('Shared context · optional{value1}{value2}', {
                    value1: (
                      <Textarea
                        rows={2}
                        className={field}
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        placeholder={i18n.t(
                          'For example: Add a search field to the project list so I can find projects by name.',
                        )}
                      />
                    ),
                    value2: (
                      <span className="text-fg-dim text-[11px]">
                        {i18n.t('Every step gets this context.')}
                      </span>
                    ),
                  })}
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-60">
                  <p className="text-fg-dim mb-1.5 text-[11px]">{i18n.t('Concurrent steps')}</p>
                  <SearchableSelect
                    label={i18n.t('Concurrent steps')}
                    value={String(concurrency)}
                    searchable={false}
                    disabled={busy}
                    options={[
                      { value: '0', label: i18n.t('All ready steps') },
                      ...[1, 2, 3, 4, 8, 16].map((count) => ({
                        value: String(count),
                        label: i18n.plural('{count} step', '{count} steps', count),
                      })),
                    ]}
                    onChange={(value) => setConcurrency(Number(value))}
                  />
                </div>
                <p className="text-fg-dim min-w-48 flex-1 text-[11px]">
                  {i18n.t(
                    'Agent capacity still applies. Separate working copies keep simultaneous prompts independent.',
                  )}
                </p>
              </div>
              <AgentWorkflowTasks
                projectId={chosenProject}
                steps={steps}
                onChange={setSteps}
                producers={available}
                reviewers={reviewers}
                poolOptions={poolOptions}
                resolveTarget={resolvePool}
                disabled={busy}
                onQueueCreated={() => setAutoProgress(true)}
                onQueueEditingChange={setQueueEditing}
              />
              {!reviewers.length && (
                <p className="text-warning text-xs">
                  {i18n.t('Connect Codex or Claude to review the completed work.')}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={label}>
                  {i18n.rich('Success criteria · optional{value1}', {
                    value1: (
                      <Textarea
                        rows={2}
                        className={field}
                        value={acceptance}
                        onChange={(e) => setAcceptance(e.target.value)}
                        placeholder={i18n.t('What should the finished result do?')}
                      />
                    ),
                  })}
                </label>
              </div>
              <details className="group/project border-border rounded-xl border p-4">
                <summary className="text-fg-muted flex cursor-pointer list-none items-center justify-between text-xs [&::-webkit-details-marker]:hidden">
                  {i18n.t('Advanced project settings')}
                  <ChevronDown className="size-3.5 transition-transform group-open/project:rotate-180" />
                </summary>
                <label className={`${label} mt-3`}>
                  {i18n.t('Automated checks · optional')}
                  <Textarea
                    rows={2}
                    className={`${field} font-mono`}
                    value={checks}
                    onChange={(e) => setChecks(e.target.value)}
                    placeholder={i18n.t('pnpm test')}
                  />
                  <span className="text-fg-dim text-[11px]">
                    {i18n.t(
                      'One command per line. If provided, every check must pass. Leave empty to use independent review without automated tests.',
                    )}
                  </span>
                </label>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className={label}>
                    {i18n.rich('Start from branch or commit{value1}', {
                      value1: (
                        <Input
                          className={field}
                          value={baseRef}
                          onChange={(e) => setBaseRef(e.target.value)}
                          placeholder={i18n.t('HEAD')}
                        />
                      ),
                    })}
                  </label>
                  <label className={label}>
                    {i18n.rich('Setup commands · optional{value1}', {
                      value1: (
                        <Textarea
                          rows={2}
                          className={`${field} font-mono`}
                          value={setup}
                          onChange={(e) => setSetup(e.target.value)}
                          placeholder={i18n.t('pnpm install --frozen-lockfile')}
                        />
                      ),
                    })}
                  </label>
                </div>
                <p className="text-fg-dim mt-3 text-[11px]">
                  {i18n.t(
                    'Work starts in a separate copy of your project. You can copy selected environment files before starting a saved workflow. Each command has a 10 minute limit.',
                  )}
                </p>
              </details>
              <label className="text-fg-muted flex items-start gap-2 text-xs">
                <Checkbox
                  checked={autoProgress}
                  onChange={(e) => setAutoProgress(e.target.checked)}
                />
                <span>
                  {i18n.rich('Run steps automatically{value1}', {
                    value1: (
                      <span className="text-fg-dim mt-1 block text-[11px]">
                        {i18n.t(
                          'Continue when a step finishes and pause if something fails. Applying changes always waits for your approval.',
                        )}
                      </span>
                    ),
                  })}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={`${button} bg-accent text-accent-fg border-transparent`}
                  disabled={busy || queueEditing || !chosenProject || !!stepsProblem}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {autoProgress ? i18n.t('Create & start') : i18n.t('Create workflow')}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy || queueEditing || !chosenProject || !!stepsProblem}
                  onClick={() => void create({ mode: 'draft' })}
                >
                  {i18n.t('Save for later')}
                </button>
                <span className="text-fg-dim text-[11px]">
                  {autoProgress
                    ? i18n.t(
                        'Choose start timing when another task is active. You approve the final result.',
                      )
                    : i18n.t('You choose when each step starts.')}
                </span>
              </div>
            </fieldset>
          </form>
        ) : !current ? (
          <div className="text-fg-dim mx-auto max-w-lg py-14 text-center text-sm">
            <GitPullRequest className="mx-auto mb-4 h-8 w-8" />
            <p>
              {i18n.t(
                'Give implementation and review their own agents, keep check evidence with the change, and apply it when you are ready.',
              )}
            </p>
            <button type="button" onClick={() => setCreating(true)} className={`${button} mt-5`}>
              {i18n.t('Create your first workflow')}
            </button>
          </div>
        ) : (
          <div className="grid min-h-0 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
            <nav aria-label={i18n.t('Saved workflows')} className="space-y-2">
              {rows.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={`border-fg/10 w-full rounded-xl border p-3 text-left ${w.id === current.id ? 'bg-accent/8 border-accent/30' : 'hover:bg-fg/3'}`}
                >
                  <span className="line-clamp-2 text-xs font-medium">{w.title}</span>
                  <span className="text-fg-dim mt-2 flex items-center gap-1.5 text-[11px]">
                    {activeStages.includes(w.stage) && <Loader2 className="h-3 w-3 animate-spin" />}
                    {stages[w.stage] ?? w.stage}
                    {w.cleaned ? i18n.t(' · cleaned') : ''}
                  </span>
                </button>
              ))}
            </nav>
            <article className="min-w-0 space-y-4">
              <div className="border-fg/10 rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{current.title}</h3>
                  <span className="text-accent text-xs">
                    {stages[current.stage] ?? current.stage}
                  </span>
                </div>
                <p className="text-fg-muted mt-3 text-xs whitespace-pre-wrap">
                  {current.objective}
                </p>
                {current.acceptance && (
                  <p className="text-fg-dim mt-3 text-xs whitespace-pre-wrap">
                    <strong>{i18n.t('Acceptance:')}</strong> {current.acceptance}
                  </p>
                )}
                {(current.start_after ||
                  ['waiting', 'launching', 'launch_failed', 'launch_paused'].includes(
                    current.stage,
                  )) && (
                  <div
                    className="border-accent/25 bg-accent/5 mt-4 space-y-2 rounded-lg border p-3"
                    role="status"
                  >
                    <p className="text-fg text-xs">
                      {current.start_after
                        ? i18n.t('Waiting for: {value1}', { value1: current.start_after.title })
                        : stages[current.stage]}
                    </p>
                    <p className="text-fg-muted text-[11px]">
                      {current.launch_pending
                        ? i18n.t(
                            'This workflow starts automatically when its turn arrives. You can leave this view.',
                          )
                        : i18n.t('Automatic start is paused. Choose when to start again.')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {current.start_after && (
                        <button
                          type="button"
                          className={button}
                          onClick={() => open(current.start_after!.session_id)}
                        >
                          {i18n.t('Open preceding task')}
                        </button>
                      )}
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void action(() => agentWorkflowIpc.launch(current.id))}
                      >
                        {i18n.t('Start now')}
                      </button>
                      {!current.launch_pending && (
                        <button
                          type="button"
                          className={button}
                          disabled={busy}
                          onClick={() => setLaunchChoice(current.id)}
                        >
                          {i18n.t('Choose start timing')}
                        </button>
                      )}
                      {current.launch_pending && (
                        <button
                          type="button"
                          className={button}
                          disabled={busy}
                          onClick={() => void action(() => agentWorkflowIpc.cancel(current.id))}
                        >
                          {i18n.t('Cancel queued start')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {!current.cleaned &&
                  !['setting_up', 'checking', 'integrating', 'integrated'].includes(
                    current.stage,
                  ) && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={button}
                        disabled={busy || liveDraft?.id === current.id}
                        onClick={() =>
                          void action(async () => {
                            const w = await agentWorkflowIpc.edit(current.id, true);
                            setLiveDraft(w);
                            return w;
                          })
                        }
                      >
                        {i18n.t(current.editing ? 'Reopen queue editor' : 'Edit waiting steps')}
                      </button>
                      {current.editing && (
                        <>
                          <span className="text-fg-muted text-xs">
                            {i18n.t('New steps are paused while you edit.')}
                          </span>
                          {liveDraft?.id !== current.id && (
                            <button
                              type="button"
                              className={button}
                              disabled={busy}
                              onClick={() =>
                                void action(() => agentWorkflowIpc.edit(current.id, false))
                              }
                            >
                              {i18n.t('Resume saved queue')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                {liveDraft?.id === current.id && current.editing && (
                  <div className="mt-4">
                    <AgentWorkflowLiveEditor
                      key={`${liveDraft.id}-${liveDraft.edit_revision}`}
                      workflow={liveDraft}
                      producers={available}
                      reviewers={reviewers}
                      poolOptions={poolOptions}
                      resolveTarget={resolvePool}
                      disabled={busy}
                      onCancel={() =>
                        void action(async () => {
                          const w = await agentWorkflowIpc.edit(current.id, false);
                          setLiveDraft(null);
                          return w;
                        })
                      }
                      onSave={(revision, steps) =>
                        void action(async () => {
                          const w = await agentWorkflowIpc.updateSteps(current.id, revision, steps);
                          setLiveDraft(null);
                          return w;
                        })
                      }
                    />
                  </div>
                )}
                {current.steps.filter(workflowReviewNeedsDecision).map((step) => (
                  <section
                    key={step.id}
                    role="status"
                    className="border-accent/30 bg-accent/5 mt-4 space-y-2 rounded-xl border p-3"
                    aria-label={i18n.t('Review decision')}
                  >
                    <p className="text-fg text-xs font-medium">
                      {i18n.t('Review needs your decision')} ·{' '}
                      {step.review_outcome === 'passed'
                        ? i18n.t('No issues reported')
                        : step.review_outcome === 'findings'
                          ? i18n.t('Issues found')
                          : i18n.t('Unclear verdict')}
                    </p>
                    <p className="text-fg-muted text-xs whitespace-pre-wrap">
                      {step.review_summary && workflowExecutionError(step.review_summary)}
                    </p>
                    {!!step.review_fix_attempts && (
                      <p className="text-fg-dim text-[11px]">
                        {i18n.t(
                          'The automatic correction attempt has finished. Choose what happens next.',
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {step.session_id && (
                        <button
                          type="button"
                          className={button}
                          onClick={() => open(step.session_id!)}
                        >
                          {i18n.t('Read review')}
                        </button>
                      )}
                      {(['approve', 'fix', 'retry'] as const).map((decision) => (
                        <button
                          key={decision}
                          type="button"
                          className={button}
                          disabled={
                            busy ||
                            current.editing ||
                            current.steps.some((step) => step.status === 'running')
                          }
                          onClick={() =>
                            void action(() =>
                              agentWorkflowIpc.reviewDecision(
                                current.id,
                                step.id,
                                step.finished_at!,
                                decision,
                              ),
                            )
                          }
                        >
                          {decision === 'approve'
                            ? i18n.t('Accept review & continue')
                            : decision === 'fix'
                              ? i18n.t('Add correction & review')
                              : i18n.t('Review again')}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {!current.check_commands.length && (
                  <p className="text-fg-dim mt-3 text-[11px]">
                    {i18n.t('Independent review only. No automated test commands are configured.')}
                  </p>
                )}
                {!!current.steps?.length && (
                  <div className="mt-4">
                    <AgentWorkflowBoard
                      key={current.id}
                      workflow={current}
                      sessions={sessions}
                      providerName={providerName}
                      busy={busy}
                      onStart={requestStart}
                      onOpen={open}
                      onStartReady={() => requestStart()}
                    />
                  </div>
                )}
                <details className="text-fg-dim mt-4 space-y-1 text-[11px] break-all">
                  <summary className="cursor-pointer">{i18n.t('Technical details')}</summary>
                  <p>{i18n.rich('Base: {value1}', { value1: current.base_revision })}</p>
                  <p>{i18n.rich('Worktree: {value1}', { value1: current.cwd })}</p>
                  <p>{i18n.rich('Destination: {value1}', { value1: current.target })}</p>
                  <p>
                    {i18n.rich('Reviewed tree: {value1}', {
                      value1: current.review_fingerprint ?? i18n.t('Not reviewed'),
                    })}
                  </p>
                  <p>
                    {i18n.rich('Current tree: {value1}', {
                      value1: current.current_fingerprint ?? i18n.t('Available when idle'),
                    })}
                  </p>
                  <p>
                    {i18n.rich('Progression: {value1}', {
                      value1: current.auto_progress
                        ? i18n.t('Automatic eligible tasks and checks')
                        : i18n.t('Start each step explicitly'),
                    })}
                  </p>
                </details>
                {current.error && (
                  <p role="status" className="text-warning mt-3 text-xs">
                    {workflowExecutionError(current.error)}
                  </p>
                )}
              </div>
              {!current.cleaned &&
                ['setup_ready', 'setup_failed', 'implementation_ready'].includes(current.stage) && (
                  <details className="border-fg/10 rounded-xl border p-4">
                    <summary className="cursor-pointer text-xs font-medium">
                      {i18n.t('Selected environment files')}
                    </summary>
                    <p className="text-fg-dim my-3 text-xs">
                      {i18n.t(
                        'Copy only the files you name from the original project. Paths must be project-relative, ignored by Git in this worktree and at most 1 MiB each. Their contents stay outside saved history and integration patches.',
                      )}
                    </p>
                    <Textarea
                      aria-label={i18n.t('Environment file paths')}
                      className={`${field} font-mono`}
                      rows={2}
                      value={transferPaths}
                      onChange={(e) => setTransferPaths(e.target.value)}
                      placeholder={i18n.t('.env.local\nconfig/local.env')}
                    />
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      disabled={busy || !lines(transferPaths).length}
                      onClick={() =>
                        void action(() =>
                          agentWorkflowIpc.transferFiles(current.id, lines(transferPaths)),
                        )
                      }
                    >
                      {i18n.t('Copy selected files to worktree')}
                    </button>
                  </details>
                )}
              {current.transferred_files.length > 0 && (
                <details className="border-fg/10 rounded-xl border p-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    {i18n.rich('Transferred configuration · {value1}', {
                      value1: current.transferred_files.length,
                    })}
                  </summary>
                  {current.transferred_files.map((file) => (
                    <p key={file.path} className="text-fg-dim mt-2 text-[11px] break-all">
                      {i18n.rich('{value1} · {value2} bytes · {value3}{value4}Source: {value5}', {
                        value1: file.path,
                        value2: file.size,
                        value3: new Date(file.captured_at).toLocaleString(i18n.getFormatLocale()),
                        value4: <br />,
                        value5: file.source,
                      })}
                    </p>
                  ))}
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {current.setup_commands.length > 0 &&
                  ['setup_ready', 'setup_failed', 'interrupted', 'cancelled'].includes(
                    current.stage,
                  ) && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || running}
                      onClick={() => void action(() => agentWorkflowIpc.setup(current.id))}
                    >
                      {i18n.rich('{value1} Run setup', {
                        value1: <Play className="h-3.5 w-3.5" />,
                      })}
                    </button>
                  )}
                {!current.cleaned &&
                  current.stage !== 'integrated' &&
                  !current.start_after &&
                  !current.launch_pending &&
                  !current.editing &&
                  !current.steps.some(workflowReviewNeedsDecision) &&
                  !['launch_failed', 'launch_paused'].includes(current.stage) &&
                  !['setup_ready', 'setup_failed'].includes(current.stage) &&
                  readyCount > 0 && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => requestStart()}
                    >
                      {i18n.rich('{value1} Start {readyCount} unblocked', {
                        value1: <Play className="h-3.5 w-3.5" />,
                        readyCount: readyCount,
                      })}
                    </button>
                  )}
                <button
                  type="button"
                  className={button}
                  onClick={() => open(current.implementation_session_id)}
                >
                  {i18n.t('Open implementation')}
                </button>
                {reviewId && (
                  <button type="button" className={button} onClick={() => open(reviewId)}>
                    {i18n.t('Open review')}
                  </button>
                )}
                {!running &&
                  ['checks_ready', 'checks_failed', 'ready', 'cancelled', 'interrupted'].includes(
                    current.stage,
                  ) &&
                  current.review_fingerprint && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || implementationActive || reviewActive}
                      onClick={() => void action(() => agentWorkflowIpc.checks(current.id))}
                    >
                      {i18n.rich('{value1} Run checks', {
                        value1: <Check className="h-3.5 w-3.5" />,
                      })}
                    </button>
                  )}
                {!current.launch_pending && (running || implementationActive || reviewActive) && (
                  <button
                    type="button"
                    className={`${button} text-warning`}
                    onClick={() =>
                      void agentWorkflowIpc
                        .cancel(current.id)
                        .then(refresh)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    {i18n.rich('{value1} Stop workflow', {
                      value1: <Square className="h-3.5 w-3.5" />,
                    })}
                  </button>
                )}
                {current.stage === 'integrated' && !current.cleaned && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => void action(() => agentWorkflowIpc.cleanup(current.id))}
                  >
                    {i18n.rich('{value1} Remove integrated worktree', {
                      value1: <Trash2 className="h-3.5 w-3.5" />,
                    })}
                  </button>
                )}
              </div>
              {findings.length > 0 && (
                <details open className="border-fg/10 rounded-xl border p-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    {i18n.t('Independent review findings')}
                  </summary>
                  <div className="text-fg-muted mt-3 max-h-72 overflow-auto text-xs whitespace-pre-wrap">
                    {findings.slice(-3).map((item) => (
                      <p key={item.id} className="mb-3">
                        {item.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              <Evidence title={i18n.t('Environment setup')} items={current.setup} />
              <Evidence
                title={i18n.t('Recorded validation')}
                items={current.checks}
                reviewedFingerprint={current.review_fingerprint}
                currentFingerprint={current.current_fingerprint}
              />
              {current.stage === 'ready' && (
                <div className="border-accent/25 space-y-3 rounded-xl border p-4">
                  <p className="text-fg-muted text-xs">
                    {i18n.t(
                      'Review the findings and destination diff, then apply these changes to your original project. Applying leaves the changes uncommitted for your normal Git review.',
                    )}
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => void action(() => agentWorkflowIpc.preview(current.id))}
                  >
                    {i18n.t('Preview destination and conflicts')}
                  </button>
                  {current.preview && (
                    <>
                      <p className="text-fg-dim text-xs break-all">
                        {current.preview.target} · {current.preview.target_branch} ·{' '}
                        {current.preview.target_fingerprint.slice(0, 12)}
                      </p>
                      {current.preview.conflict ? (
                        <p className="text-warning text-xs">{current.preview.conflict}</p>
                      ) : (
                        <p className="text-success text-xs">
                          {i18n.t('Patch applies cleanly to the previewed destination.')}
                        </p>
                      )}
                      <pre className="bg-fg/3 max-h-80 overflow-auto rounded-lg p-3 text-[11px]">
                        {current.preview.patch}
                      </pre>
                      <label className="text-fg-muted flex items-start gap-2 text-xs">
                        {i18n.rich(
                          '{value1}I reviewed the findings and this diff and accept applying it to the displayed destination.',
                          {
                            value1: (
                              <Checkbox
                                checked={accepted}
                                onChange={(e) => setAccepted(e.target.checked)}
                              />
                            ),
                          },
                        )}
                      </label>
                      <SearchableSelect
                        label={i18n.t('Integration destination')}
                        searchable={false}
                        className="w-full"
                        value={destination}
                        options={[
                          {
                            value: 'working_tree',
                            label: i18n.t('Apply to the working tree'),
                            description: i18n.t(
                              'Leaves the change uncommitted for you to review in Git',
                            ),
                          },
                          {
                            value: 'branch',
                            label: i18n.t('Commit on a new branch'),
                            description: i18n.t(
                              'Creates the branch in the destination and commits there',
                            ),
                          },
                        ]}
                        onChange={(value) => setDestination(value as 'working_tree' | 'branch')}
                      />
                      {destination === 'branch' && (
                        <div className="grid gap-2">
                          <label className="text-fg-muted text-xs">
                            {i18n.rich('Branch name{value1}', {
                              value1: (
                                <Input
                                  className={field}
                                  value={branchName}
                                  onChange={(e) => setBranchName(e.target.value)}
                                  placeholder={i18n.t('runhq/reviewed-change')}
                                />
                              ),
                            })}
                          </label>
                          <label className="text-fg-muted text-xs">
                            {i18n.rich('Commit message{value1}', {
                              value1: (
                                <Input
                                  className={field}
                                  value={commitMessage}
                                  onChange={(e) => setCommitMessage(e.target.value)}
                                  placeholder={current.title}
                                />
                              ),
                            })}
                          </label>
                          <p className="text-fg-dim text-[11px]">
                            {i18n.t(
                              'The destination checkout is switched to this branch. RunHQ does not push or open a pull request.',
                            )}
                          </p>
                        </div>
                      )}
                      <button
                        type="button"
                        className={`${button} bg-accent/10 text-accent`}
                        disabled={
                          busy ||
                          !accepted ||
                          !!current.preview.conflict ||
                          (destination === 'branch' &&
                            (!branchName.trim() || !commitMessage.trim()))
                        }
                        onClick={() =>
                          void action(() =>
                            agentWorkflowIpc.integrate(
                              current.id,
                              destination === 'branch'
                                ? {
                                    mode: 'branch',
                                    branch: branchName.trim(),
                                    message: commitMessage.trim(),
                                  }
                                : { mode: 'working_tree' },
                            ),
                          )
                        }
                      >
                        {destination === 'branch'
                          ? i18n.t('Commit reviewed changes on the branch')
                          : i18n.t('Apply reviewed changes')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {current.stage === 'integrated' && (
                <p className="text-success text-xs">
                  {current.integration_branch
                    ? i18n.t(
                        'Committed on {value1} in {value2}{value3}. Nothing was pushed. The workflow evidence remains available.',
                        {
                          value1: current.integration_branch,
                          value2: current.target,
                          value3: current.integration_commit
                            ? i18n.t(' as {value1}', {
                                value1: current.integration_commit.slice(0, 7),
                              })
                            : '',
                        },
                      )
                    : i18n.t(
                        'Changes were applied to {value1}. Review and commit them from the project Git view. The workflow evidence remains available.',
                        { value1: current.target },
                      )}
                </p>
              )}
              {busy && (
                <p role="status" className="text-fg-dim flex items-center gap-2 text-xs">
                  {i18n.rich('{value1} Saving or running this step…', {
                    value1: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                  })}
                </p>
              )}
            </article>
          </div>
        )}
      </div>
    </section>
  );
}
function Evidence({
  title,
  items,
  reviewedFingerprint,
  currentFingerprint,
}: {
  title: string;
  items: WorkflowCheck[];
  reviewedFingerprint?: string | null;
  currentFingerprint?: string | null;
}) {
  i18n.useLocale();
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-fg-muted text-xs font-medium">{title}</h4>
      {items.map((item, index) => (
        <details key={`${item.started_at}-${index}`} className="border-fg/10 rounded-lg border p-3">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
            <span className={item.status === 'passed' ? 'text-success' : 'text-warning'}>
              {item.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                item.status
              )}
            </span>
            <code className="min-w-0 flex-1 break-all">{item.command}</code>
            <span className="text-fg-dim">
              {i18n.rich('exit {value1}', { value1: item.exit_code ?? '—' })}
            </span>
            {reviewedFingerprint &&
              (item.fingerprint !== reviewedFingerprint ||
                item.fingerprint !== currentFingerprint) && (
                <span className="text-warning">{i18n.t('stale')}</span>
              )}
          </summary>
          <p className="text-fg-dim mt-2 text-[10px] break-all">
            {i18n.rich('{value1} · {value2} · tree {value3}', {
              value1: item.cwd,
              value2: new Date(item.started_at).toLocaleString(i18n.getFormatLocale()),
              value3: item.fingerprint.slice(0, 12),
            })}
          </p>
          <pre className="text-fg-muted mt-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap">
            {item.output || 'Waiting for the command to finish…'}
          </pre>
        </details>
      ))}
    </div>
  );
}
