import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
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
    name: 'Implement and review',
    prompt: 'Implement {{objective}}. Keep the change focused and explain the result.',
    acceptance: '{{acceptance}}',
    checkCommands: '{{check_command}}',
  },
  {
    name: 'Reproduce and fix a bug',
    prompt:
      'Reproduce this bug: {{bug}}. Identify the cause, implement a focused fix and check for regressions.',
    acceptance: 'Demonstrate the original failure and the passing regression check.',
    checkCommands: '{{check_command}}',
  },
  {
    name: 'Dependency update',
    prompt:
      'Update {{dependency}} to {{version}}. Inspect breaking changes and migrate affected usage.',
    acceptance: 'Explain compatibility changes and validate affected behavior.',
    checkCommands: '{{check_command}}',
  },
  {
    name: 'Release preparation',
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
    if (!target) return 'Choose an agent';
    if (!isPoolTarget(target)) return tools.find((tool) => tool.id === target)?.name ?? target;
    const pool = accountPools.find((entry) => poolTarget(entry.id) === target);
    return pool ? `${pool.name} (pool)` : 'Pool was removed';
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
    label: `${pool.name} (pool)`,
    description: 'RunHQ picks a free account when the step starts',
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
    <section className="overlay-scroll min-h-0 flex-1 overflow-auto p-5" aria-label="Agent library">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <BookOpen className="text-accent h-5 w-5" />
        <div className="flex-1">
          <h2 className="text-fg text-[16px] font-semibold">Your agent library</h2>
          <p className="text-fg-dim mt-1 text-[12px]">
            Repeat useful work. Find a decision. Keep its source.
          </p>
        </div>
        <SearchableSelect
          label="Library project"
          indentGrouped
          className="w-60 max-w-full"
          value={scope}
          disabled={!!projectId}
          options={[{ value: '', label: 'All projects' }, ...projectOptions]}
          onChange={setScope}
          searchPlaceholder="Find a project or group…"
        />
      </header>
      <nav className="border-border mb-4 flex gap-2 border-b pb-3" aria-label="Library sections">
        {(['recipes', 'history', 'memory'] as const).map((value) => (
          <button
            className={`${button} ${section === value ? 'bg-fg/7 text-fg' : ''}`}
            aria-pressed={section === value}
            key={value}
            onClick={() => setSection(value)}
          >
            {value === 'memory'
              ? 'Project decisions'
              : value === 'recipes'
                ? 'Task recipes'
                : 'History search'}
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
            Retry loading
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
              <Plus className="h-3.5 w-3.5" />
              New recipe
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => importRecipes.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import
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
              <Download className="h-3.5 w-3.5" />
              Export recipes
            </button>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            ref={importRecipes}
            className="hidden"
            aria-label="Import agent recipes"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void action(async () => {
                  if (file.size > 1024 * 1024) throw new Error('Recipe file exceeds 1 MiB');
                  const data = JSON.parse(await file.text());
                  if (
                    data.version !== 1 ||
                    !Array.isArray(data.recipes) ||
                    data.recipes.length > 100
                  )
                    throw new Error('Unsupported recipe file');
                  const imported = data.recipes.map(portableAgentRecipe);
                  for (const recipe of imported) {
                    const id = crypto.randomUUID();
                    await useAgentLibraryStore
                      .getState()
                      .save(`recipe:${id}`, { ...recipe, id, projectId: scope || undefined });
                  }
                  setNotice(
                    `Imported ${imported.length} recipes. Review settings before launching.`,
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
                  {describeTarget(recipe.backend)} · {recipe.model || 'Agent default'} ·{' '}
                  {recipe.isolated ? 'Worktree' : 'Local'}
                </p>
                {(() => {
                  const scheduled = scheduleFor(recipe.id);
                  if (!scheduled) return null;
                  return (
                    <p className="text-fg-dim mt-1 text-[11px]">
                      {describeCadence(scheduled.cadence)}
                      {scheduled.enabled
                        ? ` · next ${new Date(
                            nextScheduledRun(scheduled.cadence, scheduled.lastRunAt ?? Date.now()),
                          ).toLocaleString()}`
                        : ' · paused'}
                      {scheduled.lastOutcome ? ` · last: ${scheduled.lastOutcome}` : ''}
                    </p>
                  );
                })()}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={button} onClick={() => start(recipe, false)}>
                    <Play className="h-3 w-3" />
                    Draft task
                  </button>
                  <button className={button} onClick={() => start(recipe, true)}>
                    Create workflow
                  </button>
                  <button className={button} onClick={() => setEditor({ ...recipe })}>
                    Edit
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
                    {scheduleFor(recipe.id) ? 'Schedule…' : 'Schedule'}
                  </button>
                  <button
                    aria-label={`Delete recipe ${recipe.name}`}
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
              Save your recurring tasks with a provider, workspace and checks. Use {'{{variable}}'}{' '}
              for parameters.
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
              placeholder="Search prompts, answers and decisions…"
              aria-label="Search conversation content"
            />
            <SearchableSelect
              label="History provider"
              searchable={false}
              className="w-40 max-w-full"
              menuWidth={220}
              value={backend}
              options={[
                { value: '', label: 'All providers' },
                ...tools.map((t) => ({ value: t.id, label: t.name })),
              ]}
              onChange={setBackend}
            />
            <SearchableSelect
              label="History status"
              searchable={false}
              className="w-40 max-w-full"
              menuWidth={220}
              value={status}
              options={[
                { value: '', label: 'All statuses' },
                ...['completed', 'failed', 'interrupted', 'running'].map((s) => ({
                  value: s,
                  label: s,
                })),
              ]}
              onChange={setStatus}
            />
            <button type="submit" className={button} disabled={busy || !query.trim()}>
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
            <div className="text-fg-muted flex w-full flex-wrap gap-3 text-[11px]">
              <label>
                From{' '}
                <input
                  type="date"
                  aria-label="History from date"
                  className={`${field} mt-1`}
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </label>
              <label>
                Through{' '}
                <input
                  type="date"
                  aria-label="History through date"
                  className={`${field} mt-1`}
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
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
              <Download className="h-3.5 w-3.5" />
              Export {scope ? 'project' : 'all'} history
            </button>
            <button
              className={button}
              disabled={busy || !scope}
              title={
                scope
                  ? 'Import as archived, read-only conversations'
                  : 'Choose a destination project first'
              }
              onClick={() => importHistory.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import history
            </button>
            <span className="text-fg-dim text-[11px]">
              Imported history is archived; it cannot resume a provider session.
            </span>
          </div>
          <AgentHistoryRetention key={scope} projectId={scope} />
          <input
            type="file"
            accept="application/json,.json"
            ref={importHistory}
            className="hidden"
            aria-label="Import agent history"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void action(async () => {
                  if (!scope) throw new Error('Choose the destination project');
                  if (file.size > 32 * 1024 * 1024)
                    throw new Error('History archive exceeds 32 MiB');
                  const count = await agentWorkspaceIpc.importHistory(
                    scope,
                    JSON.parse(await file.text()),
                  );
                  await useAgentStore.getState().refresh();
                  setNotice(`Imported ${count} archived conversations.`);
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
                    {new Date(hit.item.created_at).toLocaleDateString()}
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
                  Save as project decision
                </button>
              </article>
            ))}
          </div>
          {searched && !hits.length && (
            <p className="text-fg-dim py-10 text-center text-[13px]">
              No matching conversation content.
            </p>
          )}
          {hits.length > 0 && hits.length % 50 === 0 && (
            <button
              disabled={busy}
              className={`${button} mx-auto mt-4`}
              onClick={() => void search(true)}
            >
              Load older matches
            </button>
          )}
        </>
      )}
      {section === 'memory' && (
        <>
          <button
            className={`${button} mb-4`}
            disabled={!scope}
            title={!scope ? 'Choose a project first' : undefined}
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
            <Plus className="h-3.5 w-3.5" />
            New project decision
          </button>
          <div className="space-y-3">
            {memories.map((m) => (
              <article key={m.id} className="border-border rounded-lg border p-4">
                <h3 className="text-fg text-[14px] font-medium">{m.title}</h3>
                <p className="text-fg-muted mt-2 text-[12px] whitespace-pre-wrap">{m.content}</p>
                <p className="text-fg-dim mt-2 text-[10px]">
                  {projects.find((p) => p.id === m.projectId)?.name} ·{' '}
                  {new Date(m.capturedAt).toLocaleDateString()}
                </p>
                <div className="mt-3 flex gap-3 text-[11px]">
                  {m.sourceSessionId && (
                    <button
                      className="text-accent"
                      onClick={() => onOpenSession(m.sourceSessionId!, m.sourceItemId)}
                    >
                      Source conversation
                    </button>
                  )}
                  <button className="text-fg-muted" onClick={() => setMemoryEditor({ ...m })}>
                    Edit
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
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!memories.length && (
            <p className="text-fg-dim py-10 text-center text-[13px]">
              Pin useful results from history search, or write a project decision. Add it to a task
              from Context.
            </p>
          )}
        </>
      )}
      {editor && (
        <LibraryDialog title="Edit task recipe" onClose={() => setEditor(null)}>
          <form
            aria-label="Edit task recipe"
            className="border-border bg-surface-raised overlay-scroll max-h-[90vh] w-full max-w-2xl space-y-3 overflow-auto rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
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
            <h3 className="text-fg font-medium">Task recipe</h3>
            {(['name', 'prompt', 'acceptance', 'setupCommands', 'checkCommands'] as const).map(
              (key) => (
                <label key={key} className="text-fg-muted block space-y-1 text-[12px]">
                  <span>
                    {
                      {
                        name: 'Name',
                        prompt: 'Prompt · supports {{parameters}}',
                        acceptance: 'Acceptance criteria',
                        setupCommands: 'Setup commands · one per line, used by workflows',
                        checkCommands: 'Check commands · one per line, used by workflows',
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
                Project scope
                <SearchableSelect
                  label="Recipe project scope"
                  indentGrouped
                  className="mt-1"
                  value={editor.projectId || ''}
                  options={[{ value: '', label: 'All projects' }, ...projectOptions]}
                  onChange={(value) => setEditor({ ...editor, projectId: value || undefined })}
                  searchPlaceholder="Find a project or group…"
                />
              </label>
              <label className="text-fg-muted text-[12px]">
                Provider
                <SearchableSelect
                  label="Recipe provider"
                  searchable={false}
                  className="mt-1"
                  value={editor.backend}
                  options={[
                    { value: '', label: 'Choose at launch' },
                    ...tools.map((t) => ({ value: t.id, label: t.name })),
                    // A pool lets a scheduled run pick a free account instead of waiting on one.
                    ...accountPools.map((pool) => ({
                      value: poolTarget(pool.id),
                      label: `${pool.name} (pool)`,
                    })),
                  ]}
                  onChange={(value) => setEditor({ ...editor, backend: value })}
                />
              </label>
              {(['model', 'effort', 'agent'] as const).map((key) => (
                <label key={key} className="text-fg-muted text-[12px]">
                  {key}
                  <input
                    className={field}
                    placeholder="Agent default"
                    value={editor[key]}
                    onChange={(e) => setEditor({ ...editor, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="text-fg-muted text-[12px]">
                Mode
                <SearchableSelect
                  label="Recipe mode"
                  searchable={false}
                  className="mt-1"
                  menuWidth={200}
                  value={editor.mode}
                  options={[
                    { value: 'default', label: 'Agent' },
                    { value: 'plan', label: 'Plan' },
                  ]}
                  onChange={(value) => setEditor({ ...editor, mode: value as 'default' | 'plan' })}
                />
              </label>
              <label className="text-fg-muted flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={editor.isolated}
                  onChange={(e) => setEditor({ ...editor, isolated: e.target.checked })}
                />
                Isolated worktree
              </label>
            </div>
            <details className="border-border rounded-xl border p-3">
              <summary className="text-fg-muted cursor-pointer text-[12px]">
                Workflow steps &middot;{' '}
                {editor.workflowSteps?.length
                  ? `${editor.workflowSteps.length} saved`
                  : 'this recipe implements and reviews'}
              </summary>
              <p className="text-fg-dim mt-2 text-[11px] leading-relaxed">
                Used only when this recipe creates a workflow. Leave it empty to keep the agent
                above implementing and reviewing; add steps to save a division of labour that
                repeats across projects.
              </p>
              {editor.workflowSteps?.length ? (
                <div className="mt-3">
                  <AgentWorkflowTasks
                    steps={recipeStepsToCreateSteps(editor.workflowSteps)}
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
                  Add workflow steps
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
                Cancel
              </button>
              <button className={button} disabled={busy}>
                Save recipe
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {memoryEditor && (
        <LibraryDialog title="Project decision" onClose={() => setMemoryEditor(null)}>
          <form
            aria-label="Project decision"
            className="border-border bg-surface-raised w-full max-w-2xl space-y-3 rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await useAgentLibraryStore
                  .getState()
                  .save(`memory:${memoryEditor.id}`, { ...memoryEditor, capturedAt: Date.now() });
                setMemoryEditor(null);
                setNotice('Project decision saved.');
              });
            }}
          >
            <h3 className="text-fg font-medium">Project decision</h3>
            <input
              className={field}
              required
              aria-label="Decision title"
              value={memoryEditor.title}
              onChange={(e) => setMemoryEditor({ ...memoryEditor, title: e.target.value })}
            />
            <textarea
              className={`${field} max-h-[60vh]`}
              required
              rows={12}
              aria-label="Decision content"
              value={memoryEditor.content}
              onChange={(e) => setMemoryEditor({ ...memoryEditor, content: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setMemoryEditor(null)}>
                Cancel
              </button>
              <button className={button} disabled={busy}>
                Save decision
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {scheduleEditor && (
        <LibraryDialog title="Schedule" onClose={() => setScheduleEditor(null)}>
          <form
            aria-label="Recipe schedule"
            className="border-border bg-surface-raised w-full max-w-lg space-y-3 rounded-xl border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await useAgentLibraryStore
                  .getState()
                  .save(`schedule:${scheduleEditor.recipeId}`, parseSchedule(scheduleEditor));
                setScheduleEditor(null);
                setNotice('Schedule saved.');
              });
            }}
          >
            <h3 className="text-fg font-medium">Run this recipe on a schedule</h3>
            <SearchableSelect
              label="Schedule project"
              indentGrouped
              value={scheduleEditor.projectId}
              options={projectOptions}
              onChange={(value) => setScheduleEditor({ ...scheduleEditor, projectId: value })}
              searchPlaceholder="Find a project or group…"
            />
            <SearchableSelect
              label="How often"
              searchable={false}
              value={scheduleEditor.cadence.kind}
              options={[
                { value: 'daily', label: 'Every day' },
                { value: 'weekly', label: 'Every week' },
                { value: 'interval', label: 'Every few hours' },
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
                Hours between runs
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
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {scheduleEditor.cadence.kind === 'weekly' && (
                  <SearchableSelect
                    label="Weekday"
                    searchable={false}
                    value={String(scheduleEditor.cadence.day)}
                    options={[
                      'Sunday',
                      'Monday',
                      'Tuesday',
                      'Wednesday',
                      'Thursday',
                      'Friday',
                      'Saturday',
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
                  Time
                  <input
                    className={field}
                    type="time"
                    value={(scheduleEditor.cadence as Extract<AgentCadence, { time: string }>).time}
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
                </label>
              </div>
            )}
            <label className="text-fg-muted flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={scheduleEditor.enabled}
                onChange={(e) =>
                  setScheduleEditor({ ...scheduleEditor, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <p className="text-fg-dim text-[11px] leading-relaxed">
              Scheduled runs start the recipe as a new task while RunHQ is running. Nothing runs
              while RunHQ is closed; occurrences missed in the meantime are reported and started
              once, not replayed. A run waits when the tool is disabled or its execution slots are
              full.
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
                      setNotice('Schedule removed.');
                    })
                  }
                >
                  Remove schedule
                </button>
              )}
              <button type="button" className={button} onClick={() => setScheduleEditor(null)}>
                Cancel
              </button>
              <button className={button} disabled={busy || !scheduleEditor.projectId}>
                Save schedule
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
      {launch && (
        <LibraryDialog title="Recipe parameters" onClose={() => setLaunch(null)}>
          <form
            aria-label="Recipe parameters"
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
              Review the resolved task settings before starting.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setLaunch(null)}>
                Cancel
              </button>
              <button className={button}>Use recipe</button>
            </div>
          </form>
        </LibraryDialog>
      )}
    </section>
  );
}
