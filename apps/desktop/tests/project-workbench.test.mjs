import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(name) {
  const exports = {};
  const source = readFileSync(
    new URL(`../src/components/workbench/${name}.ts`, import.meta.url),
    'utf8',
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports },
  );
  return exports;
}
const { projectTerminalId, createProjectCommandQueue } = load('projectTerminalModel');
const { recentProjectTasks } = load('projectWorkbenchModel');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('project-local terminal tabs never share a PTY across projects', () => {
  assert.notEqual(
    projectTerminalId('frontend', 'terminal-1'),
    projectTerminalId('backend', 'terminal-1'),
  );
  assert.notEqual(projectTerminalId('a:b', 'c'), projectTerminalId('a', 'b:c'));
  assert.equal(
    projectTerminalId('frontend', 'terminal-1'),
    projectTerminalId('frontend', 'terminal-1'),
  );
});

test('documentation commands wait for the correct PTY to become ready and keep input order', async () => {
  const writes = [];
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createProjectCommandQueue(async (id, command) => {
    writes.push([id, command]);
    if (command === 'first') await first;
  });
  queue.enqueue('project-a', 'first');
  queue.enqueue('project-a', 'second');
  queue.ready('project-b');
  await tick();
  assert.equal(writes.length, 0);
  queue.ready('project-a');
  await tick();
  assert.deepEqual(writes, [['project-a', 'first']]);
  releaseFirst();
  await tick();
  assert.deepEqual(writes, [
    ['project-a', 'first'],
    ['project-a', 'second'],
  ]);
});

test('closed terminals discard pending document commands and write errors are reported', async () => {
  const errors = [];
  let calls = 0;
  const queue = createProjectCommandQueue(async () => {
    calls++;
    throw new Error('PTY stopped');
  });
  queue.onError((error) => errors.push(String(error)));
  queue.enqueue('project-a', 'stale');
  queue.closed('project-a');
  queue.ready('project-a');
  await tick();
  assert.equal(calls, 0);
  queue.enqueue('project-a', 'new');
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['Error: PTY stopped']);
});

test('project recent tasks include isolated worktrees, exclude archived and unrelated tasks, and sort by recency', () => {
  const projects = [
    { id: 'a', name: 'same-name', path: '/repo/a/' },
    { id: 'b', name: 'same-name', path: '/repo/b' },
  ];
  const sessions = {
    old: { id: 'old', project_id: 'a', cwd: '/repo/a', updated_at: 1, archived: false },
    isolated: {
      id: 'isolated',
      project_id: 'a',
      cwd: '/worktrees/isolated',
      updated_at: 4,
      archived: false,
    },
    archived: { id: 'archived', project_id: 'a', cwd: '/repo/a', updated_at: 5, archived: true },
    other: { id: 'other', project_id: 'b', cwd: '/repo/b', updated_at: 6, archived: false },
  };
  assert.deepEqual(
    Array.from(recentProjectTasks('/repo/a', projects, sessions), (task) => task.id),
    ['isolated', 'old'],
  );
});

function gitNavigationStores() {
  const workbenchModule = {};
  const fakeCreate = (initializer) => {
    let state;
    const setState = (change) => {
      state = { ...state, ...(typeof change === 'function' ? change(state) : change) };
    };
    const store = (selector) => selector(state);
    store.getState = () => state;
    store.setState = setState;
    state = initializer(setState, store.getState);
    return store;
  };
  const compile = (path, exports, require) =>
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      { exports, require },
    );
  compile('../src/store/useWorkbenchStore.ts', workbenchModule, (name) => {
    assert.equal(name, 'zustand');
    return { create: fakeCreate };
  });
  const uiModule = {};
  compile('../src/store/slices/uiSlice.ts', uiModule, (name) => {
    if (name === '@/store/useWorkbenchStore') return workbenchModule;
    if (name === '@/store/appStoreTypes')
      return { mainTabKey: (tab) => `${tab.kind}:${tab.refId ?? ''}` };
    if (name === '@/store/appStoreRuntime')
      return {
        loadRightPanel: () => null,
        loadRightPanelWidth: () => 320,
        loadSidebarPinned: () => true,
      };
    throw new Error(`Unexpected import ${name}`);
  });
  let app;
  const set = (change) => {
    app = { ...app, ...(typeof change === 'function' ? change(app) : change) };
  };
  app = {
    ...uiModule.createUiSlice(set, () => app),
    setSelected: (id) => set({ selectedServiceId: id, activeMainTabKey: `service:${id}` }),
  };
  return { workbench: workbenchModule.useWorkbenchStore, app: () => app };
}

test('legacy Git entry points route to the correct project without opening an overlay or changing cross-project review', () => {
  const { workbench, app } = gitNavigationStores();
  app().openCrossProjectDiff();
  app().openDiffViewer('frontend', 'history');
  assert.equal(app().activeMainTabKey, 'service:frontend');
  assert.equal(app().diffViewerOpen, false);
  assert.equal(app().crossProjectDiffOpen, true); // Caller still owns the workspace review.
  assert.equal(workbench.getState().projectSections.frontend, 'git');
  assert.equal(workbench.getState().projectGitRequests.frontend.tab, 'history');
  app().closeCrossProjectDiff();
  assert.equal(app().crossProjectDiffOpen, false);
});

test('Git deep links carry independent per-project revisions and repeated requests remain actionable', () => {
  const { workbench, app } = gitNavigationStores();
  app().openDiffViewer('frontend', 'history');
  const frontend = workbench.getState().projectGitRequests.frontend;
  app().openDiffViewer('backend', 'branches');
  assert.equal(workbench.getState().projectGitRequests.frontend, frontend);
  assert.equal(workbench.getState().projectGitRequests.backend.tab, 'branches');
  app().openDiffViewer('frontend', 'history');
  assert.equal(workbench.getState().projectGitRequests.frontend.revision, frontend.revision + 1);
  app().openDiffViewer('frontend');
  assert.equal(workbench.getState().projectGitRequests.frontend.tab, 'commit');
  assert.equal(workbench.getState().projectGitRequests.backend.tab, 'branches');
});
