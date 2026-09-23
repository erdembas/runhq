import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

function setup() {
  const storage = new Map();
  const modules = new Map();
  const load = (path) => {
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, {
      exports,
      require: (name) => load(resolve(dirname(path), `${name}.ts`)),
      window: {
        localStorage: {
          getItem: (key) => storage.get(key),
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
      },
    });
    return exports;
  };
  const root = fileURLToPath(new URL('../src/components/layout/', import.meta.url));
  return {
    ...load(resolve(root, 'layoutModel.ts')),
    ...load(resolve(root, 'layoutPersistence.ts')),
  };
}

test('new project layouts contain an Agents tab without changing the initial command view', () => {
  const { defaultLayoutState } = setup();
  const state = defaultLayoutState(['dev']);
  assert.equal(state.tabs.agents.kind, 'agents');
  assert(state.root.tabs.includes('agents'));
  assert.equal(state.tabs[state.root.activeTab].commandName, 'dev');
});

test('existing split layouts gain Agents while retaining pane positions and active tabs', () => {
  const { defaultLayoutState, layoutReducer, saveLayout, loadLayout, listGroups } = setup();
  let legacy = layoutReducer(defaultLayoutState(['dev']), { type: 'close-tab', tabId: 'agents' });
  legacy.closedKinds = []; // The pre-Agents schema had no entry for this tab.
  legacy = layoutReducer(legacy, {
    type: 'split-tab',
    tabId: 'terminal-1',
    targetGroupId: 'root',
    edge: 'right',
  });
  legacy = layoutReducer(legacy, { type: 'rename-tab', tabId: 'terminal-1', title: 'API shell' });
  saveLayout('project-a', legacy);
  const loaded = loadLayout('project-a', ['dev']);
  assert.equal(loaded.root.type, 'split');
  assert.equal(loaded.tabs['terminal-1'].title, 'API shell');
  for (const oldGroup of listGroups(legacy.root)) {
    const group = listGroups(loaded.root).find((g) => g.id === oldGroup.id);
    assert.equal(group.activeTab, oldGroup.activeTab);
    assert.deepEqual(
      Array.from(group.tabs).filter((id) => id !== 'agents'),
      Array.from(oldGroup.tabs),
    );
  }
  assert.equal(
    listGroups(loaded.root)
      .flatMap((g) => Array.from(g.tabs))
      .filter((id) => id === 'agents').length,
    1,
  );
});

test('closing, restoring and persisting project Agents never creates duplicates or affects another project', () => {
  const { defaultLayoutState, layoutReducer, saveLayout, loadLayout, listGroups } = setup();
  const closed = layoutReducer(defaultLayoutState(), { type: 'close-tab', tabId: 'agents' });
  saveLayout('project-a', closed);
  assert.equal(loadLayout('project-a').tabs.agents, undefined);
  assert.equal(loadLayout('project-b').tabs.agents.kind, 'agents');
  const restored = layoutReducer(loadLayout('project-a'), { type: 'restore-tab', kind: 'agents' });
  const again = layoutReducer(restored, { type: 'restore-tab', kind: 'agents' });
  const group = listGroups(again.root).find((g) => g.tabs.includes('agents'));
  const active = layoutReducer(again, { type: 'activate-tab', groupId: group.id, tabId: 'agents' });
  saveLayout('project-a', active);
  assert.equal(
    listGroups(loadLayout('project-a').root).find((g) => g.id === group.id).activeTab,
    'agents',
  );
  assert.equal(
    listGroups(active.root)
      .flatMap((g) => Array.from(g.tabs))
      .filter((id) => id === 'agents').length,
    1,
  );
});
