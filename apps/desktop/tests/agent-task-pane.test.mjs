import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import { i18n, runInNewContext } from './helpers/i18n-vm.mjs';

const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) =>
  !node || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
const text = (node) =>
  node == null || typeof node === 'boolean'
    ? ''
    : Array.isArray(node)
      ? node.map(text).join('')
      : typeof node === 'object'
        ? text(node.props?.children)
        : String(node);

function load(relative, imports) {
  const exports = {};
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => icon });
        if (name in imports) return imports[name];
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return exports;
}

const session = {
  id: 'task-a',
  project_id: 'project-a',
  project_name: 'Project A',
  title: 'Implement the pool screen',
  cwd: '/isolated/project-a',
  branch: 'task/pool-screen',
  isolated: true,
};

function paneHarness() {
  const calls = [];
  const agent = {
    sessions: { [session.id]: session },
    ready: true,
    error: null,
    refresh: async () => calls.push(['refresh']),
  };
  const workbench = {
    taskOrigins: {},
    taskFocusItems: {},
    focusMode: false,
    setFocusMode: (value) => {
      workbench.focusMode = value;
    },
  };
  const AgentSessionView = () => {};
  const exports = load('../src/components/workbench/AgentTaskPane.tsx', {
    react: { useEffect: (effect) => effect() },
    '@/components/agents/AgentSessionView': { AgentSessionView },
    '@/lib/useVisibleStore': { useVisibleStore: (store, selector) => selector(store.getState()) },
    '@/store/useAgentStore': {
      useAgentStore: { getState: () => agent },
      connectAgents: async () => calls.push(['connect']),
    },
    '@/store/useWorkbenchStore': { useWorkbenchStore: { getState: () => workbench } },
    '@/lib/workbenchNavigation': Object.fromEntries(
      ['openAgentTask', 'openWorkflow', 'requestTaskHandoff'].map((name) => [
        name,
        (...args) => calls.push([name, ...args]),
      ]),
    ),
  });
  return {
    agent,
    workbench,
    calls,
    AgentSessionView,
    render: (visible = true, props = {}) =>
      exports.AgentTaskPane({ sessionId: session.id, visible, ...props }),
  };
}

test('task visibility, focus and language changes retain the same session view identity', () => {
  const h = paneHarness();
  i18n.setLocale('en', false);
  const initial = h.render();
  assert.equal(initial.type, h.AgentSessionView);
  assert.equal(initial.props.session, session);
  assert.equal(initial.key, session.id);
  initial.props.onToggleFocus();
  assert.equal(h.workbench.focusMode, true);
  i18n.setLocale('tr', false);
  const focused = h.render();
  assert.equal(focused.type, initial.type);
  assert.equal(focused.key, initial.key);
  assert.equal(focused.props.focusMode, true);
  const callCount = h.calls.length;
  const hidden = h.render(false);
  assert.equal(hidden.type, initial.type);
  assert.equal(hidden.key, initial.key);
  assert.equal(hidden.props.visible, false);
  assert.equal(h.calls.length, callCount);
  i18n.setLocale('en', false);
});

test('workflow origin, transcript target and handoff carry their exact task context', () => {
  const h = paneHarness();
  assert.equal(h.render().props.onBackToWorkflow, undefined);
  h.workbench.taskOrigins[session.id] = { workflowId: 'workflow-a' };
  h.workbench.taskFocusItems[session.id] = { itemId: 'decision-a', revision: 2 };
  const view = h.render();
  assert.equal(view.props.focusItemId, 'decision-a');
  assert.equal(view.props.focusItemRevision, 2);
  h.workbench.taskFocusItems[session.id] = { itemId: 'decision-a', revision: 3 };
  const repeated = h.render();
  assert.equal(repeated.key, view.key);
  assert.equal(repeated.props.focusItemId, 'decision-a');
  assert.equal(repeated.props.focusItemRevision, 3);
  view.props.onBackToWorkflow();
  const items = [{ id: 'message-a', text: 'Keep this context' }];
  view.props.onHandoff(items);
  view.props.onOpenSession('task-b');
  assert.deepEqual(h.calls.slice(-3), [
    ['openWorkflow', 'workflow-a', session.project_id],
    ['requestTaskHandoff', session.id, items],
    ['openAgentTask', 'task-b'],
  ]);
});

test('an embedded project pane hands off into its local composer without global navigation', () => {
  const h = paneHarness();
  const handedOff = [];
  const items = [{ id: 'message-a', text: 'Keep this project context' }];
  h.render(true, { onHandoff: (selection) => handedOff.push(selection) }).props.onHandoff(items);
  assert.deepEqual(handedOff, [items]);
  assert(!h.calls.some(([name]) => name === 'requestTaskHandoff'));
});

test('missing tasks distinguish initial loading, runtime errors and deletion with a working retry', async () => {
  const h = paneHarness();
  h.agent.sessions = {};
  h.agent.ready = false;
  assert.match(text(h.render()), /Loading task/);
  h.agent.ready = true;
  assert.match(text(h.render()), /Task unavailable/);
  h.agent.error = 'IPC disconnected';
  const failed = h.render();
  assert.match(text(failed), /Could not load this task/);
  assert.match(text(failed), /IPC disconnected/);
  assert(nodes(failed).some((node) => node.props?.role === 'alert'));
  nodes(failed)
    .find((node) => node.type === 'button')
    .props.onClick();
  await new Promise(setImmediate);
  assert(h.calls.some(([call]) => call === 'refresh'));
});

test('compact project identity always shows project, branch and checkout kind and copies the task directory', async () => {
  const copied = [];
  const state = [];
  let cursor = 0;
  let fail = false;
  const { AgentSessionProject } = load('../src/components/agents/AgentSessionProject.tsx', {
    react: {
      useState: (initial) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = value;
          },
        ];
      },
    },
    '@tauri-apps/plugin-clipboard-manager': {
      writeText: async (path) => {
        if (fail) throw new Error('Clipboard unavailable');
        copied.push(path);
      },
    },
  });
  const render = () => {
    cursor = 0;
    return AgentSessionProject({ session });
  };
  let tree = render();
  const summary = nodes(tree).find((node) => node.type === 'summary');
  assert.match(text(summary), /Project A/);
  assert.match(text(summary), /task\/pool-screen/);
  assert.match(text(summary), /Isolated worktree/);
  nodes(tree)
    .find((node) => node.type === 'button')
    .props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(copied, [session.cwd]);
  assert.match(text(render()), /Copied/);
  fail = true;
  nodes(tree)
    .find((node) => node.type === 'button')
    .props.onClick();
  await new Promise(setImmediate);
  assert.match(text(render()), /Could not copy the workspace path/);
  i18n.setLocale('tr', false);
  tree = render();
  assert.match(text(tree), /Çalışma alanı yolu kopyalanamadı/);
  assert.match(text(tree), /Project A/);
  assert.match(text(tree), /\/isolated\/project-a/);
  i18n.setLocale('en', false);
});
