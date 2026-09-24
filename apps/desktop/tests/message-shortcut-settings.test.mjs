import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext, i18n } from './helpers/i18n-vm.mjs';

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [
    node,
    ...nodes(node.props?.children),
    ...nodes(node.props?.toolbar),
    ...nodes(node.props?.footer),
  ];
}

function harness(stored = {}) {
  const hooks = [];
  const effects = [];
  let cursor = 0;
  let preferences = globalThis.structuredClone(stored);
  let tree;
  const published = [];
  const cache = new Map();
  const react = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
        },
      ];
    },
    useEffect: (effect) => {
      const index = cursor++;
      if (!(index in hooks)) {
        hooks[index] = true;
        effects.push(effect);
      }
    },
    useMemo: (factory) => factory(),
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        require: (name) => {
          if (name === 'react') return react;
          if (name === 'react/jsx-runtime')
            return {
              jsx: (type, props) => ({ type, props }),
              jsxs: (type, props) => ({ type, props }),
            };
          if (name === '@/lib/shortcuts') return load('lib/shortcuts.ts');
          if (name === '@/lib/ipc')
            return {
              ipc: {
                getPrefs: async () => preferences,
                updatePrefs: async (value) => {
                  preferences = globalThis.structuredClone(value);
                  return preferences;
                },
              },
            };
          if (name === '@/store/useShellUiStore')
            return {
              useShellUiStore: Object.assign(
                (select) => select({ setViewShortcuts: (value) => published.push(value) }),
                {
                  getState: () => ({ setViewShortcuts: (value) => published.push(value) }),
                },
              ),
            };
          return new Proxy({}, { get: (_, key) => key });
        },
      },
    );
    return exports;
  }
  const { ShortcutsCategory } = load('components/settings/categories/ShortcutsCategory.tsx');
  function render() {
    cursor = 0;
    tree = ShortcutsCategory({});
  }
  return {
    published,
    preferences: () => preferences,
    load,
    render,
    find: (predicate) => nodes(tree).find(predicate),
    async flush() {
      for (const effect of effects.splice(0)) effect();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
  };
}

test('message shortcut saves, publishes immediately, and reloads without changing other bindings', async () => {
  const h = harness({ shortcuts: { quick_action: 'CmdOrCtrl+Shift+J' } });
  h.render();
  await h.flush();
  const select = () => h.find((node) => node.type === 'select');
  assert.equal(select().props.value, 'Enter');
  select().props.onChange({ target: { value: 'CmdOrCtrl+Enter' } });
  h.render();
  h.find((node) => node.props?.children === 'Save & Apply').props.onClick();
  await h.flush();
  assert.equal(h.preferences().shortcuts.send_message, 'CmdOrCtrl+Enter');
  assert.equal(h.preferences().shortcuts.quick_action, 'CmdOrCtrl+Shift+J');
  assert.equal(h.published.at(-1).send_message, 'CmdOrCtrl+Enter');
  const reloaded = harness(h.preferences());
  reloaded.render();
  await reloaded.flush();
  assert.equal(reloaded.find((node) => node.type === 'select').props.value, 'CmdOrCtrl+Enter');
});

test('message shortcut participates in localized search and Reset All without entering window dispatch', async () => {
  i18n.setLocale('tr');
  try {
    const h = harness({ shortcuts: { send_message: 'CmdOrCtrl+Enter' } });
    h.render();
    await h.flush();
    h.find((node) => node.type === 'input').props.onChange({
      target: { value: i18n.t('Send message with') },
    });
    h.render();
    assert.ok(h.find((node) => node.type === 'select'));
    h.find((node) => node.props?.children === i18n.t('Reset All')).props.onClick();
    h.render();
    assert.equal(h.find((node) => node.type === 'select').props.value, 'Enter');
    assert.equal(
      h
        .load('lib/shortcuts.ts')
        .SHORTCUT_CATALOG.some((shortcut) => shortcut.id === 'send_message'),
      false,
    );
  } finally {
    i18n.setLocale('en');
  }
});
