import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { create } from 'zustand';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const saved = new Map();
  const localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  const load = (file, imports = {}) => {
    const exports = {};
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        window: { localStorage },
        localStorage,
        require: (name) => {
          if (name === 'zustand') return { create };
          if (name in imports) return imports[name];
          throw new Error(`Unexpected import ${name}`);
        },
      },
    );
    return exports;
  };
  const types = load('../src/store/types/mainTabTypes.ts');
  const panels = load('../src/store/runtime/appStorePanels.ts', {
    '@/store/appStoreTypes': types,
  });
  const close = load('../src/store/slices/mainTabCloseSlice.ts', {
    '@/store/appStoreTypes': types,
    '@/store/appStoreRuntime': panels,
  });
  const tabs = load('../src/store/slices/mainTabSlice.ts', {
    '@/store/appStoreTypes': types,
    '@/store/appStoreRuntime': panels,
    '@/store/slices/mainTabCloseSlice': close,
  });
  const app = create((...args) => ({
    services: [{ id: 'service-a', name: 'App', cwd: '/symlink/app' }],
    settingsCategory: null,
    releaseNotesOpen: false,
    selectedServiceId: null,
    selectedStackId: null,
    selectedCmdName: null,
    ...tabs.createMainTabSlice(...args),
  }));
  const ipcCalls = [];
  const ipc = {
    agentAddProject: async (name, cwd) => {
      ipcCalls.push(['agentAddProject', name, cwd]);
      return { id: 'canonical-project-a', name, path: '/real/app' };
    },
  };
  const recovery = load('../src/lib/agentRecoveryPersistence.ts');
  const artifacts = load('../src/lib/agentLocalArtifacts.ts');
  const { useAgentStore: agent } = load('../src/store/useAgentStore.ts', {
    '@tauri-apps/api/event': { listen: async () => () => {} },
    '@/lib/ipc': { ipc },
    '@/lib/agentLocalArtifacts': artifacts,
    '@/lib/agentRecoveryPersistence': recovery,
    './useAppStore': { useAppStore: app },
  });
  const { useWorkbenchStore: workbench } = load('../src/store/useWorkbenchStore.ts');
  const navigation = load('../src/lib/workbenchNavigation.ts', {
    '@/lib/ipc': { ipc },
    '@/store/useAppStore': { useAppStore: app },
    '@/store/useAgentStore': { useAgentStore: agent },
    '@/store/useWorkbenchStore': { useWorkbenchStore: workbench },
  });
  const task = {
    id: 'task-a',
    project_id: 'project-a',
    cwd: '/symlink/app',
    isolated: false,
    status: 'running',
    unread: false,
  };
  agent.setState({
    sessions: { [task.id]: task },
    projects: [{ id: 'project-a', name: 'App', path: '/symlink/app' }],
    ready: true,
  });
  return { app, agent, workbench, ipc, ipcCalls, navigation, task };
}

test('opening a task uses its project Agents and reopening preserves runtime, draft and workflow origin', () => {
  const h = harness();
  h.agent.getState().setDraft(h.task.id, 'Continue after the running turn');
  h.navigation.openAgentTask(h.task.id, { workflowId: 'workflow-a', focusItemId: 'request-a' });
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'agents');
  assert.equal(h.workbench.getState().projectSelectedSessions['project-a'], h.task.id);
  assert.equal(h.workbench.getState().projectSelectionRevisions['project-a'], 1);
  assert.equal(h.agent.getState().selectedId, null);
  assert(!h.app.getState().mainTabs.some((tab) => tab.kind === 'agent-task'));
  assert.deepEqual(plain(h.workbench.getState().taskOrigins[h.task.id]), {
    workflowId: 'workflow-a',
    projectId: 'project-a',
  });
  assert.equal(h.workbench.getState().taskFocusItems[h.task.id].itemId, 'request-a');
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.workbench.getState().projectSelectionRevisions['project-a'], 2);
  assert.equal(h.app.getState().mainTabs.length, 2);
  h.app.getState().closeMainTab('service:service-a');
  assert.equal(h.app.getState().activeMainTabKey, 'dashboard:dashboard');
  assert.equal(h.agent.getState().sessions[h.task.id], h.task);
  assert.equal(h.agent.getState().sessions[h.task.id].status, 'running');
  assert.equal(h.agent.getState().drafts[h.task.id], 'Continue after the running turn');
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  assert.equal(h.workbench.getState().taskOrigins[h.task.id].workflowId, 'workflow-a');
  assert.deepEqual(h.ipcCalls, []);
});

test('workflow navigation changes scope and repeats the deep link without closing task panes', () => {
  const h = harness();
  h.navigation.openAgentTask(h.task.id);
  h.agent.setState({ projectFilter: 'project-a' });
  h.workbench.getState().setFocusMode(true);
  h.navigation.openWorkflow('workflow-b', 'project-b');
  assert.equal(h.app.getState().activeMainTabKey, 'agents:agents');
  assert.equal(h.agent.getState().projectFilter, 'project-b');
  assert.equal(h.agent.getState().selectedId, null);
  assert.equal(h.workbench.getState().requestedWorkflowId, 'workflow-b');
  assert.equal(h.workbench.getState().agentView, 'workflows');
  assert.equal(h.workbench.getState().focusMode, false);
  const revision = h.workbench.getState().agentViewRevision;
  h.navigation.openWorkflow('workflow-b', 'project-b');
  assert.equal(h.workbench.getState().agentViewRevision, revision + 1);
  assert.equal(h.app.getState().mainTabs.length, 3);
  assert(
    h.app.getState().mainTabs.some((tab) => tab.kind === 'service' && tab.refId === 'service-a'),
  );
});

test('repeated transcript jumps receive new revisions and ordinary task navigation clears the old jump', () => {
  const h = harness();
  h.navigation.openAgentTask(h.task.id, { focusItemId: 'request-a' });
  const first = h.workbench.getState().taskFocusItems[h.task.id];
  h.navigation.openAgentTask(h.task.id, { focusItemId: 'request-a' });
  const repeated = h.workbench.getState().taskFocusItems[h.task.id];
  assert.equal(repeated.itemId, first.itemId);
  assert(repeated.revision > first.revision);
  h.navigation.openAgentTask('task-b', { focusItemId: 'message-b' });
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.workbench.getState().taskFocusItems[h.task.id], undefined);
  assert.equal(h.workbench.getState().taskFocusItems['task-b'].itemId, 'message-b');
  h.app.getState().closeMainTab('service:service-a');
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.workbench.getState().taskFocusItems[h.task.id], undefined);
  h.navigation.openAgentTask(h.task.id, { focusItemId: 'request-a' });
  assert(h.workbench.getState().taskFocusItems[h.task.id].revision > repeated.revision);
});

test('project sections keep a single project tab and agent shortcuts use the backend project identity', async () => {
  const h = harness();
  h.navigation.openProjectSection('service-a', 'git');
  assert.equal(h.app.getState().selectedServiceId, 'service-a');
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  h.navigation.openProjectSection('service-a', 'docs');
  assert.equal(h.app.getState().mainTabs.length, 2);
  assert.equal(h.workbench.getState().projectSections['service-a'], 'docs');
  await h.navigation.openProjectAgentView('service-a', 'workflows');
  assert.equal(h.agent.getState().projectFilter, 'canonical-project-a');
  assert.equal(
    h.agent.getState().projects.find((project) => project.id === 'canonical-project-a').path,
    '/real/app',
  );
  assert.equal(h.workbench.getState().agentView, 'workflows');
  await h.navigation.openProjectAgentView('service-a', 'overview');
  assert.equal(
    h.agent.getState().projects.filter((project) => project.id === 'canonical-project-a').length,
    1,
  );
  h.navigation.openAgentView('inbox', '');
  assert.equal(h.agent.getState().projectFilter, '');
  assert.equal(h.workbench.getState().agentView, 'inbox');
});

test('document shortcuts open the owning project and retain a repeatable cwd-scoped selection', () => {
  const h = harness();
  h.workbench.getState().setFocusMode(true);
  h.navigation.openProjectDoc('service-a', 'README.MD');
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'docs');
  assert.equal(h.workbench.getState().focusMode, false);
  assert.deepEqual(plain(h.workbench.getState().projectDocRequests['service-a']), {
    cwd: '/symlink/app',
    relativePath: 'README.MD',
    revision: 1,
  });
  h.navigation.openProjectSection('service-a', 'overview');
  h.navigation.openProjectDoc('service-a', 'README.MD');
  assert.equal(h.workbench.getState().projectDocRequests['service-a'].revision, 2);
  assert.equal(h.app.getState().mainTabs.length, 2);
  h.app.setState({ services: [{ id: 'service-a', cwd: '/new/project' }] });
  h.navigation.openProjectDoc('service-a', 'readme.md');
  assert.equal(h.workbench.getState().projectDocRequests['service-a'].cwd, '/new/project');
  h.navigation.openProjectDoc('removed-service', 'README.md');
  assert.equal(h.workbench.getState().projectDocRequests['removed-service'], undefined);
});

test('closing the owning project returns to the adjacent project and pinning preserves open work', () => {
  const h = harness();
  h.app.setState({
    services: [...h.app.getState().services, { id: 'service-b', name: 'Second', cwd: '/second' }],
  });
  h.navigation.openAgentTask(h.task.id);
  h.navigation.openProjectSection('service-b', 'run');
  h.app.getState().setActiveMainTab('service:service-a');
  h.app.getState().closeMainTab('service:service-a');
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-b');
  assert.equal(h.app.getState().selectedServiceId, 'service-b');
  h.navigation.openAgentTask(h.task.id);
  h.app.getState().toggleMainTabPin('service:service-a');
  h.app.getState().closeAllMainTabs();
  assert.deepEqual(plain(h.app.getState().mainTabs.map((tab) => tab.kind)), [
    'dashboard',
    'service',
  ]);
  assert.equal(h.agent.getState().sessions[h.task.id], h.task);
  assert.equal(h.agent.getState().sessions[h.task.id].status, 'running');
  assert.equal(h.workbench.getState().projectSelectedSessions['project-a'], h.task.id);
  h.app.getState().closeMainTab('service:service-a');
  assert.equal(h.app.getState().activeMainTabKey, 'dashboard:dashboard');
  assert.equal(h.app.getState().selectedServiceId, null);
});

test('project task shortcuts stay in their project tabs without changing global agent scope', async () => {
  const h = harness();
  h.app.setState({
    services: [
      ...h.app.getState().services,
      { id: 'service-b', name: 'Another app', cwd: '/real/another-app' },
    ],
  });
  h.navigation.openAgentView('workflows', 'global-project');
  const revision = h.workbench.getState().agentViewRevision;
  await h.navigation.openProjectAgentView('service-a', 'conversations');
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'agents');
  h.navigation.openProjectSection('service-a', 'docs');
  await h.navigation.openProjectAgentView('service-b', 'overview');
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-b');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'docs');
  assert.equal(h.workbench.getState().projectSections['service-b'], 'agents');
  await h.navigation.openProjectAgentView('service-a', 'conversations');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'agents');
  assert.equal(h.workbench.getState().agentView, 'workflows');
  assert.equal(h.workbench.getState().agentViewRevision, revision);
  assert.equal(h.agent.getState().projectFilter, 'global-project');
  assert.equal(h.app.getState().mainTabs.length, 4);
  assert.deepEqual(h.ipcCalls, []);
});

test('canonical service bindings route isolated worktrees and prefer the selected matching project tab', () => {
  const h = harness();
  const project = { id: 'project-a', name: 'App', path: '/real/app' };
  h.agent.setState({
    projects: [project],
    sessions: { [h.task.id]: { ...h.task, isolated: true, cwd: '/worktrees/task-a' } },
  });
  h.app.setState({
    services: [
      ...h.app.getState().services,
      { id: 'service-b', name: 'API', cwd: '/other-alias/app' },
    ],
  });
  h.workbench.getState().registerServiceAgentProject('service-a', '/symlink/app', project);
  h.workbench.getState().registerServiceAgentProject('service-b', '/other-alias/app', project);
  h.navigation.openProjectSection('service-b');
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-b');
  assert.equal(h.workbench.getState().projectSections['service-b'], 'agents');
  assert.equal(h.workbench.getState().projectSelectedSessions[project.id], h.task.id);
  assert.deepEqual(h.ipcCalls, []);
  // Editing a service directory invalidates the old canonical binding.
  h.app.setState({ services: [{ id: 'service-b', name: 'API', cwd: '/different/project' }] });
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.app.getState().activeMainTabKey, 'agents:agents');
  assert.equal(h.agent.getState().selectedId, h.task.id);
  assert.equal(h.workbench.getState().agentView, 'conversations');
});

test('agent-only projects open embedded global conversations without adding a task tab', () => {
  const h = harness();
  h.app.setState({ services: [] });
  h.navigation.openAgentTask(h.task.id, { workflowId: 'workflow-a', focusItemId: 'decision-a' });
  assert.equal(h.app.getState().activeMainTabKey, 'agents:agents');
  assert.equal(h.agent.getState().projectFilter, 'project-a');
  assert.equal(h.agent.getState().selectedId, h.task.id);
  assert.equal(h.workbench.getState().agentView, 'conversations');
  assert.equal(h.workbench.getState().taskOrigins[h.task.id].workflowId, 'workflow-a');
  assert.equal(h.workbench.getState().taskFocusItems[h.task.id].itemId, 'decision-a');
  assert.deepEqual(plain(h.app.getState().mainTabs.map((tab) => tab.kind)), [
    'dashboard',
    'agents',
  ]);
  assert.deepEqual(h.ipcCalls, []);
});

test('late canonical resolution cannot replace a more recent navigation or bind an edited service', async () => {
  const h = harness();
  let resolve;
  h.ipc.agentAddProject = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = h.navigation.openProjectAgentView('service-a', 'workflows');
  h.navigation.openProjectSection('service-a', 'notes');
  resolve({ id: 'canonical-a', name: 'App', path: '/real/app' });
  await pending;
  assert.equal(h.app.getState().activeMainTabKey, 'service:service-a');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'notes');
  assert.equal(h.workbench.getState().serviceAgentProjects['service-a'].project.id, 'canonical-a');
  const changed = h.navigation.openProjectAgentView('service-a', 'workflows');
  h.app.setState({ services: [{ id: 'service-a', name: 'New app', cwd: '/new/app' }] });
  resolve({ id: 'wrong-old-project', name: 'Old app', path: '/real/app' });
  await changed;
  assert.equal(h.workbench.getState().serviceAgentProjects['service-a'].project.id, 'canonical-a');
  assert.equal(h.workbench.getState().projectSections['service-a'], 'notes');
});

test('canonical resolution respects a direct main-tab switch while project Tasks retain global selection', async () => {
  const h = harness();
  h.agent.setState({ selectedId: 'global-task', projectFilter: 'global-project' });
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.agent.getState().selectedId, 'global-task');
  assert.equal(h.agent.getState().projectFilter, 'global-project');
  let resolve;
  h.ipc.agentAddProject = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = h.navigation.openProjectAgentView('service-a', 'workflows');
  h.app.getState().setActiveMainTab('dashboard:dashboard');
  resolve({ id: 'canonical-a', name: 'App', path: '/real/app' });
  await pending;
  assert.equal(h.app.getState().activeMainTabKey, 'dashboard:dashboard');
});

test('workspace tasks keep their identity when a service shares their root, including after deletion', () => {
  const h = harness();
  const scope = {
    section_id: 'section-a',
    members: [{ service_id: 'service-a', name: 'App', path: '/symlink/app' }],
  };
  h.agent.setState({
    projects: [{ id: 'project-a', name: 'Workspace', path: '/symlink/app', workspace: scope }],
    sessions: { [h.task.id]: { ...h.task, workspace: scope } },
  });
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.app.getState().activeMainTabKey, 'agents:agents');
  assert.equal(h.agent.getState().projectFilter, 'project-a');
  assert.equal(h.agent.getState().selectedId, h.task.id);
  assert.equal(h.workbench.getState().projectSelectedSessions['project-a'], undefined);
  h.agent.setState({ projects: [] });
  h.navigation.openAgentTask(h.task.id);
  assert.equal(h.app.getState().activeMainTabKey, 'agents:agents');
  assert.equal(h.agent.getState().selectedId, h.task.id);
});
