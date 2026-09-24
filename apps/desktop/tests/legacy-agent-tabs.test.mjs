import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { i18n, runInNewContext } from './helpers/i18n-vm.mjs';

function load(file, modules = {}) {
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
      require: (name) => {
        if (name in modules) return modules[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return exports;
}

const mainTabs = load('../src/store/types/mainTabTypes.ts');
const { visibleMainTabs, migrateLegacyAgentTaskTabs } = load(
  '../src/components/main-tab-bar/legacyAgentTaskTabs.ts',
  { '@/store/types/mainTabTypes': mainTabs },
);

test('global task collection keeps its Tasks label in both overview and conversation views', () => {
  const { resolveTabMeta } = load('../src/components/main-tab-bar/tabMeta.tsx', {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
  });
  try {
    for (const [locale, label] of [
      ['en', 'Tasks'],
      ['tr', 'Görevler'],
    ]) {
      i18n.setLocale(locale, false);
      for (const view of ['overview', 'conversations']) {
        assert.equal(
          resolveTabMeta({ kind: 'agents', refId: 'agents' }, [], [], {}, view).label,
          label,
        );
      }
    }
  } finally {
    i18n.setLocale('en', false);
  }
});

test('obsolete task tabs never appear in the main strip, preserving the other tab identities', () => {
  const tabs = [
    mainTabs.DASHBOARD_TAB,
    { kind: 'agent-task', refId: 'task-a' },
    { kind: 'service', refId: 'service-a' },
    { kind: 'agents', refId: 'agents' },
  ];
  const visible = visibleMainTabs(tabs);
  assert.deepEqual([...visible], [tabs[0], tabs[2], tabs[3]]);
  assert.equal(visible[1], tabs[2]);
  assert.equal(visibleMainTabs(visible), visible, 'normal tabs do not incur a new snapshot');
});

test('active legacy conversation migrates before closing old tabs and never replays afterward', () => {
  let tabs = [
    mainTabs.DASHBOARD_TAB,
    { kind: 'agent-task', refId: 'task-a' },
    { kind: 'agent-task', refId: 'task-b' },
  ];
  let activeKey = 'agent-task:task-a';
  const events = [];
  const open = (id) => {
    events.push(['open', id]);
    tabs = [...tabs, { kind: 'service', refId: 'service-a' }];
    activeKey = 'service:service-a';
  };
  const close = (key) => {
    events.push(['close', key]);
    assert.notEqual(key, activeKey, 'migration must establish the replacement before closing');
    tabs = tabs.filter((tab) => mainTabs.mainTabKey(tab) !== key);
  };
  migrateLegacyAgentTaskTabs(tabs, activeKey, open, close);
  assert.deepEqual(events, [
    ['open', 'task-a'],
    ['close', 'agent-task:task-a'],
    ['close', 'agent-task:task-b'],
  ]);
  assert.equal(activeKey, 'service:service-a');
  migrateLegacyAgentTaskTabs(tabs, activeKey, open, close);
  assert.equal(events.length, 3);
});

test('cleaning inactive legacy tabs preserves the current project without navigating', () => {
  const tabs = [
    mainTabs.DASHBOARD_TAB,
    { kind: 'agent-task', refId: 'task-a' },
    { kind: 'service', refId: 'service-b' },
  ];
  const closed = [];
  migrateLegacyAgentTaskTabs(
    tabs,
    'service:service-b',
    () => assert.fail('inactive old tasks must not steal navigation'),
    (key) => closed.push(key),
  );
  assert.deepEqual(closed, ['agent-task:task-a']);
});

test('embedded conversation focus applies to the active project section and global fallback only', () => {
  const app = { activeMainTabKey: 'service:project-a' };
  const workbench = {
    focusMode: true,
    agentView: 'conversations',
    projectSections: { 'project-a': 'agents', 'project-b': 'run' },
  };
  const { useAgentFocusMode } = load('../src/lib/useAgentFocusMode.ts', {
    '@/store/useAppStore': { useAppStore: (select) => select(app) },
    '@/store/useWorkbenchStore': { useWorkbenchStore: (select) => select(workbench) },
  });
  assert.equal(useAgentFocusMode(), true);
  app.activeMainTabKey = 'service:project-b';
  assert.equal(useAgentFocusMode(), false);
  app.activeMainTabKey = 'agents:agents';
  assert.equal(useAgentFocusMode(), true);
  workbench.agentView = 'workflows';
  assert.equal(useAgentFocusMode(), false);
  workbench.agentView = 'conversations';
  workbench.focusMode = false;
  assert.equal(useAgentFocusMode(), false);
  workbench.focusMode = true;
  app.activeMainTabKey = 'dashboard:dashboard';
  assert.equal(useAgentFocusMode(), false);
});
