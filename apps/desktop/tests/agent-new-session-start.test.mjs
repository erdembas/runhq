import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);
const project = { id: 'project', name: 'Project', path: '/project' };
const defaults = {
  backend: 'opencode',
  model: 'selected-model',
  effort: 'high',
  mode: 'default',
  agent: 'build',
  executable: '',
  isolated: false,
};
const active = {
  id: 'active',
  project_id: project.id,
  title: 'Existing work',
  backend: 'opencode',
  status: 'running',
  updated_at: 1,
};

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [
    node,
    ...['children', 'controls', 'action', 'footer'].flatMap((key) => nodes(node.props?.[key])),
  ];
}
const control = (tree, type) =>
  nodes(tree).find((node) => node.type === type || node.type?.name === type);

// Exercise the real composer, start-time dialog and durable launcher together. Only
// the React host, stores and external IPC are replaced, as in chat-defaults tests.
function harness({ recovery: saved, activeTasks = [active] } = {}) {
  let hooks;
  let cursor;
  let effects;
  let changed;
  const react = {
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
      if (!hooks[index] || deps.some((dep, i) => !Object.is(dep, hooks[index][i]))) {
        hooks[index] = deps;
        effects.push(effect);
      }
    },
    useMemo: (factory) => factory(),
  };
  const h = { created: [], started: [], queued: [], opened: [], failStarts: 0, closed: 0 };
  const records = new Map(saved ? [[project.id, plain(saved)]] : []);
  h.recovery = {
    load: (id) => (records.has(id) ? plain(records.get(id)) : null),
    save: (record, id) => {
      if (record) records.set(id, plain(record));
      else records.delete(id);
    },
  };
  const store = {
    projects: [project],
    projectFilter: '',
    drafts: { 'new-task:project': 'Original message' },
    sessions: Object.fromEntries(
      [...activeTasks, ...(saved?.session ? [saved.session] : [])].map((task) => [task.id, task]),
    ),
    tools: [{ id: 'opencode', name: 'OpenCode', adapter: 'opencode', available: true }],
    setDraft: (id, text) => {
      store.drafts[id] = text;
    },
    merge: (session) => {
      store.sessions[session.id] = session;
    },
    retryDraftPersistence: () => {},
    select: (id) => h.opened.push(id),
  };
  const library = {
    ready: true,
    records: { 'preferences:new-agent-chat': { value: defaults } },
    save: async () => {},
  };
  const queues = { queues: {}, persistenceError: null };
  const bind = (state) => Object.assign((selector) => selector(state), { getState: () => state });
  const ipc = {
    agentCreate: async (input) => {
      h.created.push(plain(input));
      return { ...input, id: 'new-task', status: 'idle', updated_at: 2 };
    },
    agentStart: async (turn) => {
      h.started.push(plain(turn));
      if (h.failStarts-- > 0) throw new Error('Lost acknowledgement');
      if (activeTasks.length && !turn.allow_parallel_checkout)
        throw new Error('Another agent owns this checkout');
      return { ...store.sessions[turn.session_id], status: 'running' };
    },
  };
  const locals = {
    '@/store/useAgentStore': { useAgentStore: bind(store) },
    '@/store/useAgentLibraryStore': { useAgentLibraryStore: bind(library) },
    '@/store/useAppStore': { useAppStore: { getState: () => ({ openSettings: () => {} }) } },
    '@/lib/useVisibleStore': { useVisibleStore: (store, select) => select(store.getState()) },
    '@/lib/ipc': { ipc },
    '@/store/useAgentQueueStore': {
      useAgentQueueStore: bind(queues),
      agentTurnQueue: {
        enqueue: (turn) => {
          h.queued.push(plain(turn));
          (queues.queues[turn.session_id] ??= []).push(turn);
          return true;
        },
      },
    },
    './agentSendRecovery': { initialAgentTaskRecovery: h.recovery },
    './useAgentDiscovery': { useAgentDiscovery: () => ({ ready: true, loading: false }) },
    './useAgentProjectOptions': { useAgentProjectOptions: () => [] },
    './useAgentContext': {
      useAgentContext: () => ({ ready: true, entries: [], clear: async () => {} }),
    },
    './agentLibraryModel': {
      buildAgentContextPrompt: (input) => input,
      agentContextImages: () => [],
    },
    './useAgentCatalog': {
      useAgentCatalog: () => ({
        catalog: {
          models: [{ id: defaults.model, name: defaults.model, efforts: ['high'] }],
          modes: ['default'],
          agents: ['build'],
          commands: [],
        },
        loading: false,
        error: null,
      }),
    },
    '@/components/ui/Dialog': { Dialog: 'Dialog' },
    '@/components/ui/Choice': { Radio: 'Radio' },
  };
  const cache = new Map();
  let ui = {};
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        crypto: { randomUUID },
        document: { body: {}, addEventListener() {}, removeEventListener() {} },
        require: (name) => {
          if (name === '@/components/workspaces/useWorkspaceTaskMembers')
            return load('../src/components/workspaces/useWorkspaceTaskMembers.ts');
          if (name === '@/lib/agentRecoveryPersistence')
            return load('../src/lib/agentRecoveryPersistence.ts');
          if (name === 'react') return react;
          if (name === 'react-dom') return { createPortal: (child) => child };
          if (name === 'react/jsx-runtime')
            return {
              jsx: (type, props) => ({ type, props }),
              jsxs: (type, props) => ({ type, props }),
            };
          if (name === '@runhq/cockpit-ui')
            return new Proxy(ui, { get: (target, name) => target[name] ?? name });
          if (locals[name]) return locals[name];
          if (name === '@/lib/useMessageSendShortcut')
            return load('../src/lib/useMessageSendShortcut.ts');
          if (name === '@/store/useShellUiStore')
            return { useShellUiStore: (select) => select({ viewShortcuts: null }) };
          if (
            [
              './agentChatDefaults',
              './agentTaskLauncher',
              './agentWorkflowLaunch',
              './AgentWorkflowLaunchDialog',
            ].includes(name)
          )
            return load(
              `../src/components/agents/${name.slice(2)}.${name.includes('Dialog') ? 'tsx' : 'ts'}`,
            );
          return {};
        },
      },
    );
    return exports;
  }
  ui = {
    ...load('../../../packages/cockpit-ui/src/lib/agentDiscovery.ts'),
    ...load('../../../packages/cockpit-ui/src/components/agentStatus.ts'),
  };
  function host(component, props = {}) {
    const state = [];
    return {
      render: () => {
        let tree;
        let count = 0;
        do {
          hooks = state;
          cursor = 0;
          effects = [];
          changed = false;
          tree = component(props);
          for (const effect of effects) effect();
          assert(++count < 15, 'render loop');
        } while (changed);
        return tree;
      },
    };
  }
  h.composer = () => {
    const wrapper = host(load('../src/components/agents/AgentNewSession.tsx').AgentNewSession, {
      onClose: () => h.closed++,
    });
    const child = wrapper.render();
    return host(child.type, child.props);
  };
  h.choose = async (composer, mode) => {
    const dialogNode = control(composer.render(), 'AgentWorkflowLaunchDialog');
    assert(dialogNode, 'sending while another task is active must offer the timing dialog');
    const dialog = host(dialogNode.type, dialogNode.props);
    const radio = nodes(dialog.render()).find(
      (node) => node.type === 'Radio' && node.props.value === mode,
    );
    radio.props.onChange();
    const label = mode === 'now' ? 'Start now' : 'Queue task';
    const confirm = nodes(dialog.render()).find(
      (node) => node.type === 'button' && node.props.children === label,
    );
    assert.equal(confirm.props.disabled, false);
    confirm.props.onClick();
    await settle();
  };
  h.send = (composer) => control(composer.render(), 'AgentComposer').props.onSend();
  h.store = store;
  return h;
}

test('Start now reaches the backend with explicit checkout permission and the selected workspace', async () => {
  const h = harness();
  const composer = h.composer();
  h.send(composer);
  assert.equal(h.created.length, 0, 'a timing choice is required before creating the task');
  await h.choose(composer, 'now');
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].isolated, false);
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].allow_parallel_checkout, true);
  assert.equal(h.started[0].prompt, 'Original message');
  assert.equal(h.started[0].model, defaults.model);
  assert.deepEqual(h.queued, []);
  assert.deepEqual(h.opened, ['new-task']);
  assert.equal(h.closed, 1);
  assert.equal(h.recovery.load(project.id), null);
});

test('waiting queues the first turn in the selected workspace without concurrent checkout permission', async () => {
  const h = harness();
  const composer = h.composer();
  h.send(composer);
  await h.choose(composer, 'after');
  assert.equal(h.created[0].isolated, false);
  assert.deepEqual(h.started, []);
  assert.equal(h.queued.length, 1);
  assert.notEqual(h.queued[0].allow_parallel_checkout, true);
  assert.deepEqual(h.queued[0].startAfter, { sessionId: active.id, title: active.title });
  assert.deepEqual(h.opened, ['new-task']);
});

test('retry after reload keeps an explicit Start now choice and the original session and request', async () => {
  const h = harness();
  h.failStarts = 1;
  const composer = h.composer();
  h.send(composer);
  await h.choose(composer, 'now');
  assert.equal(h.recovery.load(project.id).turn.allow_parallel_checkout, true);
  assert.deepEqual(h.opened, []);
  h.store.drafts['new-task:project'] = 'Later draft';
  const reopened = h.composer();
  h.send(reopened);
  await settle();
  assert.equal(h.created.length, 1);
  assert.equal(h.started.length, 2);
  assert.deepEqual(h.started[1], h.started[0]);
  assert.equal(h.store.drafts['new-task:project'], 'Later draft');
  assert.deepEqual(h.opened, ['new-task']);
});

function legacyRecovery() {
  const input = { project_id: project.id, ...defaults, title: 'Saved task' };
  const session = { ...input, id: 'saved-task', status: 'running', updated_at: 3 };
  const turn = {
    session_id: session.id,
    request_id: 'saved-request',
    prompt: 'Saved first message',
    model: defaults.model,
    effort: defaults.effort,
    mode: defaults.mode,
    agent: defaults.agent,
  };
  return {
    projectId: project.id,
    creationRequestId: 'saved-creation',
    requestId: turn.request_id,
    input,
    text: turn.prompt,
    draftText: turn.prompt,
    phase: 'sending',
    session,
    turn,
  };
}

test('a saved launch rejected before this fix can explicitly start now without duplicating its task', async () => {
  const saved = legacyRecovery();
  const h = harness({ recovery: saved });
  const composer = h.composer();
  h.send(composer);
  const dialog = control(composer.render(), 'AgentWorkflowLaunchDialog');
  assert(dialog, 'a legacy launch needs a new explicit scheduling decision');
  assert.deepEqual(
    Array.from(dialog.props.tasks, (task) => task.id),
    [active.id],
  );
  await h.choose(composer, 'now');
  assert.deepEqual(h.created, []);
  assert.equal(h.started.length, 1);
  assert.deepEqual(h.started[0], { ...saved.turn, allow_parallel_checkout: true });
  assert.deepEqual(h.queued, []);
  assert.deepEqual(h.opened, [saved.session.id]);
});

test('a saved rejected launch can instead wait using the original task and first message', async () => {
  const saved = legacyRecovery();
  const h = harness({ recovery: saved });
  const composer = h.composer();
  h.send(composer);
  await h.choose(composer, 'after');
  assert.deepEqual(h.created, []);
  assert.deepEqual(h.started, []);
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].session_id, saved.session.id);
  assert.equal(h.queued[0].request_id, saved.turn.request_id);
  assert.equal(h.queued[0].prompt, saved.turn.prompt);
  assert.notEqual(h.queued[0].allow_parallel_checkout, true);
  assert.deepEqual(h.queued[0].startAfter, { sessionId: active.id, title: active.title });
  assert.deepEqual(h.opened, [saved.session.id]);
});

test('an already accepted launch completes cleanup without reopening timing or sending twice', async () => {
  const saved = { ...legacyRecovery(), phase: 'accepted' };
  const h = harness({ recovery: saved });
  const composer = h.composer();
  h.send(composer);
  await settle();
  assert.deepEqual(h.created, []);
  assert.deepEqual(h.started, []);
  assert.deepEqual(h.queued, []);
  assert.deepEqual(h.opened, [saved.session.id]);
});

test('retrying an existing queued launch retains its saved dependency without asking again', async () => {
  const saved = {
    ...legacyRecovery(),
    startAfter: { sessionId: 'original-dependency', title: 'Originally selected task' },
  };
  const h = harness({ recovery: saved });
  h.send(h.composer());
  await settle();
  assert.deepEqual(h.created, []);
  assert.deepEqual(h.started, []);
  assert.equal(h.queued.length, 1);
  assert.deepEqual(h.queued[0].startAfter, saved.startAfter);
  assert.equal(h.queued[0].request_id, saved.turn.request_id);
  assert.deepEqual(h.opened, [saved.session.id]);
});

test('sending without active tasks does not implicitly grant concurrent checkout permission', async () => {
  const h = harness({ activeTasks: [] });
  h.send(h.composer());
  await settle();
  assert.equal(h.started.length, 1);
  assert.notEqual(h.started[0].allow_parallel_checkout, true);
  assert.deepEqual(h.opened, ['new-task']);
});
