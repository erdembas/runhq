import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, modules = {}, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      ...globals,
      require: (name) => {
        if (Object.hasOwn(modules, name)) return modules[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return exports;
}
const graph = load('../src/components/agents/agentWorkflowGraph.ts');
const attention = load('../src/components/agents/agentWorkflowAttention.ts', {
  './agentWorkflowGraph': graph,
});
const workflow = (id, extra = {}) => ({
  id,
  title: `Work ${id}`,
  objective: '',
  project_id: 'a',
  stage: 'implementing',
  steps: [],
  updated_at: 1,
  cleaned: false,
  error: null,
  ...extra,
});
const step = (id, extra = {}) => ({
  id,
  role: 'implement',
  status: 'pending',
  depends_on: [],
  error: null,
  merge: null,
  ...extra,
});

test('Attention includes review gates, failed work, conflicts and application decisions once per workflow', () => {
  const entries = attention.collectWorkflowAttention([
    workflow('review', {
      steps: [
        step('r1', {
          role: 'review',
          status: 'completed',
          review_policy: 'approval',
          review_outcome: 'passed',
          review_summary: 'Review evidence',
        }),
        step('r2', { role: 'review', status: 'completed', review_policy: 'approval' }),
      ],
    }),
    workflow('conflict', {
      steps: [
        step('p', {
          status: 'completed',
          merge: { status: 'conflict', conflict: 'README conflict' },
        }),
      ],
    }),
    workflow('blocked', {
      steps: [step('p', { status: 'blocked', error: 'No account available' })],
    }),
    workflow('failed', { stage: 'checks_failed', error: 'test failure' }),
    workflow('apply', { stage: 'ready' }),
    workflow('interrupted', { stage: 'interrupted' }),
  ]);
  assert.deepEqual(plain(entries.map(({ workflow, kind }) => [workflow.id, kind])), [
    ['review', 'review'],
    ['conflict', 'blocked'],
    ['blocked', 'blocked'],
    ['failed', 'failed'],
    ['apply', 'apply'],
    ['interrupted', 'failed'],
  ]);
  assert.equal(entries[0].detail, 'Review evidence');
  assert.equal(entries[1].detail, 'README conflict');
});

test('normal dependency waits, accepted reviews and deliberately stopped or applied work do not create false alerts', () => {
  assert.equal(
    attention.collectWorkflowAttention([
      workflow('running', {
        steps: [step('a', { status: 'running' }), step('b', { depends_on: ['a'] })],
      }),
      workflow('queued', { stage: 'waiting', start_after: { session_id: 'prior' } }),
      workflow('review-passed', {
        steps: [
          step('r', {
            role: 'review',
            status: 'completed',
            review_policy: 'on_findings',
            review_outcome: 'passed',
          }),
        ],
      }),
      workflow('review-accepted', {
        steps: [
          step('r', {
            role: 'review',
            status: 'completed',
            review_policy: 'approval',
            review_decision: 'approved',
          }),
        ],
      }),
      workflow('stopped', { stage: 'cancelled', steps: [step('a', { status: 'failed' })] }),
      workflow('applied', { stage: 'integrated', steps: [step('a', { status: 'failed' })] }),
      workflow('cleaned', { stage: 'checks_failed', cleaned: true }),
    ]).length,
    0,
  );
});

test('project and text filters preserve the global workflow attention snapshot', () => {
  const entries = attention.collectWorkflowAttention([
    workflow('a', { stage: 'ready', updated_at: 10 }),
    workflow('b', {
      project_id: 'b',
      stage: 'setup_failed',
      error: 'Missing environment',
      updated_at: 2,
    }),
  ]);
  const names = (id) => (id === 'a' ? 'Frontend' : 'Backend');
  assert.deepEqual(
    plain(
      attention
        .filterWorkflowAttention(entries, { search: 'environment' }, names)
        .map((entry) => entry.workflow.id),
    ),
    ['b'],
  );
  assert.deepEqual(
    plain(
      attention
        .filterWorkflowAttention(entries, { projectId: 'a', search: 'frontend' }, names)
        .map((entry) => entry.workflow.id),
    ),
    ['a'],
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].workflow.id, 'b', 'oldest unresolved work is shown first');
});

const nodes = (node) =>
  !node || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
const find = (tree, type) => nodes(tree).find((node) => node.type === type);
const host = (tree, type, scope) =>
  nodes(tree).find(
    (node) => node.props?.children?.type === type && node.props.children.props.projectId === scope,
  );

function workspaceHarness(initialView = 'workflows', { collapsed = false } = {}) {
  const rootHooks = [];
  let hooks = rootHooks;
  let reads = [];
  let cursor = 0,
    effects = [],
    changed = false;
  const react = {
    useId: () => 'session-list',
    useMemo: (factory) => factory(),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks[index],
        (value) => {
          const next = typeof value === 'function' ? value(hooks[index]) : value;
          if (!Object.is(next, hooks[index])) changed = true;
          hooks[index] = next;
        },
      ];
    },
    useRef: (current) => {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        old?.cleanup?.();
        hooks[index] = { deps };
        effects.push(() => {
          hooks[index].cleanup = effect();
        });
      }
    },
  };
  const bind = (state) =>
    Object.assign((select) => select(state), {
      getState: () => state,
      setState: (update) => {
        Object.assign(state, typeof update === 'function' ? update(state) : update);
        changed = true;
      },
    });
  const props = { shell: true, visible: true };
  const agents = {
    projects: [
      { id: 'a', name: 'Frontend' },
      { id: 'b', name: 'Backend' },
    ],
    projectFilter: 'a',
    selectedId: null,
    navigationRevision: 0,
    ready: true,
    error: null,
    tools: [],
    sessions: {
      task: {
        id: 'task',
        title: 'Build the screen',
        project_id: 'a',
        project_name: 'Frontend',
        backend: 'codex',
        status: 'completed',
        pending: [],
        cwd: '/project',
        updated_at: 1,
      },
    },
    select: (id) => {
      agents.selectedId = id;
      agents.navigationRevision++;
      changed = true;
    },
  };
  const workbench = {
    agentView: initialView,
    agentViewRevision: 0,
    requestedWorkflowId: null,
    agentHandoff: null,
    projectSelectedSessions: {},
    projectSelectionRevisions: {},
    serviceAgentProjects: {},
    setProjectSelectedSession: (projectId, sessionId) => {
      workbench.projectSelectedSessions = {
        ...workbench.projectSelectedSessions,
        [projectId]: sessionId,
      };
      workbench.projectSelectionRevisions = {
        ...workbench.projectSelectionRevisions,
        [projectId]: (workbench.projectSelectionRevisions[projectId] ?? 0) + 1,
      };
      changed = true;
    },
    registerServiceAgentProject: (serviceId, cwd, project) => {
      workbench.serviceAgentProjects[serviceId] = { cwd, project };
    },
    requestAgentView: (view) => {
      workbench.agentView = view;
      workbench.agentViewRevision++;
      changed = true;
    },
  };
  const app = { services: [{ id: 'service-a', cwd: '/a' }] };
  const stores = { agents: bind(agents), workbench: bind(workbench) };
  const opened = [];
  const modules = {
    react,
    'react/jsx-runtime': {
      jsx: (type, props, key) => ({ type, props, key }),
      jsxs: (type, props, key) => ({ type, props, key }),
    },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@tauri-apps/plugin-dialog': { open: async () => null },
    '@runhq/cockpit-ui': {
      agentTaskLane: (session) => (session.pending.length ? 'attention' : 'completed'),
      agentIsActive: () => false,
      agentProviderNames: {},
      AgentMissionControl: 'AgentMissionControl',
    },
    '@/lib/ipc': { ipc: {} },
    '@/store/useAgentStore': { useAgentStore: stores.agents },
    '@/store/useAppStore': { useAppStore: bind(app) },
    '@/store/useWorkbenchStore': { useWorkbenchStore: stores.workbench },
    '@/store/useAgentLibraryStore': { useAgentLibraryStore: bind({ records: {} }) },
    '@/store/useAgentQueueStore': { useAgentQueueStore: bind({ queues: {} }) },
    '@/lib/useVisibleStore': {
      useVisibleStore: (store, select, visible) => {
        reads.push({ store: store === stores.workbench ? 'workbench' : 'agents', visible });
        const snapshot = react.useRef(store.getState());
        if (visible) snapshot.current = { ...store.getState() };
        return select(snapshot.current);
      },
    },
    '@/lib/usePersistentBoolean': { usePersistentBoolean: () => react.useState(collapsed) },
    '@/lib/useResizableWidth': {
      useResizableWidth: () => ({ width: 260, dragging: false, handleProps: {} }),
    },
    '@/lib/workbenchNavigation': {
      openAgentTask: (id, options) => {
        opened.push({ id, options });
        workbench.setProjectSelectedSession(agents.sessions[id].project_id, id);
        props.visible = false;
      },
      openWorkflow: (id, projectId) => {
        workbench.requestedWorkflowId = id;
        agents.projectFilter = projectId;
        workbench.requestAgentView('workflows');
      },
    },
    './useAgentProjectOptions': { useAgentProjectOptions: () => [] },
    './agentCapacity': { agentCapacityPreferences: () => ({}), agentOccupiedSlots: () => ({}) },
    './agentAccountRouting': {
      composerAccountForTarget: ({ target }) => target,
      isPoolTarget: () => false,
      parseAccountCooldowns: () => ({}),
      handoffAccountAfterLimit: () => '',
    },
    './agentWorkflowRecipeBridge': { recipeStepsToCreateSteps: (steps) => steps },
    '@/components/workspaces/WorkspaceOverview': { WorkspaceOverview: 'WorkspaceOverview' },
    '@/components/workbench/AgentTaskPane': { AgentTaskPane: 'AgentTaskPane' },
  };
  for (const name of [
    'AgentNewSession',
    'AgentSessionView',
    'AgentDecisionInbox',
    'AgentRecoveryNotice',
    'AgentWorkflowHub',
    'AgentLibrary',
    'AgentUsagePanel',
    'AgentUsageNotifications',
  ])
    modules[`./${name}`] = { [name]: name };
  for (const name of ['ConfirmDialog', 'ResizeHandle'])
    modules[`@/components/ui/${name}`] = { [name]: name };
  const component = load('../src/components/agents/AgentWorkspace.tsx', modules, {
    crypto: { randomUUID },
  }).AgentWorkspace;
  function renderWith(state, nextProps, renderComponent = component) {
    let tree,
      count = 0;
    do {
      hooks = state;
      reads = [];
      cursor = 0;
      effects = [];
      changed = false;
      tree = renderComponent(nextProps);
      for (const effect of effects) effect();
      assert(++count < 20, 'workspace render loop');
    } while (changed);
    return tree;
  }
  return {
    agents,
    app,
    workbench,
    opened,
    props,
    render: () => renderWith(rootHooks, props),
    createProjectHost(project) {
      const state = [];
      const scopedProps = { shell: true, project, visible: true };
      return {
        props: scopedProps,
        render: () => renderWith(state, scopedProps),
        get reads() {
          return reads;
        },
      };
    },
    createResolverHost(initialProps) {
      const state = [],
        calls = [];
      const resolverProps = { ...initialProps };
      const resolver = load('../src/components/agents/ProjectAgentsTab.tsx', {
        ...modules,
        './AgentWorkspace': { AgentWorkspace: 'AgentWorkspace' },
        '@/lib/ipc': {
          ipc: {
            agentAddProject: (name, cwd) =>
              new Promise((resolve, reject) => calls.push({ name, cwd, resolve, reject })),
          },
        },
      }).ProjectAgentsTab;
      return {
        props: resolverProps,
        calls,
        render: () => renderWith(state, resolverProps, resolver),
      };
    },
  };
}

test('workflow and library editors retain their React hosts across section and project navigation', () => {
  const h = workspaceHarness();
  const first = host(h.render(), 'AgentWorkflowHub', 'a');
  assert(first);
  h.workbench.requestAgentView('library');
  let tree = h.render();
  assert.equal(host(tree, 'AgentWorkflowHub', 'a').key, first.key);
  assert.equal(host(tree, 'AgentWorkflowHub', 'a').props.children.props.visible, false);
  const library = host(tree, 'AgentLibrary', 'a');
  h.agents.projectFilter = 'b';
  h.workbench.requestAgentView('workflows');
  tree = h.render();
  assert(host(tree, 'AgentWorkflowHub', 'b'));
  assert.equal(host(tree, 'AgentLibrary', 'a').key, library.key);
  h.agents.projectFilter = 'a';
  tree = h.render();
  assert.equal(host(tree, 'AgentWorkflowHub', 'a').key, first.key);
  assert.equal(host(tree, 'AgentWorkflowHub', 'a').props.children.props.visible, true);
});

test('opening a workflow task preserves the workflow view after the hidden shell observes session selection', () => {
  const h = workspaceHarness();
  find(h.render(), 'AgentWorkflowHub').props.onOpenSession('task', 'workflow-a');
  h.render();
  assert.deepEqual(plain(h.opened), [{ id: 'task', options: { workflowId: 'workflow-a' } }]);
  assert.equal(h.workbench.agentView, 'workflows');
  h.props.visible = true;
  h.render();
  assert.equal(
    h.workbench.agentView,
    'workflows',
    'returning must not replay a hidden select event',
  );
});

test('global external selection renders the conversation in place without recursive navigation', () => {
  const h = workspaceHarness('overview');
  h.render();
  h.agents.select('task');
  const tree = h.render();
  assert.equal(h.workbench.agentView, 'conversations');
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'task');
  assert.equal(find(tree, 'AgentTaskPane').props.visible, true);
  assert.equal(h.opened.length, 0, 'observing selection must not call navigation again');
});

test('global project scope changes hide an unrelated editable conversation', () => {
  const h = workspaceHarness('conversations');
  h.agents.select('task');
  assert.equal(find(h.render(), 'AgentTaskPane').props.visible, true);
  h.agents.projectFilter = 'b';
  let tree = h.render();
  assert.equal(find(tree, 'AgentTaskPane').props.visible, false);
  assert.equal(find(tree, 'AgentNewSession'), undefined);
  h.agents.projectFilter = 'a';
  tree = h.render();
  assert.equal(find(tree, 'AgentTaskPane').props.visible, true);
  nodes(tree)
    .find((node) => node.props?.label === 'Filter by project')
    .props.onChange('b');
  tree = h.render();
  assert.equal(h.agents.selectedId, null);
  assert.equal(find(tree, 'AgentTaskPane').props.visible, false);
  assert.equal(h.opened.length, 0);
});

test('handoff payload seeds the existing composer once and is consumed without starting work', () => {
  const h = workspaceHarness('conversations');
  h.workbench.agentHandoff = {
    sessionId: 'task',
    items: [{ kind: 'assistant', text: 'Implementation context' }],
    revision: 1,
  };
  const composer = find(h.render(), 'AgentNewSession');
  assert(composer);
  assert.equal(composer.props.initialRecipe.sourceSessionId, 'task');
  assert.match(composer.props.initialRecipe.prompt, /Implementation context/);
  assert.equal(h.workbench.agentHandoff, null);
  assert.equal(h.opened.length, 0);
  assert.equal(find(h.render(), 'AgentNewSession').key, composer.key);
});

const textContent = (node) =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(textContent).join('')
      : textContent(node?.props?.children || '');
const buttonNamed = (tree, name) =>
  nodes(tree).find((node) => node.type === 'button' && textContent(node) === name);

test('project chat histories keep independent selection, drafts and global navigation signals', () => {
  const h = workspaceHarness('workflows', { collapsed: true });
  h.agents.sessions.other = {
    ...h.agents.sessions.task,
    id: 'other',
    title: 'Backend task',
    project_id: 'b',
    project_name: 'Backend',
  };
  h.render();
  h.props.visible = false;
  h.workbench.requestedWorkflowId = 'workflow-b';
  h.workbench.agentHandoff = {
    sessionId: 'other',
    items: [{ kind: 'assistant', text: 'Global handoff context' }],
    revision: 1,
  };
  const payload = h.workbench.agentHandoff;
  const a = h.createProjectHost(h.agents.projects[0]);
  const b = h.createProjectHost(h.agents.projects[1]);
  let tree = a.render();
  const history = nodes(tree).find((node) => node.type === 'aside');
  assert.equal(history.props['aria-label'], 'Chat history');
  assert(
    !history.props.className.split(' ').includes('hidden'),
    'stored collapse cannot hide project history',
  );
  assert.equal(find(tree, 'header'), undefined, 'the project tab owns the sole navigation header');
  assert.equal(buttonNamed(tree, 'Board'), undefined);
  assert.equal(buttonNamed(tree, 'List'), undefined);
  assert.equal(find(tree, 'AgentWorkflowHub'), undefined);
  assert.equal(find(tree, 'AgentRecoveryNotice'), undefined);
  assert.equal(find(tree, 'AgentUsageNotifications'), undefined);
  assert(textContent(tree).includes('Build the screen'));
  assert(!textContent(tree).includes('Backend task'));
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'task');
  assert.equal(find(tree, 'AgentTaskPane').props.visible, true);
  assert.equal(h.workbench.agentView, 'workflows');
  tree = b.render();
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'other');
  assert.deepEqual(plain(h.workbench.projectSelectedSessions), { a: 'task', b: 'other' });
  assert(textContent(tree).includes('Backend task'));
  assert(!textContent(tree).includes('Build the screen'));
  buttonNamed(tree, 'New task').props.onClick();
  const composer = find(b.render(), 'AgentNewSession');
  assert.equal(composer.props.project.id, 'b');
  assert.equal(
    composer.props.initialRecipe,
    undefined,
    'global handoff cannot seed the project composer',
  );
  assert.equal(h.workbench.agentHandoff, payload);
  assert.equal(h.workbench.requestedWorkflowId, 'workflow-b');
  h.workbench.requestAgentView('library');
  a.props.visible = false;
  assert.equal(find(a.render(), 'AgentTaskPane').props.visible, false);
  assert(
    a.reads.every((read) => !read.visible),
    'hidden project hosts stop every data subscription',
  );
  a.props.visible = true;
  assert.equal(find(a.render(), 'AgentTaskPane').props.sessionId, 'task');
  assert.equal(
    find(b.render(), 'AgentNewSession').key,
    composer.key,
    'the other local draft stays mounted',
  );
  nodes(a.render())
    .find((node) => node.type === 'button' && textContent(node).includes('Build the screen'))
    .props.onClick();
  a.render();
  assert.equal(h.opened.at(-1).id, 'task', 'history selection uses canonical project navigation');
  assert.equal(h.workbench.projectSelectedSessions.a, 'task');
  assert.equal(h.agents.selectedId, null, 'local history does not overwrite global selection');
  assert.equal(h.workbench.agentView, 'library');
  assert.equal(h.workbench.agentHandoff, payload);
  h.render(); // React also renders the hidden global host when its live navigation signal changes.
  h.props.visible = true;
  const globalComposer = find(h.render(), 'AgentNewSession');
  assert.equal(globalComposer.props.initialRecipe.sourceSessionId, 'other');
  assert.equal(h.workbench.agentHandoff, null, 'only the visible global host consumes its handoff');
});

test('project history status filters stay local and keep the selected conversation mounted', () => {
  const h = workspaceHarness('workflows');
  h.agents.sessions.task.pending = [{ id: 'question', title: 'Choose a direction' }];
  const project = h.createProjectHost(h.agents.projects[0]);
  const statusFilter = nodes(project.render()).find(
    (node) => node.props?.label === 'Filter tasks by status',
  );
  statusFilter.props.onChange('attention');
  const tree = project.render();
  assert.equal(find(tree, 'AgentDecisionInbox'), undefined);
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'task');
  assert.equal(find(tree, 'AgentTaskPane').props.visible, true);
  assert.equal(
    nodes(tree).find((node) => node.props?.label === 'Filter tasks by status').props.value,
    'attention',
  );
  assert.equal(h.workbench.agentView, 'workflows');
});

test('latest local chat opens by default and visited conversations retain stable hosts', () => {
  const h = workspaceHarness('workflows');
  h.agents.sessions.newer = {
    ...h.agents.sessions.task,
    id: 'newer',
    title: 'Latest chat',
    updated_at: 20,
  };
  h.agents.sessions.archived = {
    ...h.agents.sessions.task,
    id: 'archived',
    updated_at: 50,
    archived: true,
  };
  const project = h.createProjectHost(h.agents.projects[0]);
  let tree = project.render();
  assert.equal(h.workbench.projectSelectedSessions.a, 'newer');
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'newer');
  const initial = nodes(tree).find((node) => node.props?.children?.type === 'AgentTaskPane');
  nodes(tree)
    .find((node) => node.type === 'button' && textContent(node).includes('Build the screen'))
    .props.onClick();
  tree = project.render();
  const panes = nodes(tree).filter((node) => node.type === 'AgentTaskPane');
  assert.deepEqual(plain(panes.map((node) => [node.props.sessionId, node.props.visible])), [
    ['newer', false],
    ['task', true],
  ]);
  const retained = nodes(tree).find((node) => node.props?.children?.props?.sessionId === 'newer');
  assert.equal(retained.key, initial.key);
  buttonNamed(tree, 'New task').props.onClick();
  tree = project.render();
  const composer = find(tree, 'AgentNewSession');
  assert(composer.props.visible);
  assert(
    nodes(tree)
      .filter((node) => node.type === 'AgentTaskPane')
      .every((node) => !node.props.visible),
  );
  const before = h.workbench.projectSelectionRevisions.a;
  h.workbench.setProjectSelectedSession('a', 'task');
  tree = project.render();
  assert(h.workbench.projectSelectionRevisions.a > before);
  assert.equal(
    find(tree, 'AgentNewSession').props.visible,
    false,
    'a repeated explicit selection hides the new-task composer',
  );
  assert.equal(
    find(tree, 'AgentNewSession').key,
    composer.key,
    'history browsing retains the draft host',
  );
  assert.equal(
    nodes(tree).find((node) => node.type === 'AgentTaskPane' && node.props.visible).props.sessionId,
    'task',
  );
  buttonNamed(tree, 'New task').props.onClick();
  tree = project.render();
  assert.equal(find(tree, 'AgentNewSession').key, composer.key);
  assert.equal(find(tree, 'AgentNewSession').props.visible, true);
  project.props.visible = false;
  assert(
    nodes(project.render())
      .filter((node) => node.type === 'AgentTaskPane')
      .every((node) => !node.props.visible),
  );
});

test('local handoff and new-task completion stay inside the project conversation area', () => {
  const h = workspaceHarness();
  const project = h.createProjectHost(h.agents.projects[0]);
  const sourcePane = find(project.render(), 'AgentTaskPane');
  sourcePane.props.onHandoff([{ kind: 'assistant', text: 'Keep local context' }]);
  const composer = find(project.render(), 'AgentNewSession');
  assert.equal(composer.props.project.id, 'a');
  assert.equal(composer.props.initialRecipe.sourceSessionId, 'task');
  assert.match(composer.props.initialRecipe.prompt, /Keep local context/);
  assert.equal(h.workbench.agentHandoff, null);
  assert.equal(h.workbench.agentView, 'workflows');
  const created = {
    ...h.agents.sessions.task,
    id: 'created',
    title: 'Created here',
    updated_at: 3,
  };
  h.agents.sessions.created = created;
  composer.props.onCreated(created);
  const tree = project.render();
  assert.equal(find(tree, 'AgentNewSession').props.visible, false);
  assert.equal(h.workbench.projectSelectedSessions.a, 'created');
  assert.equal(
    nodes(tree).find((node) => node.type === 'AgentTaskPane' && node.props.visible).props.sessionId,
    'created',
  );
  assert.equal(h.workbench.agentView, 'workflows');
});

test('an unresolved project waits for session hydration before choosing a chat or opening a composer', () => {
  const h = workspaceHarness();
  const existing = h.agents.sessions;
  h.agents.sessions = {};
  h.agents.ready = false;
  const project = h.createProjectHost(h.agents.projects[0]);
  let tree = project.render();
  assert.equal(find(tree, 'AgentNewSession'), undefined);
  assert.equal(find(tree, 'AgentTaskPane'), undefined);
  assert.equal(h.workbench.projectSelectedSessions.a, undefined);
  h.agents.sessions = existing;
  h.agents.ready = true;
  tree = project.render();
  assert.equal(find(tree, 'AgentTaskPane').props.sessionId, 'task');
  assert.notEqual(find(tree, 'AgentNewSession')?.props.visible, true);
});

test('a hidden project never leaves its delete confirmation portal over another workspace', () => {
  const h = workspaceHarness();
  const project = h.createProjectHost(h.agents.projects[0]);
  const deleteButton = nodes(project.render()).find(
    (node) =>
      node.type === 'button' &&
      node.props['aria-label'] === 'Delete conversation: Build the screen',
  );
  deleteButton.props.onClick();
  assert(find(project.render(), 'ConfirmDialog'));
  project.props.visible = false;
  assert.equal(find(project.render(), 'ConfirmDialog'), undefined);
  project.props.visible = true;
  assert(
    find(project.render(), 'ConfirmDialog'),
    'returning restores the pending confirmation without deleting anything',
  );
});

test('project resolver hides stale directories, retains name-only hosts and does not resolve hidden views', async () => {
  const h = workspaceHarness();
  const resolver = h.createResolverHost({
    cwd: '/a',
    name: 'Frontend',
    visible: false,
    serviceId: 'service-a',
  });
  resolver.render();
  assert.equal(resolver.calls.length, 0);
  resolver.props.visible = true;
  resolver.render();
  assert.equal(resolver.calls.length, 1);
  resolver.calls[0].resolve({ id: 'a', name: 'Frontend', path: '/a' });
  await new Promise(setImmediate);
  const first = find(resolver.render(), 'AgentWorkspace');
  assert(first.props.shell);
  assert.equal(first.props.project.id, 'a');
  assert.equal(h.workbench.serviceAgentProjects['service-a'].project.id, 'a');
  assert.equal(h.workbench.serviceAgentProjects['service-a'].cwd, '/a');
  resolver.props.name = 'Renamed';
  assert.equal(find(resolver.render(), 'AgentWorkspace').key, first.key);
  resolver.calls[1].reject(new Error('Temporary resolution failure'));
  await new Promise(setImmediate);
  assert.equal(
    find(resolver.render(), 'AgentWorkspace').key,
    first.key,
    'a name refresh error does not destroy drafts',
  );
  buttonNamed(resolver.render(), 'Retry loading project sessions').props.onClick();
  resolver.render();
  resolver.calls[2].resolve({ id: 'a', name: 'Renamed', path: '/a' });
  await new Promise(setImmediate);
  assert.equal(find(resolver.render(), 'AgentWorkspace').key, first.key);
  resolver.props.cwd = '/b';
  assert.equal(
    find(resolver.render(), 'AgentWorkspace'),
    undefined,
    'the old project cannot appear under a new directory',
  );
  resolver.props.cwd = '/c';
  resolver.render();
  resolver.calls[3].resolve({ id: 'b', name: 'Backend', path: '/b' });
  await new Promise(setImmediate);
  assert.equal(
    find(resolver.render(), 'AgentWorkspace'),
    undefined,
    'a late old-directory response is ignored',
  );
  resolver.calls[4].resolve({ id: 'c', name: 'Current', path: '/c' });
  await new Promise(setImmediate);
  assert.equal(find(resolver.render(), 'AgentWorkspace').props.project.id, 'c');
  resolver.props.visible = false;
  resolver.render();
  resolver.props.visible = true;
  resolver.render();
  assert.equal(
    resolver.calls.length,
    5,
    'returning to an already resolved directory does not re-resolve it',
  );
});

test('navigation badge and Inbox share a single workflow read and cancel polling when both hide', async () => {
  const cleanups = [],
    timers = new Map();
  let reads = 0,
    finish;
  const list = () => {
    reads++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const create = (initial) => {
    const state = initial();
    return { getState: () => state, setState: (patch) => Object.assign(state, patch) };
  };
  const hook = load(
    '../src/components/agents/useAgentWorkflowAttention.ts',
    {
      react: { useEffect: (effect) => cleanups.push(effect()) },
      zustand: { create },
      '@/lib/ipc/agentWorkflowIpc': { agentWorkflowIpc: { list } },
      '@/lib/useVisibleStore': { useVisibleStore: (store, selector) => selector(store.getState()) },
      './agentWorkflowAttention': attention,
      './agentWorkflowGraph': graph,
    },
    {
      setTimeout: (callback) => {
        const id = randomUUID();
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  hook.useAgentWorkflowAttention();
  hook.useAgentWorkflowAttention();
  assert.equal(reads, 1);
  finish([workflow('review', { stage: 'awaiting_review' })]);
  await new Promise(setImmediate);
  assert.equal(timers.size, 1);
  cleanups[0]();
  assert.equal(timers.size, 1);
  cleanups[1]();
  assert.equal(timers.size, 0);
});

test('a workspace opens its own overview and creates tasks in the same scope', () => {
  const h = workspaceHarness('overview');
  const workspace = {
    id: 'multi',
    name: 'Full stack',
    path: '/project',
    workspace: { members: [] },
  };
  h.agents.projects.push(workspace);
  h.agents.projectFilter = workspace.id;
  const tree = h.render();
  const overview = find(tree, 'WorkspaceOverview');
  assert.equal(overview.props.project.id, workspace.id);
  assert.equal(find(tree, 'AgentMissionControl'), undefined);
  overview.props.onNewTask();
  const composer = find(h.render(), 'AgentNewSession');
  assert(composer);
  assert.equal(h.workbench.agentView, 'conversations');
  assert.equal(h.agents.projectFilter, workspace.id);
});
