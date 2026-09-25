import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { setImmediate } from 'node:timers';
import ts from 'typescript';

function load(relativePath, dependencies = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    ...globals,
    require(id) {
      assert(id in dependencies, `Unexpected import: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
}
const model = load('../src/components/agents/agentNotifications.ts');
const {
  createAgentNotificationTracker,
  relevantAgentNotifications,
  agentNotificationMessage,
  readAgentNotificationPreferences,
} = model;
const session = (status = 'running', extra = {}) => ({
  id: 'task',
  project_id: 'project',
  status,
  revision: 1,
  archived: false,
  unread: false,
  pending: [],
  ...extra,
});

test('delivery coalesces events and rechecks disable or selected-task changes after permission lookup', async () => {
  let listener;
  let cleanup;
  let timer;
  let permissionResolved;
  const delivered = [];
  let state = { sessions: sessions(session()), ready: true, selectedId: null };
  const preferences = { enabled: true, mutedProjects: [] };
  const notificationState = { preferences, setError() {} };
  const { useAgentNotifications } = load(
    '../src/components/app/useAgentNotifications.ts',
    {
      react: {
        useEffect: (effect) => {
          cleanup = effect();
        },
      },
      '@tauri-apps/api/core': {
        isTauri: () => true,
        invoke: async (...args) => {
          delivered.push(args);
        },
      },
      '@tauri-apps/plugin-notification': {
        isPermissionGranted: () =>
          new Promise((resolve) => {
            permissionResolved = resolve;
          }),
      },
      '@/store/useAgentStore': {
        useAgentStore: {
          getState: () => state,
          subscribe: (callback) => {
            listener = callback;
            return () => {
              listener = null;
            };
          },
        },
      },
      '@/store/useAgentNotificationStore': {
        useAgentNotificationStore: { getState: () => notificationState },
      },
      '@/store/useAppStore': {
        useAppStore: { getState: () => ({ activeMainTabKey: 'agents:agents' }) },
      },
      '../agents/agentNotifications': model,
      '../agents/useWorkflowNotifications': { useWorkflowNotifications: () => {} },
    },
    {
      document: { hasFocus: () => true },
      setTimeout: (callback) => {
        timer = callback;
        return 1;
      },
      clearTimeout: () => {
        timer = undefined;
      },
    },
  );
  useAgentNotifications();
  assert.equal(delivered.length, 0, 'initial snapshot is quiet');
  const publish = (next) => {
    state = { ...state, sessions: sessions(next) };
    listener(state);
  };
  publish(session('completed', { revision: 2, unread: true }));
  publish(session('completed', { revision: 3, unread: true }));
  assert.equal(typeof timer, 'function');
  timer();
  preferences.enabled = false;
  permissionResolved(true);
  await new Promise(setImmediate);
  assert.equal(delivered.length, 0, 'disable during lookup cancels delivery');
  preferences.enabled = true;
  publish(session('running', { revision: 4 }));
  publish(session('completed', { revision: 5, unread: true }));
  timer();
  state.selectedId = 'task';
  permissionResolved(true);
  await new Promise(setImmediate);
  assert.equal(delivered.length, 0, 'opening task during lookup cancels delivery');
  state.selectedId = null;
  publish(session('running', { revision: 6 }));
  publish(session('completed', { revision: 7, unread: true }));
  publish(session('completed', { revision: 8, unread: true }));
  timer();
  permissionResolved(true);
  await new Promise(setImmediate);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][0], 'plugin:notification|notify');
  assert.match(delivered[0][1].options.body, /1 task has a new response/);
  cleanup();
  assert.equal(listener, null);
});
const sessions = (...values) => Object.fromEntries(values.map((value) => [value.id, value]));
const plain = (value) => JSON.parse(JSON.stringify(value));

test('startup, imported tasks and restored pending decisions never replay notification history', () => {
  const track = createAgentNotificationTracker();
  assert.equal(track(sessions(session('completed', { unread: true })), false).length, 0);
  assert.equal(
    track(sessions(session('waiting_input', { pending: [{ id: 'existing' }] })), true).length,
    0,
  );
  const next = sessions(
    session('waiting_input', { revision: 2, pending: [{ id: 'existing' }] }),
    session('completed', { id: 'imported', unread: true }),
  );
  assert.equal(track(next, true).length, 0);
});

test('decisions notify once; token updates, changed timestamps and waiting status echoes stay quiet', () => {
  const track = createAgentNotificationTracker();
  track(sessions(session()), true);
  const blocked = session('running', { revision: 2, pending: [{ id: 'request-1' }] });
  assert.equal(track(sessions(blocked), true)[0].kind, 'blocked');
  assert.equal(
    track(
      sessions({ ...blocked, revision: 3, status: 'waiting_permission', updated_at: 100 }),
      true,
    ).length,
    0,
  );
  assert.equal(
    track(
      sessions({ ...blocked, revision: 4, pending: [{ id: 'request-1' }, { id: 'request-2' }] }),
      true,
    ).length,
    1,
  );
  assert.equal(track(sessions({ ...blocked, revision: 5, pending: [] }), true).length, 0);
});

test('waiting status without a request emits once, and later request details do not notify again', () => {
  const track = createAgentNotificationTracker();
  track(sessions(session()), true);
  assert.equal(track(sessions(session('waiting_input', { revision: 2 })), true).length, 1);
  assert.equal(
    track(sessions(session('waiting_input', { revision: 3, pending: [{ id: 'request' }] })), true)
      .length,
    0,
  );
});

test('failure and completion transitions emit once; later turns may emit their own result', () => {
  const track = createAgentNotificationTracker();
  track(sessions(session()), true);
  assert.equal(
    track(sessions(session('completed', { revision: 2, unread: true })), true)[0].kind,
    'completed',
  );
  assert.equal(
    track(sessions(session('completed', { revision: 3, unread: true })), true).length,
    0,
  );
  assert.equal(
    track(sessions(session('completed', { revision: 4, unread: false })), true).length,
    0,
  );
  track(sessions(session('running', { revision: 5 })), true);
  assert.equal(
    track(sessions(session('failed', { revision: 6, unread: true })), true)[0].kind,
    'failed',
  );
  assert.equal(track(sessions(session('failed', { revision: 7, unread: false })), true).length, 0);
  track(sessions(session('running', { revision: 8 })), true);
  assert.equal(
    track(sessions(session('completed', { revision: 9, unread: true })), true).length,
    1,
  );
});

test('mute, disable, active task, read receipt, archive and resolved decisions suppress delivery', () => {
  const event = { kind: 'completed', sessionId: 'task', projectId: 'project' };
  const completed = sessions(session('completed', { unread: true }));
  assert.equal(
    relevantAgentNotifications([event], completed, { enabled: false, mutedProjects: [] }).length,
    0,
  );
  assert.equal(
    relevantAgentNotifications([event], completed, { enabled: true, mutedProjects: ['project'] })
      .length,
    0,
  );
  assert.equal(
    relevantAgentNotifications([event], completed, { enabled: true, mutedProjects: [] }, 'task')
      .length,
    0,
  );
  assert.equal(
    relevantAgentNotifications([event, event], completed, { enabled: true, mutedProjects: [] })
      .length,
    1,
  );
  for (const latest of [
    session('completed'),
    session('completed', { unread: true, archived: true }),
    session('running'),
  ]) {
    assert.equal(
      relevantAgentNotifications([event], sessions(latest), { enabled: true, mutedProjects: [] })
        .length,
      0,
    );
  }
  assert.equal(
    relevantAgentNotifications([{ ...event, kind: 'blocked' }], sessions(session()), {
      enabled: true,
      mutedProjects: [],
    }).length,
    0,
  );
});

test('notification copy contains counts only, never task, project, prompt or error text', () => {
  const message = agentNotificationMessage([
    { kind: 'blocked', sessionId: 'secret-title', projectId: 'private-client' },
    { kind: 'blocked', sessionId: 'secret-prompt', projectId: 'private-client' },
    { kind: 'failed', sessionId: 'secret-error', projectId: 'private-client' },
    { kind: 'completed', sessionId: 'secret-file', projectId: 'private-client' },
  ]);
  assert.equal(message.title, 'RunHQ Agents');
  assert.match(message.body, /2 tasks need your decision/);
  assert.match(message.body, /1 task needs recovery/);
  assert.match(message.body, /1 task has a new response/);
  assert.doesNotMatch(JSON.stringify(message), /secret|private/);
});

test('notifications default off; damaged or incompatible settings never opt users in', () => {
  for (const raw of [
    null,
    '',
    '{broken',
    'null',
    JSON.stringify({ version: 2, enabled: true, mutedProjects: [] }),
    JSON.stringify({ version: 1, enabled: 'yes', mutedProjects: [] }),
  ]) {
    assert.deepEqual(plain(readAgentNotificationPreferences(raw)), {
      enabled: false,
      mutedProjects: [],
    });
  }
  assert.deepEqual(
    plain(
      readAgentNotificationPreferences(
        JSON.stringify({ version: 1, enabled: true, mutedProjects: ['a', 'a', 'b'] }),
      ),
    ),
    { enabled: true, mutedProjects: ['a', 'b'] },
  );
});

test('rendering settings never requests native permission; only Enable invokes the permission flow', async () => {
  let requests = 0;
  let enabled = false;
  let error = null;
  const store = {
    preferences: { enabled: false, mutedProjects: [] },
    error: null,
    setEnabled(value) {
      enabled = value;
    },
    setError(value) {
      error = value;
    },
  };
  const useStore = (selector) => selector(store);
  useStore.getState = () => store;
  const { AgentNotificationSettings } = load(
    '../src/components/agents/AgentNotificationSettings.tsx',
    {
      react: { useState: (initial) => [initial, () => {}] },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      '@tauri-apps/api/core': { isTauri: () => true },
      '@tauri-apps/plugin-notification': {
        isPermissionGranted: async () => false,
        requestPermission: async () => {
          requests++;
          return 'granted';
        },
      },
      '@runhq/cockpit-ui': { AgentNotificationSettings: 'Settings' },
      '@/store/useAgentNotificationStore': { useAgentNotificationStore: useStore },
    },
  );
  const rendered = AgentNotificationSettings({});
  assert.equal(requests, 0);
  rendered.props.onEnable();
  await new Promise(setImmediate);
  assert.equal(requests, 1);
  assert.equal(enabled, true);
  assert.equal(error, null);
});
