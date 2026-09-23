import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

function setup(ipc = {}, persisted = new Map()) {
  const exports = {};
  const listeners = new Map();
  const updates = [];
  const localStorage = {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
  };
  const code = ts.transpileModule(
    readFileSync(new URL('../src/store/useAgentStore.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(code, {
    exports,
    window: { setInterval() {}, localStorage },
    require(name) {
      if (name === 'zustand')
        return {
          create(init) {
            let state;
            const get = () => state;
            const set = (patch) => {
              const next = typeof patch === 'function' ? patch(state) : patch;
              if (next === state) return;
              state = { ...state, ...next };
              updates.push(state);
            };
            state = init(set, get);
            return { getState: get, setState: set };
          },
        };
      if (name === '@tauri-apps/api/event')
        return { listen: async (name, fn) => listeners.set(name, fn) };
      if (name === '@/lib/ipc')
        return {
          ipc: {
            agentProjects: async () => [],
            agentSessions: async () => [],
            agentBackends: async () => [],
            ...ipc,
          },
        };
      if (name === './useAppStore') return { useAppStore: { getState: () => ({}) } };
      if (name === '@/lib/agentLocalArtifacts') return { clearAgentLocalArtifacts() {} };
      if (name === '@/lib/agentRecoveryPersistence') {
        const recovery = {};
        const code = ts.transpileModule(
          readFileSync(new URL('../src/lib/agentRecoveryPersistence.ts', import.meta.url), 'utf8'),
          { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
        ).outputText;
        runInNewContext(code, { exports: recovery, window: { localStorage } });
        return recovery;
      }
      throw new Error(name);
    },
  });
  return { ...exports, listeners, updates };
}

test('successful deletion clears selection and draft and rejects late snapshots', async () => {
  const deleted = [];
  const { useAgentStore } = setup({ agentDelete: async (id) => deleted.push(id) });
  const session = { id: 'a', revision: 1 };
  useAgentStore.setState({
    selectedId: 'a',
    sessions: { a: session, b: { id: 'b', revision: 1 } },
    drafts: { a: 'draft', b: 'keep' },
  });
  await useAgentStore.getState().deleteSession('a');
  useAgentStore.getState().merge({ ...session, revision: 99 });
  const state = useAgentStore.getState();
  assert.deepEqual(deleted, ['a']);
  assert.equal(state.selectedId, null);
  assert.equal(state.sessions.a, undefined);
  assert.equal(state.drafts.a, undefined);
  assert.equal(state.drafts.b, 'keep');
  assert.equal(state.sessions.b.id, 'b');
});

test('conversation and new-task drafts survive reload, clearing and session deletion', async () => {
  const persisted = new Map();
  const first = setup({}, persisted).useAgentStore;
  first.getState().setDraft('conversation', 'Keep this prompt');
  first.getState().setDraft('new-task:project', 'Plan the project');
  const reopened = setup({ agentDelete: async () => {} }, persisted).useAgentStore;
  assert.equal(reopened.getState().drafts.conversation, 'Keep this prompt');
  assert.equal(reopened.getState().drafts['new-task:project'], 'Plan the project');
  assert.equal(reopened.getState().recoveredDraftCount, 2);
  await reopened.getState().deleteSession('conversation');
  const next = setup({}, persisted).useAgentStore;
  assert.equal(next.getState().drafts.conversation, undefined);
  assert.equal(next.getState().drafts['new-task:project'], 'Plan the project');
  next.getState().setDraft('new-task:project', '');
  assert.equal(Object.keys(setup({}, persisted).useAgentStore.getState().drafts).length, 0);
});

test('waiting time survives restart and stale snapshots cannot remove the live pending request', async () => {
  const persisted = new Map();
  const request = { id: 'request' };
  const session = { id: 'a', revision: 3, updated_at: 100, pending: [request] };
  const first = setup({}, persisted).useAgentStore;
  first.getState().merge(session);
  const key = JSON.stringify(['a', 'request']);
  const reopened = setup(
    { agentSessions: async () => [{ ...session, revision: 1, pending: [] }] },
    persisted,
  ).useAgentStore;
  reopened.getState().merge({ ...session, updated_at: 500 });
  await reopened.getState().refresh();
  assert.equal(reopened.getState().pendingSince[key], 100);
  reopened.getState().merge({ ...session, revision: 4, pending: [] });
  assert.equal(reopened.getState().pendingSince[key], undefined);
});

test('failed deletion preserves history, selection and drafts', async () => {
  const { useAgentStore } = setup({
    agentDelete: async () => {
      throw new Error('still running');
    },
  });
  useAgentStore.setState({
    selectedId: 'a',
    sessions: { a: { id: 'a', revision: 1 } },
    drafts: { a: 'keep' },
  });
  await assert.rejects(useAgentStore.getState().deleteSession('a'), /still running/);
  const state = useAgentStore.getState();
  assert.equal(state.selectedId, 'a');
  assert.equal(state.sessions.a.id, 'a');
  assert.equal(state.drafts.a, 'keep');
  assert.equal(state.deletedIds.a, undefined);
});

test('deletion events win over an in-flight refresh and retain a different selection', async () => {
  let complete;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { useAgentStore, connectAgents, listeners } = setup({
    agentSessions: () =>
      new Promise((resolve) => {
        complete = resolve;
        started();
      }),
  });
  useAgentStore.setState({
    selectedId: 'b',
    sessions: { a: { id: 'a', revision: 1 }, b: { id: 'b', revision: 1 } },
  });
  const connection = connectAgents();
  await ready;
  listeners.get('agent://deleted')({ payload: 'a' });
  complete([{ id: 'a', revision: 99 }]);
  await connection;
  assert.equal(useAgentStore.getState().sessions.a, undefined);
  assert.equal(useAgentStore.getState().selectedId, 'b');
});

test('refresh publishes a large session list once and preserves unchanged project identity', async () => {
  const project = { id: 'p', name: 'Project', path: '/project' };
  const incoming = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), revision: 1 }));
  const { useAgentStore, updates } = setup({
    agentProjects: async () => [{ ...project }],
    agentSessions: async () => incoming.map((session) => ({ ...session })),
  });
  useAgentStore.setState({ projects: [project] });
  const projects = useAgentStore.getState().projects;
  updates.length = 0;
  await useAgentStore.getState().refresh();
  assert.equal(updates.length, 1);
  assert.equal(Object.keys(useAgentStore.getState().sessions).length, 1000);
  assert.equal(useAgentStore.getState().projects, projects);
  const state = useAgentStore.getState();
  await state.refresh();
  assert.equal(useAgentStore.getState(), state);
  assert.equal(updates.length, 1, 'unchanged polling results must not wake subscribers');
});

test('overlapping refreshes share IPC and retain a newer live session revision', async () => {
  let complete;
  let calls = 0;
  const { useAgentStore } = setup({
    agentSessions: () => {
      calls += 1;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const first = useAgentStore.getState().refresh();
  const second = useAgentStore.getState().refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  const newest = { id: 'a', revision: 4 };
  useAgentStore.getState().merge(newest);
  complete([
    { id: 'a', revision: 2 },
    { id: 'b', revision: 0 },
  ]);
  await first;
  assert.equal(useAgentStore.getState().sessions.a, newest);
  assert.equal(useAgentStore.getState().sessions.b.revision, 0);
  const third = useAgentStore.getState().refresh();
  assert.equal(calls, 2, 'a completed refresh must release the coalesced request');
  complete([]);
  await third;
});

test('tool detection coalesces callers and can retry after failure', async () => {
  let fail;
  let calls = 0;
  const { useAgentStore } = setup({
    agentBackends: () => {
      calls += 1;
      if (calls > 1) return Promise.resolve([{ id: 'codex' }]);
      return new Promise((_, reject) => {
        fail = reject;
      });
    },
  });
  const first = useAgentStore.getState().refreshTools();
  assert.equal(useAgentStore.getState().toolsLoading, true);
  assert.equal(useAgentStore.getState().toolsReady, false);
  const second = useAgentStore.getState().refreshTools();
  assert.equal(first, second);
  assert.equal(calls, 1);
  fail(new Error('unavailable'));
  await assert.rejects(first, /unavailable/);
  assert.equal(useAgentStore.getState().toolsLoading, false);
  assert.equal(useAgentStore.getState().toolsReady, true);
  assert.match(useAgentStore.getState().toolsError, /unavailable/);
  await useAgentStore.getState().refreshTools();
  assert.equal(calls, 2);
  assert.equal(useAgentStore.getState().tools[0].id, 'codex');
  assert.equal(useAgentStore.getState().toolsError, null);
  assert(useAgentStore.getState().toolsCheckedAt > 0);
});

test('failed detection retains known installations independently of workspace refresh', async () => {
  const { useAgentStore } = setup({
    agentBackends: async () => {
      throw new Error('scan failed');
    },
  });
  const tools = [{ id: 'codex', available: true }];
  useAgentStore.setState({ tools });
  await assert.rejects(useAgentStore.getState().refreshTools(), /scan failed/);
  await useAgentStore.getState().refresh();
  assert.equal(useAgentStore.getState().tools, tools);
  assert.match(useAgentStore.getState().toolsError, /scan failed/);
  assert.equal(useAgentStore.getState().error, null);
});

test('unchanged installation scans preserve tool identity', async () => {
  const { useAgentStore } = setup({
    agentBackends: async () => [{ id: 'codex', available: true }],
  });
  await useAgentStore.getState().refreshTools();
  const tools = useAgentStore.getState().tools;
  await useAgentStore.getState().refreshTools();
  assert.equal(useAgentStore.getState().tools, tools);
});

test('selecting a read conversation avoids an unnecessary backend mutation', async () => {
  let reads = 0;
  const { useAgentStore } = setup({
    agentUpdate: async (id) => {
      reads += 1;
      return { id, revision: 2, unread: false };
    },
  });
  useAgentStore.getState().merge({ id: 'a', revision: 1, unread: false });
  useAgentStore.getState().select('a');
  assert.equal(useAgentStore.getState().selectedId, 'a');
  assert.equal(reads, 0);
  useAgentStore.getState().merge({ id: 'b', revision: 1, unread: true });
  useAgentStore.getState().select('b');
  await Promise.resolve();
  assert.equal(reads, 1);
});

test('refresh after a mutation reads again after an older in-flight request', async () => {
  let complete;
  let calls = 0;
  const { useAgentStore } = setup({
    agentProjects: () => {
      calls += 1;
      if (calls > 1) return Promise.resolve([{ id: 'new-project', name: 'New', path: '/new' }]);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const initial = useAgentStore.getState().refresh();
  const afterSave = useAgentStore.getState().refresh(true);
  complete([]);
  await Promise.all([initial, afterSave]);
  assert.equal(calls, 2);
  assert.equal(useAgentStore.getState().projects[0].id, 'new-project');
});

test('saving tool configuration does not reuse detection started before the save', async () => {
  let complete;
  let calls = 0;
  const { useAgentStore } = setup({
    agentBackends: () => {
      calls += 1;
      if (calls > 1) return Promise.resolve([{ id: 'codex', enabled: false }]);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const initial = useAgentStore.getState().refreshTools();
  const afterSave = useAgentStore.getState().refreshTools(true);
  complete([{ id: 'codex', enabled: true }]);
  await Promise.all([initial, afterSave]);
  assert.equal(calls, 2);
  assert.equal(useAgentStore.getState().tools[0].enabled, false);
});
