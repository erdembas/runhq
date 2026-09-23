import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { setImmediate } from 'node:timers';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === '@runhq/cockpit-ui')
          return load('../../../packages/cockpit-ui/src/lib/agentAttachments.ts');
        throw new Error(name);
      },
    },
  );
  return exports;
}
const { createAgentRecoveryPersistence, isStringRecord } = load(
  '../src/lib/agentRecoveryPersistence.ts',
);
const { createAgentTurnQueue, recoverAgentQueues, isAgentQueueRecord } = load(
  '../src/components/agents/agentTurnQueue.ts',
);
const { collectAgentDecisions, agentDecisionWait } = load(
  '../src/components/agents/agentDecisions.ts',
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const turn = (id, state = 'queued') => ({
  session_id: 'session',
  request_id: id,
  prompt: `Prompt ${id}`,
  model: 'selected',
  effort: 'high',
  mode: 'plan',
  agent: 'builder',
  state,
});
const memory = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};

test('queue recovery preserves order/options and requires explicit consent even when backend is ready', async () => {
  const storage = memory();
  const saved = createAgentRecoveryPersistence('queue', isAgentQueueRecord, () => storage);
  assert.equal(saved.save({ session: [turn('one', 'sending'), turn('two')] }), null);
  const loaded = createAgentRecoveryPersistence('queue', isAgentQueueRecord, () => storage).load(
    {},
  );
  const initial = recoverAgentQueues(loaded.data);
  assert.match(initial.session[0].error, /may already have been accepted/);
  let active = false;
  const calls = [];
  const queue = createAgentTurnQueue({
    initial,
    canStart: () => !active,
    changed: () => {},
    start: async (input) => {
      calls.push(input);
      active = true;
    },
  });
  queue.notify('session');
  await tick();
  assert.equal(calls.length, 0);
  queue.resume('session');
  await tick();
  assert.equal(calls[0].request_id, 'one');
  assert.equal(calls[0].model, 'selected');
  assert.equal(calls[0].mode, 'plan');
  assert.equal(calls[0].agent, 'builder');
  assert.equal('state' in calls[0], false);
  active = false;
  queue.notify('session');
  await tick();
  assert.deepEqual(
    calls.map((call) => call.request_id),
    ['one', 'two'],
  );
});

test('restored unsent queues also pause; malformed and duplicate turns are rejected', () => {
  assert.equal(recoverAgentQueues({ session: [turn('one')] }).session[0].state, 'failed');
  assert.equal(isAgentQueueRecord({ session: [turn('one'), turn('one')] }), false);
  assert.equal(isAgentQueueRecord({ wrongSession: [turn('one')] }), false);
  assert.equal(isAgentQueueRecord({ session: [{ ...turn('one'), model: 1 }] }), false);
  assert.equal(isAgentQueueRecord({ session: [{ ...turn('one'), attachments: [null] }] }), false);
  assert.equal(
    isAgentQueueRecord({
      session: [
        {
          ...turn('one'),
          attachments: [{ name: 'x.png', mime_type: 'image/png', data: 'invalid' }],
        },
      ],
    }),
    false,
  );
});

test('queued image context remains attached through persistence and recovered dispatch', async () => {
  const attachments = [{ name: 'screen.png', mime_type: 'image/png', data: 'aW1hZ2U=' }];
  const initial = recoverAgentQueues(
    JSON.parse(JSON.stringify({ session: [{ ...turn('image'), attachments }] })),
  );
  let sent;
  const queue = createAgentTurnQueue({
    initial,
    canStart: () => true,
    changed: () => {},
    start: async (input) => {
      sent = input;
    },
  });
  queue.resume('session');
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.attachments)), attachments);
});

test('an explicit resume waits for capacity and starts when notified, without another click', async () => {
  let available = false;
  let calls = 0;
  const queue = createAgentTurnQueue({
    initial: recoverAgentQueues({ session: [turn('one')] }),
    canStart: (_id, manual) => available && manual,
    changed: () => {},
    start: async () => {
      calls++;
    },
  });
  queue.resume('session');
  await tick();
  assert.equal(calls, 0);
  available = true;
  queue.notify('session');
  await tick();
  assert.equal(calls, 1);
});

test('local save failure prevents transmission and can recover without changing the request id', async () => {
  let allowed = false;
  let snapshot;
  const calls = [];
  const queue = createAgentTurnQueue({
    canStart: () => true,
    start: async (input) => calls.push(input.request_id),
    changed: (value) => {
      snapshot = value;
      return allowed;
    },
  });
  assert.equal(queue.enqueue(turn('stable')), false);
  await tick();
  assert.deepEqual(calls, []);
  assert.equal(snapshot.session[0].request_id, 'stable');
  queue.notify('session');
  await tick();
  assert.equal(snapshot.session[0].state, 'failed');
  assert.deepEqual(calls, []);
  allowed = true;
  queue.resume('session');
  await tick();
  assert.deepEqual(calls, ['stable']);
});

test('corrupt or future-version recovery is preserved before a replacement; quota errors stay visible', () => {
  const storage = memory();
  const original = '{broken';
  storage.setItem('drafts', original);
  const persistence = createAgentRecoveryPersistence('drafts', isStringRecord, () => storage);
  assert.match(persistence.load({}).error, /could not be loaded/);
  assert.equal(storage.getItem('drafts'), original);
  assert.equal(persistence.save({ task: 'New draft' }), null);
  assert.equal(storage.getItem('drafts:unreadable-backup'), original);
  assert.equal(JSON.parse(storage.getItem('drafts')).data.task, 'New draft');
  const failing = createAgentRecoveryPersistence('blocked', isStringRecord, () => ({
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  }));
  assert.match(failing.save({ task: 'Keep me' }), /only in memory/);
});

test('decision inbox isolates project and request type and sorts oldest wait first', () => {
  const sessions = {
    a: {
      id: 'a',
      project_id: 'one',
      project_name: 'One',
      title: 'Build',
      updated_at: 500,
      pending: [
        { id: 'question', kind: 'question', title: 'Scope' },
        { id: 'approval', kind: 'approval', title: 'Allow command' },
      ],
    },
    b: {
      id: 'b',
      project_id: 'two',
      project_name: 'Two',
      title: 'Review',
      updated_at: 400,
      pending: [{ id: 'question', kind: 'question', title: 'Which files?' }],
    },
  };
  const since = { '["a","approval"]': 100, '["a","question"]': 300 };
  const all = collectAgentDecisions(sessions, since);
  assert.equal(all.length, 3);
  assert.equal(all[0].request.id, 'approval');
  const scoped = collectAgentDecisions(sessions, since, {
    projectId: 'one',
    kind: 'question',
    search: 'scope',
  });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].session.id, 'a');
  assert.equal(agentDecisionWait(100, 30_100), '30s');
  assert.equal(agentDecisionWait(100, 3_900_100), '1h 5m');
});
