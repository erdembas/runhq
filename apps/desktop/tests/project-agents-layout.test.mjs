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

test('new run layouts separate command logs from terminals and keep project resources outside the runtime', () => {
  const { defaultLayoutState, listGroups } = setup();
  const state = defaultLayoutState(['dev', 'test']);
  assert.equal(state.root.type, 'split');
  assert.equal(state.root.orientation, 'vertical');
  const groups = listGroups(state.root);
  const logs = groups.find((group) => group.tabs.some((id) => state.tabs[id].kind === 'logs'));
  const terminals = groups.find((group) =>
    group.tabs.some((id) => state.tabs[id].kind === 'terminal'),
  );
  assert.notEqual(logs.id, terminals.id);
  assert.equal(state.tabs[logs.activeTab].commandName, 'dev');
  assert.deepEqual(Array.from(Object.values(state.tabs), (tab) => tab.kind).sort(), [
    'logs',
    'logs',
    'terminal',
  ]);
  assert.equal(state.tabs.agents, undefined);
  assert.equal(state.tabs.docs, undefined);
  assert.equal(state.tabs.notes, undefined);
});

test('saved legacy resource tabs and custom split geometry survive hydration without introducing tabs', () => {
  const { defaultLayoutState, layoutReducer, saveLayout, loadLayout, listGroups } = setup();
  let legacy = layoutReducer(defaultLayoutState(['dev']), { type: 'restore-tab', kind: 'agents' });
  legacy = layoutReducer(legacy, { type: 'rename-tab', tabId: 'terminal-1', title: 'API shell' });
  legacy = layoutReducer(legacy, {
    type: 'resize-split',
    splitId: legacy.root.id,
    sizes: [61, 39],
  });
  const agentsGroup = listGroups(legacy.root).find((group) => group.tabs.includes('agents'));
  legacy = layoutReducer(legacy, {
    type: 'activate-tab',
    groupId: agentsGroup.id,
    tabId: 'agents',
  });
  saveLayout('project-a', legacy);
  const loaded = loadLayout('project-a', ['dev']);
  assert.equal(JSON.stringify(loaded), JSON.stringify(legacy));
  assert.equal(loaded.tabs['terminal-1'].title, 'API shell');
  assert.equal(loaded.tabs.agents.kind, 'agents');
});

test('closed legacy resources stay closed while another project starts with its own runtime', () => {
  const { defaultLayoutState, layoutReducer, saveLayout, loadLayout, listGroups } = setup();
  const withLegacy = layoutReducer(defaultLayoutState(), { type: 'restore-tab', kind: 'agents' });
  const closed = layoutReducer(withLegacy, { type: 'close-tab', tabId: 'agents' });
  saveLayout('project-a', closed);
  assert.equal(loadLayout('project-a').tabs.agents, undefined);
  assert.equal(loadLayout('project-b').tabs.agents, undefined);
  const restored = layoutReducer(loadLayout('project-a'), { type: 'restore-tab', kind: 'agents' });
  const again = layoutReducer(restored, { type: 'restore-tab', kind: 'agents' });
  assert.equal(
    listGroups(again.root)
      .flatMap((g) => Array.from(g.tabs))
      .filter((id) => id === 'agents').length,
    1,
  );
  assert.equal(loadLayout('project-b').tabs['terminal-1'].title, 'Terminal 1');
});
