import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState, type ElementRef } from 'react';
import {
  BookOpen,
  Download,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  CalendarClock,
} from 'lucide-react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentStore } from '@/store/useAgentStore';
import { agentWorkspaceIpc } from '@/lib/ipc/agentWorkspaceIpc';
import { AgentHistoryRetention } from './AgentHistoryRetention';
import { useAgentProjectOptions } from './useAgentProjectOptions';
import {
  describeCadence,
  nextScheduledRun,
  parseSchedule,
  type AgentCadence,
  type AgentSchedule,
} from './agentSchedule';
import { AgentWorkflowTasks } from './AgentWorkflowTasks';
import { createStepsToRecipeSteps, recipeStepsToCreateSteps } from './agentWorkflowRecipeBridge';
import { workflowTasksInExecutionOrder } from './agentWorkflowGraph';
import { newWorkflowStep } from './agentWorkflowStepPolicy';
import {
  isPoolTarget,
  parseAccountPool,
  poolTarget,
  type AgentAccountPool,
} from './agentAccountRouting';
import {
  downloadAgentJson,
  parseRecipe,
  portableAgentRecipe,
  recipeParameters,
  resolveRecipe,
  type AgentHistoryHit,
  type AgentMemory,
  type AgentRecipe,
} from './agentLibraryModel';

const field = 'border-border bg-surface text-fg w-full rounded-lg border px-3 py-2 text-[12px]';
const button =
  'border-border text-fg-muted hover:bg-fg/5 hover:text-fg flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] disabled:opacity-40';
const newRecipe = (): AgentRecipe => ({
  id: crypto.randomUUID(),
  name: '',
  prompt: '',
  backend: '',
  model: '',
  effort: '',
  agent: '',
  mode: 'default',
  isolated: true,
  acceptance: '',
  setupCommands: '',
  checkCommands: '',
  version: 1,
});
const starterRecipes: AgentRecipe[] = [
  {
    get name() {
      return i18n.t('Implement and review');
    },
    prompt: 'Implement {{objective}}. Keep the change focused and explain the result.',
    acceptance: '{{acceptance}}',
    checkCommands: '{{check_command}}',
  },
  {
    get name() {
      return i18n.t('Reproduce and fix a bug');
    },
    prompt:
      'Reproduce this bug: {{bug}}. Identify the cause, implement a focused fix and check for regressions.',
    acceptance: 'Demonstrate the original failure and the passing regression check.',
    checkCommands: '{{check_command}}',
  },
  {
    get name() {
      return i18n.t('Dependency update');
    },
    prompt:
      'Update {{dependency}} to {{version}}. Inspect breaking changes and migrate affected usage.',
    acceptance: 'Explain compatibility changes and validate affected behavior.',
    checkCommands: '{{check_command}}',
  },
  {
    get name() {
      return i18n.t('Release preparation');
    },
    prompt:
      'Prepare {{release}}: inspect changes, update release notes and report remaining blockers.',
    acceptance:
      'Release notes match the changes and required checks pass. Publishing remains a separate user action.',
    checkCommands: '{{check_command}}',
  },
].map((recipe, index) => ({ ...newRecipe(), ...recipe, id: `starter-${index}`, version: 1 }));

function LibraryDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  i18n.useLocale();
  const dialog = useRef<ElementRef<'dialog'>>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[94vh] w-[min(95vw,44rem)] max-w-none bg-transparent p-0 backdrop:bg-black/60"
    >
      {children}
    </dialog>
  );
}

export function AgentLibrary({
  projectId,
  onOpenSession,
  onRecipe,
  onWorkflow,
}: {
  projectId?: string;
  onOpenSession: (id: string, itemId?: string) => void;
  onRecipe: (recipe: AgentRecipe) => void;
  onWorkflow: (recipe: AgentRecipe) => void;
}) {
  i18n.useLocale();
  const { records, ready, error: storeError } = useAgentLibraryStore();
  const projects = useAgentStore((s) => s.projects);
  const projectOptions = useAgentProjectOptions(projects);
  const tools = useAgentStore((s) => s.tools);
  const [section, setSection] = useState<'recipes' | 'history' | 'memory'>('recipes');
  const [scope, setScope] = useState(projectId || '');
  const [query, setQuery] = useState('');
  const [backend, setBackend] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [hits, setHits] = useState<AgentHistoryHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [editor, setEditor] = useState<AgentRecipe | null>(null);
  const [queueEditing, setQueueEditing] = useState(false);
  const [memoryEditor, setMemoryEditor] = useState<AgentMemory | null>(null);
  const [scheduleEditor, setScheduleEditor] = useState<AgentSchedule | null>(null);
  const accountPools = useMemo(() => {
    const parsed: AgentAccountPool[] = [];
    for (const [key, record] of Object.entries(records)) {
      if (!key.startsWith('pool:')) continue;
      try {
        parsed.push(parseAccountPool(record.value));
      } catch {
        // An unreadable record is skipped rather than offered as an empty target.
      }
    }
    return parsed.sort((left, right) => left.name.localeCompare(right.name));
  }, [records]);
  /** A recipe stores either a connection id or a pool target; both have to read as themselves. */
  const describeTarget = (target: string) => {
    if (!target) return i18n.t('Choose an agent');
    if (!isPoolTarget(target)) return tools.find((tool) => tool.id === target)?.name ?? target;
    const pool = accountPools.find((entry) => poolTarget(entry.id) === target);
    return pool ? i18n.t('{value1} (pool)', { value1: pool.name }) : i18n.t('Pool was removed');
  };
  const producers = tools.filter(
    (tool) => tool.enabled !== false && tool.available && tool.adapter !== 'terminal',
  );
  // Only a connection with a real read-only mode can hold a reviewing role.
  const reviewTools = producers.filter((tool) =>
    ['codex', 'claude'].includes(tool.adapter ?? tool.id),
  );
  const workflowPoolOptions = accountPools.map((pool) => ({
    value: poolTarget(pool.id),
    label: i18n.t('{value1} (pool)', { value1: pool.name }),
    description: i18n.t('RunHQ picks a free account when the step starts'),
  }));
  const scheduleFor = (recipeId: string) => {
    const stored = records[`schedule:${recipeId}`];
    if (!stored) return null;
    try {
      return parseSchedule(stored.value);
    } catch {
      return null;
    }
  };
  const [launch, setLaunch] = useState<{ recipe: AgentRecipe; workflow: boolean } | null>(null);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const importRecipes = useRef<HTMLInputElement>(null);
  const importHistory = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  useEffect(() => {
    if (!ready) void useAgentLibraryStore.getState().refresh();
  }, [ready]);
  useEffect(() => {
    setScope(projectId || '');
  }, [projectId]);
  useEffect(() => {
    searchGeneration.current++;
    setHits([]);
    setSearched(false);
  }, [scope, backend, status, query, fromDate, toDate]);
  const savedRecipes = Object.values(records)
    .filter((r) => r.key.startsWith('recipe:'))
    .flatMap((r) => {
      try {
        return [parseRecipe(r.value)];
      } catch {
        return [];
      }
    });
  const recipes = [
    ...savedRecipes,
    ...starterRecipes.filter((recipe) => !savedRecipes.some((saved) => saved.id === recipe.id)),
  ].filter((recipe) => !scope || !recipe.projectId || recipe.projectId === scope);
  const memories = Object.values(records)
    .filter((r) => r.key.startsWith('memory:'))
    .map((r) => r.value as AgentMemory)
    .filter((m) => !scope || m.projectId === scope);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const search = async (more = false) => {
    const generation = ++searchGeneration.current;
    await action(async () => {
      const found = await agentWorkspaceIpc.search({
        query,
        project_id: scope,
        backend,
        status,
        before: more ? hits.at(-1)?.sequence : undefined,
        from_date: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
        to_date: toDate
          ? new Date(`${toDate}T00:00:00`).setDate(new Date(`${toDate}T00:00:00`).getDate() + 1)
          : undefined,
      });
      if (generation === searchGeneration.current) {
        setHits((old) => (more ? [...old, ...found] : found));
        setSearched(true);
      }
    });
  };
  const start = (recipe: AgentRecipe, workflow: boolean) => {
    const params = recipeParameters(recipe);
    if (params.length) {
      setParameters({});
      setLaunch({ recipe, workflow });
    } else (workflow ? onWorkflow : onRecipe)(recipe);
  };
  const pin = (hit: AgentHistoryHit) =>
    setMemoryEditor({
      id: crypto.randomUUID(),
      projectId: hit.session.project_id,
      title: hit.item.title || hit.session.title,
      content: hit.item.text,
      sourceSessionId: hit.session.id,
      sourceItemId: hit.item.id,
      capturedAt: Date.now(),
    });
  return (
    <section
      className="overlay-scroll min-h-0 flex-1 overflow-auto p-5"
      aria-label={i18n.t('Agent library')}
    >
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <BookOpen className="text-accent h-5 w-5" />
        <div className="flex-1">
          <h2 className="text-fg text-[16px] font-semibold">{i18n.t('Your agent library')}</h2>
          <p className="text-fg-dim mt-1 text-[12px]">
            {i18n.t('Repeat useful work. Find a decision. Keep its source.')}
          </p>
        </div>
        <SearchableSelect
          label={i18n.t('Library project')}
          indentGrouped
          className="w-60 max-w-full"
          value={scope}
          disabled={!!projectId}
          options={[{ value: '', label: i18n.t('All projects') }, ...projectOptions]}
          onChange={setScope}
          searchPlaceholder={i18n.t('Find a project or group…')}
        />
      </header>
      <nav
        className="border-border mb-4 flex gap-2 border-b pb-3"
        aria-label={i18n.t('Library sections')}
      >
        {(['recipes', 'history', 'memory'] as const).map((value) => (
          <button
            className={`${button} ${section === value ? 'bg-fg/7 text-fg' : ''}`}
            aria-pressed={section === value}
            key={value}
            onClick={() => setSection(value)}
          >
            {value === 'memory'
              ? i18n.t('Project decisions')
              : value === 'recipes'
                ? i18n.t('Task recipes')
                : i18n.t('History search')}
          </button>
        ))}
      </nav>
      {(error || storeError) && (
        <p role="alert" className="text-status-error mb-4 text-[12px]">
          {error || storeError}
          <button
            onClick={() => void useAgentLibraryStore.getState().refresh()}
            className="ml-2 underline"
          >
            {i18n.t('Retry loading')}
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="text-status-running mb-4 text-[12px]">
          {notice}
        </p>
      )}
      {section === 'recipes' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() => setEditor({ ...newRecipe(), projectId: scope || undefined })}
            >
              {i18n.rich('{value1}New recipe', { value1: <Plus className="h-3.5 w-3.5" /> })}
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => importRecipes.current?.click()}
            >
              {i18n.rich('{value1}Import', { value1: <Upload className="h-3.5 w-3.5" /> })}
            </button>
            <button
              className={button}
              onClick={() =>
                downloadAgentJson('runhq-recipes.json', {
                  version: 1,
                  recipes: recipes.map(portableAgentRecipe),
                })
              }
            >
              {i18n.rich('{value1}Export recipes', {
                value1: <Download className="h-3.5 w-3.5" />,
              })}
            </button>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            ref={importRecipes}
            className="hidden"
            aria-label={i18n.t('Import agent recipes')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void action(async () => {
                  if (file.size > 1024 * 1024) throw new Error(i18n.t('Recipe file exceeds 1 MiB'));
                  const data = JSON.parse(await file.text());
                  if (
                    data.version !== 1 ||
                    !Array.isArray(data.recipes) ||
                    data.recipes.length > 100
                  )
                    throw new Error(i18n.t('Unsupported recipe file'));
                  const imported = data.recipes.map(portableAgentRecipe);
                  for (const recipe of imported) {
                    const id = crypto.randomUUID();
                    await useAgentLibraryStore
                      .getState()
                      .save(`recipe:${id}`, { ...recipe, id, projectId: scope || undefined });
                  }
                  setNotice(
                    i18n.t('Imported {value1} recipes. Review settings before launching.', {
                      value1: imported.length,
                    }),
                  );
                });
            }}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {recipes.map((recipe) => (
              <article key={recipe.id} className="border-border rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-fg flex-1 text-[14px] font-medium">{recipe.name}</h3>
                  <span className="text-fg-dim text-[10px]">v{recipe.version}</span>
                </div>
                <p className="text-fg-muted mt-2 line-clamp-3 text-[12px] whitespace-pre-wrap">
                  {recipe.prompt}
                </p>
                <p className="text-fg-dim mt-3 text-[11px]">
                  {describeTarget(recipe.backend)} · {recipe.model || i18n.t('Agent default')} ·{' '}
                  {recipe.isolated ? i18n.t('Worktree') : i18n.t('Local')}
                </p>
                {(() => {
                  const scheduled = scheduleFor(recipe.id);
                  if (!scheduled) return null;
                  return (
                    <p className="text-fg-dim mt-1 text-[11px]">
                      {describeCadence(scheduled.cadence)}
                      {scheduled.enabled
                        ? i18n.t(' · next {value1}', {
                            value1: new Date(
                              nextScheduledRun(
                                scheduled.cadence,
                                scheduled.lastRunAt ?? Date.now(),
                              ),
                            ).toLocaleString(i18n.getFormatLocale()),
                          })
                        : i18n.t(' · paused')}
                      {scheduled.lastOutcome
                        ? i18n.t(' · last: {value1}', { value1: scheduled.lastOutcome })
                        : ''}
                    </p>
                  );
                })()}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={button} onClick={() => start(recipe, false)}>
                    {i18n.rich('{value1}Draft task', { value1: <Play className="h-3 w-3" /> })}
                  </button>
                  <button className={button} onClick={() => start(recipe, true)}>
                    {i18n.t('Create workflow')}
                  </button>
                  <button className={button} onClick={() => setEditor({ ...recipe })}>
                    {i18n.t('Edit')}
                  </button>
                  <button
                    className={button}
                    onClick={() =>
                      setScheduleEditor(
                        scheduleFor(recipe.id) ?? {
                          id: crypto.randomUUID(),
                          recipeId: recipe.id,
                          projectId: recipe.projectId || scope || projects[0]?.id || '',
                          cadence: { kind: 'daily', time: '09:00' },
                          enabled: true,
                        },
                      )
                    }
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    {scheduleFor(recipe.id) ? i18n.t('Schedule…') : i18n.t('Schedule')}
                  </button>
                  <button
                    aria-label={i18n.t('Delete recipe {value1}', { value1: recipe.name })}
                    className={button}
                    disabled={busy || !records[`recipe:${recipe.id}`]}
                    onClick={() =>
                      void action(() =>
                        useAgentLibraryStore.getState().save(`recipe:${recipe.id}`, null),
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!recipes.length && (
            <p className="text-fg-dim py-10 text-center text-[13px]">
              {i18n.rich(
                'Save your recurring tasks with a provider, workspace and checks. Use {value1} for parameters.',
                { value1: '{{variable}}' },
              )}
            </p>
          )}
        </>
      )}
      {section === 'history' && (
        <>
          <form
            className="mb-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              className={`${field} min-w-48 flex-1`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={i18n.t('Search prompts, answers and decisions…')}
              aria-label={i18n.t('Search conversation content')}
            />
            <SearchableSelect
              label={i18n.t('History provider')}
              searchable={false}
              className="w-40 max-w-full"
              menuWidth={220}
              value={backend}
              options={[
                { value: '', label: i18n.t('All providers') },
                ...tools.map((t) => ({ value: t.id, label: t.name })),
              ]}
              onChange={setBackend}
            />
            <SearchableSelect
              label={i18n.t('History status')}
              searchable={false}
              className="w-40 max-w-full"
              menuWidth={220}
              value={status}
              options={[
                { value: '', label: i18n.t('All statuses') },
                ...['completed', 'failed', 'interrupted', 'running'].map((s) => ({
                  value: s,
                  label: s,
                })),
              ]}
              onChange={setStatus}
            />
            <button type="submit" className={button} disabled={busy || !query.trim()}>
              {i18n.rich('{value1}Search', { value1: <Search className="h-3.5 w-3.5" /> })}
            </button>
            <div className="text-fg-muted flex w-full flex-wrap gap-3 text-[11px]">
              <label>
                {i18n.rich('From {value1}', {
                  value1: (
                    <input
                      type="date"
                      aria-label={i18n.t('History from date')}
                      className={`${field} mt-1`}
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  ),
                })}
              </label>
              <label>
                {i18n.rich('Through {value1}', {
                  value1: (
                    <input
                      type="date"
                      aria-label={i18n.t('History through date')}
                      className={`${field} mt-1`}
                      value={toDate}
                      min={fromDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  ),
                })}
              </label>
            </div>
          </form>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  downloadAgentJson(
                    'runhq-agent-history.json',
                    await agentWorkspaceIpc.exportHistory(scope),
                  );
                })
              }
            >
              {i18n.rich('{value1}Export {value2} history', {
                value1: <Download className="h-3.5 w-3.5" />,
                value2: scope ? i18n.t('project') : i18n.t('all'),
              })}
            </button>
            <button
              className={button}
              disabled={busy || !scope}
              title={
                scope
                  ? i18n.t('Import as archived, read-only conversations')
                  : i18n.t('Choose a destination project first')
              }
              onClick={() => importHistory.current?.click()}
            >
              {i18n.rich('{value1}Import history', { value1: <Upload className="h-3.5 w-3.5" /> })}
            </button>
            <span className="text-fg-dim text-[11px]">
              {i18n.t('Imported history is archived; it cannot resume a provider session.')}
            </span>
          </div>
          <AgentHistoryRetention key={scope} projectId={scope} />
          <input
            type="file"
            accept="application/json,.json"
            ref={importHistory}
            className="hidden"
            aria-label={i18n.t('Import agent history')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void action(async () => {
                  if (!scope) throw new Error(i18n.t('Choose the destination project'));
                  if (file.size > 32 * 1024 * 1024)
                    throw new Error(i18n.t('History archive exceeds 32 MiB'));
                  const count = await agentWorkspaceIpc.importHistory(
                    scope,
                    JSON.parse(await file.text()),
                  );
                  await useAgentStore.getState().refresh();
                  setNotice(i18n.t('Imported {count} archived conversations.', { count: count }));
                });
            }}
          />
          <div className="space-y-3">
            {hits.map((hit) => (
              <article key={hit.sequence} className="border-border rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="text-fg flex-1 text-left text-[13px] font-medium hover:underline"
                    onClick={() => onOpenSession(hit.session.id, hit.item.id)}
                  >
                    {hit.session.title}
                  </button>
                  <span className="text-fg-dim text-[11px]">
                    {hit.session.project_name} · {hit.session.backend} ·{' '}
                    {new Date(hit.item.created_at).toLocaleDateString(i18n.getFormatLocale())}
                  </span>
                </div>
                <details className="text-fg-muted mt-2 text-[12px]">
                  <summary className="line-clamp-3 cursor-pointer whitespace-pre-wrap">
                    {hit.item.text.slice(
                      Math.max(0, hit.item.text.toLowerCase().indexOf(query.toLowerCase()) - 100),
                      Math.max(0, hit.item.text.toLowerCase().indexOf(query.toLowerCase()) - 100) +
                        400,
                    )}
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">
                    {hit.item.text}
                  </pre>
                </details>
                <button className="text-accent mt-3 text-[11px]" onClick={() => pin(hit)}>
                  {i18n.t('Save as project decision')}
                </button>
              </article>
            ))}
          </div>
          {searched && !hits.length && (
            <p className="text-fg-dim py-10 text-center text-[13px]">
              {i18n.t('No matching conversation content.')}
            </p>
          )}
          {hits.length > 0 && hits.length % 50 === 0 && (
            <button
              disabled={busy}
              className={`${button} mx-auto mt-4`}
              onClick={() => void search(true)}
            >
              {i18n.t('Load older matches')}
            </button>
          )}
        </>
      )}
      {section === 'memory' && (
        <>
          <button
            className={`${button} mb-4`}
            disabled={!scope}
            title={!scope ? i18n.t('Choose a project first') : undefined}
            onClick={() =>
              setMemoryEditor({
                id: crypto.randomUUID(),
                projectId: scope,
                title: '',
                content: '',
                capturedAt: Date.now(),
              })
            }
          >
            {i18n.rich('{value1}New project decision', {
              value1: <Plus className="h-3.5 w-3.5" />,
            })}
          </button>
          <div className="space-y-3">
            {memories.map((m) => (
              <article key={m.id} className="border-border rounded-lg border p-4">
                <h3 className="text-fg text-[14px] font-medium">{m.title}</h3>
                <p className="text-fg-muted mt-2 text-[12px] whitespace-pre-wrap">{m.content}</p>
                <p className="text-fg-dim mt-2 text-[10px]">
                  {projects.find((p) => p.id === m.projectId)?.name} ·{' '}
                  {new Date(m.capturedAt).toLocaleDateString(i18n.getFormatLocale())}
                </p>
                <div className="mt-3 flex gap-3 text-[11px]">
                  {m.sourceSessionId && (
                    <button
                      className="text-accent"
                      onClick={() => onOpenSession(m.sourceSessionId!, m.sourceItemId)}
                    >
                      {i18n.t('Source conversation')}
                    </button>
                  )}
                  <button className="text-fg-muted" onClick={() => setMemoryEditor({ ...m })}>
                    {i18n.t('Edit')}
                  </button>
                  <button
                    className="text-status-error"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        useAgentLibraryStore.getState().save(`memory:${m.id}`, null),
                      )
                    }
                  >
                    {i18n.t('Remove')}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!memories.length && (
            <p className="text-fg-dim py-10 text-center text-[13px]">
              {i18n.t(
                'Pin useful results from history search, or write a project decision. Add it to a task from Context.',
              )}
            </p>
          )}
        </>
      )}
      {editor && (
        <LibraryDialog title={i18n.t('Edit task recipe')} onClose={() => setEditor(null)}>
          <form
            aria-label={i18n.t('Edit task recipe')}
            className="border-border bg-surface-raised overlay-scroll max-h-[90vh] w-full max-w-2xl space-y-3 overflow-auto rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (queueEditing) return;
              void action(async () => {
                const recipe = parseRecipe({
                  ...editor,
                  workflowSteps: editor.workflowSteps
                    ? createStepsToRecipeSteps(
                        workflowTasksInExecutionOrder(
                          recipeStepsToCreateSteps(editor.workflowSteps),
                        ),
                      )
                    : undefined,
                });
                await useAgentLibraryStore.getState().save(`recipe:${recipe.id}`, {
                  ...recipe,
                  version: records[`recipe:${recipe.id}`] ? recipe.version + 1 : recipe.version,
                });
                setEditor(null);
              });
            }}
          >
            <h3 className="text-fg font-medium">{i18n.t('Task recipe')}</h3>
            {(['name', 'prompt', 'acceptance', 'setupCommands', 'checkCommands'] as const).map(
              (key) => (
                <label key={key} className="text-fg-muted block space-y-1 text-[12px]">
                  <span>
                    {
                      {
                        name: i18n.t('Name'),
                        prompt: i18n.t('Prompt · supports {{parameters}}'),
                        acceptance: i18n.t('Acceptance criteria'),
                        setupCommands: i18n.t('Setup commands · one per line, used by workflows'),
                        checkCommands: i18n.t('Check commands · one per line, used by workflows'),
                      }[key]
                    }
                  </span>
                  {key === 'name' ? (
                    <input
                      required
                      className={field}
                      value={editor[key]}
                      onChange={(e) => setEditor({ ...editor, [key]: e.target.value })}
                    />
                  ) : (
                    <textarea
                      required={key === 'prompt'}
                      rows={key === 'prompt' ? 4 : 2}
                      className={field}
                      value={editor[key]}
                      onChange={(e) => setEditor({ ...editor, [key]: e.target.value })}
                    />
                  )}
                </label>
              ),
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-fg-muted text-[12px]">
                {i18n.rich('Project scope{value1}', {
                  value1: (
                    <SearchableSelect
                      label={i18n.t('Recipe project scope')}
                      indentGrouped
                      className="mt-1"
                      value={editor.projectId || ''}
                      options={[{ value: '', label: i18n.t('All projects') }, ...projectOptions]}
                      onChange={(value) => setEditor({ ...editor, projectId: value || undefined })}
                      searchPlaceholder={i18n.t('Find a project or group…')}
                    />
                  ),
                })}
              </label>
              <label className="text-fg-muted text-[12px]">
                {i18n.rich('Provider{value1}', {
                  value1: (
                    <SearchableSelect
                      label={i18n.t('Recipe provider')}
                      searchable={false}
                      className="mt-1"
                      value={editor.backend}
                      options={[
                        { value: '', label: i18n.t('Choose at launch') },
                        ...tools.map((t) => ({ value: t.id, label: t.name })),
                        // A pool lets a scheduled run pick a free account instead of waiting on one.
                        ...accountPools.map((pool) => ({
                          value: poolTarget(pool.id),
                          label: i18n.t('{value1} (pool)', { value1: pool.name }),
                        })),
                      ]}
                      onChange={(value) => setEditor({ ...editor, backend: value })}
                    />
                  ),
                })}
              </label>
              {(['model', 'effort', 'agent'] as const).map((key) => (
                <label key={key} className="text-fg-muted text-[12px]">
                  {key}
                  <input
                    className={field}
                    placeholder={i18n.t('Agent default')}
                    value={editor[key]}
                    onChange={(e) => setEditor({ ...editor, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="text-fg-muted text-[12px]">
                {i18n.rich('Mode{value1}', {
                  value1: (
                    <SearchableSelect
                      label={i18n.t('Recipe mode')}
                      searchable={false}
                      className="mt-1"
                      menuWidth={200}
                      value={editor.mode}
                      options={[
                        { value: 'default', label: i18n.t('Agent') },
                        { value: 'plan', label: i18n.t('Plan') },
                      ]}
                      onChange={(value) =>
                        setEditor({ ...editor, mode: value as 'default' | 'plan' })
                      }
                    />
                  ),
                })}
              </label>
              <label className="text-fg-muted flex items-center gap-2 text-[12px]">
                {i18n.rich('{value1}Isolated worktree', {
                  value1: (
                    <input
                      type="checkbox"
                      checked={editor.isolated}
                      onChange={(e) => setEditor({ ...editor, isolated: e.target.checked })}
                    />
                  ),
                })}
              </label>
            </div>
            <details className="border-border rounded-xl border p-3">
              <summary className="text-fg-muted cursor-pointer text-[12px]">
                {i18n.rich('Workflow steps &middot; {value1}', {
                  value1: editor.workflowSteps?.length
                    ? i18n.t('{value1} saved', { value1: editor.workflowSteps.length })
                    : i18n.t('this recipe implements and reviews'),
                })}
              </summary>
              <p className="text-fg-dim mt-2 text-[11px] leading-relaxed">
                {i18n.t(
                  'Used only when this recipe creates a workflow. Leave it empty to keep the agent above implementing and reviewing; add steps to save a division of labour that repeats across projects.',
                )}
              </p>
              {editor.workflowSteps?.length ? (
                <div className="mt-3">
                  <AgentWorkflowTasks
                    projectId={editor.projectId || scope || projects[0]?.id || ''}
                    steps={recipeStepsToCreateSteps(editor.workflowSteps)}
                    onQueueEditingChange={setQueueEditing}
                    onChange={(steps) =>
                      setEditor({ ...editor, workflowSteps: createStepsToRecipeSteps(steps) })
                    }
                    producers={producers}
                    reviewers={reviewTools}
                    poolOptions={workflowPoolOptions}
                    // A recipe is stored, not run, so a pool stays a pool here: the account is
                    // chosen when a step actually starts.
                    resolveTarget={(target) => target}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`${button} mt-3`}
                  onClick={() =>
                    setEditor({
                      ...editor,
                      workflowSteps: createStepsToRecipeSteps([
                        newWorkflowStep(
                          'implement',
                          editor.backend || producers[0]?.id || '',
                          'implement',
                        ),
                        newWorkflowStep('review', reviewTools[0]?.id ?? '', 'review', [
                          'implement',
                        ]),
                      ]),
                    })
                  }
                >
                  {i18n.t('Add workflow steps')}
                </button>
              )}
            </details>
            {error && (
              <p role="alert" className="text-status-error text-[12px]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setEditor(null)}>
                {i18n.t('Cancel')}
              </button>
              <button className={button} disabled={busy || queueEditing}>
                {i18n.t('Save recipe')}
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {memoryEditor && (
        <LibraryDialog title={i18n.t('Project decision')} onClose={() => setMemoryEditor(null)}>
          <form
            aria-label={i18n.t('Project decision')}
            className="border-border bg-surface-raised w-full max-w-2xl space-y-3 rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await useAgentLibraryStore
                  .getState()
                  .save(`memory:${memoryEditor.id}`, { ...memoryEditor, capturedAt: Date.now() });
                setMemoryEditor(null);
                setNotice(i18n.t('Project decision saved.'));
              });
            }}
          >
            <h3 className="text-fg font-medium">{i18n.t('Project decision')}</h3>
            <input
              className={field}
              required
              aria-label={i18n.t('Decision title')}
              value={memoryEditor.title}
              onChange={(e) => setMemoryEditor({ ...memoryEditor, title: e.target.value })}
            />
            <textarea
              className={`${field} max-h-[60vh]`}
              required
              rows={12}
              aria-label={i18n.t('Decision content')}
              value={memoryEditor.content}
              onChange={(e) => setMemoryEditor({ ...memoryEditor, content: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setMemoryEditor(null)}>
                {i18n.t('Cancel')}
              </button>
              <button className={button} disabled={busy}>
                {i18n.t('Save decision')}
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {scheduleEditor && (
        <LibraryDialog title={i18n.t('Schedule')} onClose={() => setScheduleEditor(null)}>
          <form
            aria-label={i18n.t('Recipe schedule')}
            className="border-border bg-surface-raised w-full max-w-lg space-y-3 rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await useAgentLibraryStore
                  .getState()
                  .save(`schedule:${scheduleEditor.recipeId}`, parseSchedule(scheduleEditor));
                setScheduleEditor(null);
                setNotice(i18n.t('Schedule saved.'));
              });
            }}
          >
            <h3 className="text-fg font-medium">{i18n.t('Run this recipe on a schedule')}</h3>
            <SearchableSelect
              label={i18n.t('Schedule project')}
              indentGrouped
              value={scheduleEditor.projectId}
              options={projectOptions}
              onChange={(value) => setScheduleEditor({ ...scheduleEditor, projectId: value })}
              searchPlaceholder={i18n.t('Find a project or group…')}
            />
            <SearchableSelect
              label={i18n.t('How often')}
              searchable={false}
              value={scheduleEditor.cadence.kind}
              options={[
                { value: 'daily', label: i18n.t('Every day') },
                { value: 'weekly', label: i18n.t('Every week') },
                { value: 'interval', label: i18n.t('Every few hours') },
              ]}
              onChange={(value) =>
                setScheduleEditor({
                  ...scheduleEditor,
                  cadence:
                    value === 'interval'
                      ? { kind: 'interval', hours: 6 }
                      : value === 'weekly'
                        ? { kind: 'weekly', day: 1, time: '09:00' }
                        : { kind: 'daily', time: '09:00' },
                })
              }
            />
            {scheduleEditor.cadence.kind === 'interval' ? (
              <label className="text-fg-muted text-[12px]">
                {i18n.rich('Hours between runs{value1}', {
                  value1: (
                    <input
                      className={field}
                      type="number"
                      min={1}
                      max={336}
                      value={scheduleEditor.cadence.hours}
                      onChange={(e) =>
                        setScheduleEditor({
                          ...scheduleEditor,
                          cadence: { kind: 'interval', hours: Number(e.target.value) },
                        })
                      }
                    />
                  ),
                })}
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {scheduleEditor.cadence.kind === 'weekly' && (
                  <SearchableSelect
                    label={i18n.t('Weekday')}
                    searchable={false}
                    value={String(scheduleEditor.cadence.day)}
                    options={[
                      i18n.t('Sunday'),
                      i18n.t('Monday'),
                      i18n.t('Tuesday'),
                      i18n.t('Wednesday'),
                      i18n.t('Thursday'),
                      i18n.t('Friday'),
                      i18n.t('Saturday'),
                    ].map((label, value) => ({ value: String(value), label }))}
                    onChange={(value) =>
                      setScheduleEditor({
                        ...scheduleEditor,
                        cadence: {
                          kind: 'weekly',
                          day: Number(value),
                          time: (scheduleEditor.cadence as Extract<AgentCadence, { time: string }>)
                            .time,
                        },
                      })
                    }
                  />
                )}
                <label className="text-fg-muted text-[12px]">
                  {i18n.rich('Time{value1}', {
                    value1: (
                      <input
                        className={field}
                        type="time"
                        value={
                          (scheduleEditor.cadence as Extract<AgentCadence, { time: string }>).time
                        }
                        onChange={(e) =>
                          setScheduleEditor({
                            ...scheduleEditor,
                            cadence: {
                              ...scheduleEditor.cadence,
                              time: e.target.value,
                            } as AgentCadence,
                          })
                        }
                      />
                    ),
                  })}
                </label>
              </div>
            )}
            <label className="text-fg-muted flex items-center gap-2 text-[12px]">
              {i18n.rich('{value1}Enabled', {
                value1: (
                  <input
                    type="checkbox"
                    checked={scheduleEditor.enabled}
                    onChange={(e) =>
                      setScheduleEditor({ ...scheduleEditor, enabled: e.target.checked })
                    }
                  />
                ),
              })}
            </label>
            <p className="text-fg-dim text-[11px] leading-relaxed">
              {i18n.t(
                'Scheduled runs start the recipe as a new task while RunHQ is running. Nothing runs while RunHQ is closed; occurrences missed in the meantime are reported and started once, not replayed. A run waits when the tool is disabled or its execution slots are full.',
              )}
            </p>
            <div className="flex justify-end gap-2">
              {records[`schedule:${scheduleEditor.recipeId}`] && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await useAgentLibraryStore
                        .getState()
                        .save(`schedule:${scheduleEditor.recipeId}`, null);
                      setScheduleEditor(null);
                      setNotice(i18n.t('Schedule removed.'));
                    })
                  }
                >
                  {i18n.t('Remove schedule')}
                </button>
              )}
              <button type="button" className={button} onClick={() => setScheduleEditor(null)}>
                {i18n.t('Cancel')}
              </button>
              <button className={button} disabled={busy || !scheduleEditor.projectId}>
                {i18n.t('Save schedule')}
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {launch && (
        <LibraryDialog title={i18n.t('Recipe parameters')} onClose={() => setLaunch(null)}>
          <form
            aria-label={i18n.t('Recipe parameters')}
            className="border-border bg-surface-raised w-full max-w-lg space-y-3 rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const recipe = resolveRecipe(launch.recipe, parameters);
                (launch.workflow ? onWorkflow : onRecipe)(recipe);
                setLaunch(null);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <h3 className="text-fg font-medium">{launch.recipe.name}</h3>
            {recipeParameters(launch.recipe).map((key) => (
              <label key={key} className="text-fg-muted block text-[12px]">
                {key}
                <input
                  className={field}
                  required
                  value={parameters[key] || ''}
                  onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
                />
              </label>
            ))}
            <p className="text-fg-dim text-[11px]">
              {i18n.t('Review the resolved task settings before starting.')}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setLaunch(null)}>
                {i18n.t('Cancel')}
              </button>
              <button className={button}>{i18n.t('Use recipe')}</button>
            </div>
          </form>
        </LibraryDialog>
      )}
    </section>
  );
}
