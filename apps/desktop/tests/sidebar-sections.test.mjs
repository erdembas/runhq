import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

function harness() {
  const saved = new Map();
  const localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  let nextId = 0;
  const load = (file, imports = {}) => {
    const exports = {};
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        window: { localStorage },
        crypto: { randomUUID: () => String(++nextId) },
        require: (name) => {
          if (name in imports) return imports[name];
          throw new Error(`Unexpected import ${name}`);
        },
      },
    );
    return exports;
  };
  const sectionsRuntime = load('../src/store/runtime/appStoreSections.ts');
  const prefsRuntime = load('../src/store/runtime/appStorePrefs.ts');
  const runtime = { ...sectionsRuntime, ...prefsRuntime };
  const colors = load('../src/lib/sectionColors.ts');
  const sections = load('../src/store/slices/sectionsSlice.ts', {
    '@/lib/sectionColors': colors,
    '@/store/appStoreRuntime': runtime,
  });
  const filters = load('../src/store/slices/filterSlice.ts', {
    '@/store/appStoreRuntime': runtime,
  });
  const store = create((...args) => ({
    ...sections.createSectionsSlice(...args),
    ...filters.createFilterSlice(...args),
  }));
  const navigation = load('../src/components/sidebar/sectionNavigation.ts', {
    '@/store/useAppStore': { useAppStore: store },
  });
  return {
    store,
    saved,
    ...navigation,
    reloadSections: () => load('../src/store/runtime/appStoreSections.ts').initialSections,
  };
}

for (const kind of ['service', 'stack']) {
  test(`creating and moving a ${kind} reveals its section without resetting filters or existing organization`, () => {
    const h = harness();
    const original = h.store.getState().addSection('Existing', 'blue');
    h.store.getState().assignServiceToSection('old-project', original);
    h.store.getState().toggleSectionCollapsed(original);
    h.store.getState().setSidebarGroupBy('runtime');
    h.store.getState().setRuntimeFilter(['node']);
    h.store.getState().setSidebarStatusFilter('running');
    h.store.getState().setSearch('does not match');
    const id = h.createVisibleSection('  New group  ', 'green', { kind, id: 'moved-item' });
    const state = h.store.getState();
    assert.equal(state.sidebarGroupBy, 'none');
    assert.equal(state.search, '');
    assert.equal(state.sidebarStatusFilter, 'running');
    assert.deepEqual(Array.from(state.runtimeFilter), ['node']);
    assert.equal(state.sections.find((section) => section.id === id).name, 'New group');
    assert.equal(
      (kind === 'service' ? state.serviceSection : state.stackSection)['moved-item'],
      id,
    );
    assert.equal(state.serviceSection['old-project'], original);
    assert.equal(state.collapsedSections[original], true);
    const saved = h.reloadSections();
    assert.equal(saved.sections.length, 2);
    assert.equal(
      (kind === 'service' ? saved.serviceSection : saved.stackSection)['moved-item'],
      id,
    );
    assert.deepEqual(Array.from(saved.sectionItemOrder[original]), ['service:old-project']);
    assert.deepEqual(Array.from(saved.sectionItemOrder[id]), [`${kind}:moved-item`]);
    assert.equal(JSON.parse(h.saved.get('runhq.sidebar.prefs.v1')).groupBy, 'none');
  });
}

test('showing sections returns to the custom tree and can expand only the requested group', () => {
  const h = harness();
  const id = h.store.getState().addSection('Clients', 'purple');
  h.store.getState().toggleSectionCollapsed(id);
  h.store.getState().setSidebarGroupBy('status');
  h.store.getState().setSearch('old query');
  const sectionRecord = h.store.getState().sections;
  h.showSidebarSections(id);
  assert.equal(h.store.getState().sidebarGroupBy, 'none');
  assert.equal(h.store.getState().search, '');
  assert.equal(Boolean(h.store.getState().collapsedSections[id]), false);
  assert.equal(h.store.getState().sections, sectionRecord);
});

test('empty creation does not change navigation or persisted sections', () => {
  const h = harness();
  h.store.getState().setSidebarGroupBy('category');
  h.store.getState().setSearch('keep');
  const before = h.store.getState();
  assert.equal(h.createVisibleSection('   ', 'blue'), null);
  assert.equal(h.store.getState(), before);
  assert.equal(h.saved.has('runhq.sections.v1'), false);
});
