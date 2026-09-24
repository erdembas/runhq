import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === './agentTaskStart') return load('../src/components/agents/agentTaskStart.ts');
        if (name === '@runhq/cockpit-ui')
          return load('../../../packages/cockpit-ui/src/lib/agentAttachments.ts');
        throw new Error(name);
      },
    },
  );
  return exports;
}

const { createAgentTurnQueue, isAgentQueueRecord, recoverAgentQueues } = load(
  '../src/components/agents/agentTurnQueue.ts',
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
const input = (id, extra = {}) => ({
  session_id: 'session',
  request_id: id,
  prompt: `Prompt ${id}`,
  model: 'selected-model',
  effort: 'high',
  mode: 'plan',
  agent: 'builder',
  ...extra,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

test('send now stops first, promotes the selected follow-up, and preserves its session and payload', async () => {
  const stopped = deferred();
  let active = true;
  let capacity = true;
  let cancelled = false;
  let snapshot;
  const started = [];
  const interruptions = [];
  const checks = [];
  const selected = input('selected', {
    prompt: 'Continue in this conversation with the attached screenshot.',
    attachments: [{ name: 'screen.png', mime_type: 'image/png', data: 'AA==' }],
  });
  const queue = createAgentTurnQueue({
    isActive: () => active,
    canStart: (id, manual) => {
      checks.push({ id, manual });
      return !active && capacity && (!cancelled || manual);
    },
    changed: (value) => {
      snapshot = plain(value);
    },
    interrupt: (id) => {
      interruptions.push(id);
      assert.equal(snapshot.session[0].request_id, 'selected');
      assert.equal(snapshot.session[0].state, 'interrupting', 'persist before stopping the turn');
      return stopped.promise;
    },
    start: async (turn) => {
      started.push(plain(turn));
      active = true;
    },
  });
  queue.enqueue(input('first'));
  queue.enqueue(selected);
  queue.enqueue(input('last'));
  const sending = queue.sendNow('session', 'selected');
  assert.deepEqual(interruptions, ['session']);
  assert.deepEqual(
    snapshot.session.map((turn) => turn.request_id),
    ['selected', 'first', 'last'],
  );

  // The runtime can report an inactive session before acknowledging the stop.
  active = false;
  queue.notify('session');
  await tick();
  assert.equal(started.length, 0, 'an early status event must not dispatch during interruption');
  active = true;
  stopped.resolve();
  await sending;
  await tick();
  assert.equal(started.length, 0, 'stop acknowledgement alone does not prove the turn is inactive');
  assert.equal(snapshot.session[0].state, 'interrupting');

  active = false;
  cancelled = true;
  capacity = false;
  queue.notify('session');
  await tick();
  assert.equal(started.length, 0, 'send now still respects capacity');
  assert.equal(
    snapshot.session[0].state,
    'queued',
    'a stopped turn is no longer interrupting while capacity is full',
  );
  capacity = true;
  queue.notify('session');
  queue.notify('session');
  await tick();
  assert.deepEqual(started, [{ ...selected, allow_parallel_checkout: true }]);
  assert.equal(
    checks.some(({ id, manual }) => id === 'session' && manual),
    true,
  );
  assert.deepEqual(
    snapshot.session.map((turn) => turn.request_id),
    ['first', 'last'],
  );
});

test('pending interruption ignores double clicks, competing sends, resume, removal, and reordering', async () => {
  const stopped = deferred();
  let active = true;
  let snapshot;
  let interruptions = 0;
  let starts = 0;
  const queue = createAgentTurnQueue({
    isActive: () => active,
    canStart: () => !active,
    changed: (value) => {
      snapshot = plain(value);
    },
    interrupt: () => {
      interruptions++;
      return stopped.promise;
    },
    start: async () => {
      starts++;
      active = true;
    },
  });
  queue.enqueue(input('one'));
  queue.enqueue(input('two'));
  const sending = queue.sendNow('session', 'one');
  await queue.sendNow('session', 'one');
  await queue.sendNow('session', 'two');
  queue.resume('session');
  queue.remove('session', 'one');
  queue.move('session', 'one', 1);
  queue.move('session', 'two', -1);
  active = false;
  queue.notify('session');
  await tick();
  assert.equal(interruptions, 1);
  assert.equal(starts, 0);
  assert.deepEqual(
    snapshot.session.map((turn) => [turn.request_id, turn.state]),
    [
      ['one', 'interrupting'],
      ['two', 'queued'],
    ],
  );
  stopped.resolve();
  await sending;
  await tick();
  assert.equal(starts, 1);
  assert.equal(snapshot.session[0].request_id, 'two');
});

test('a failed interruption pauses the selected message and never leaks manual resume to another row', async () => {
  const stopped = deferred();
  let cancelled = false;
  let snapshot;
  const starts = [];
  const queue = createAgentTurnQueue({
    canStart: (_id, manual) => cancelled && manual,
    changed: (value) => {
      snapshot = plain(value);
    },
    interrupt: () => stopped.promise,
    start: async (turn) => starts.push(turn.request_id),
  });
  queue.enqueue(input('one'));
  queue.enqueue(input('selected'));
  const sending = queue.sendNow('session', 'selected');
  stopped.reject(new Error('Provider could not stop the current turn'));
  await sending;
  assert.equal(snapshot.session[0].request_id, 'selected');
  assert.equal(snapshot.session[0].state, 'failed');
  assert.match(snapshot.session[0].error, /could not stop/);
  cancelled = true;
  queue.notify('session');
  await tick();
  assert.deepEqual(starts, []);
  queue.remove('session', 'selected');
  queue.notify('session');
  await tick();
  assert.deepEqual(
    starts,
    [],
    'removing the failed request must not manually resume another request',
  );
});

test('failed recovery persistence prevents interruption and dispatch until an explicit retry', async () => {
  let save = true;
  let snapshot;
  let interruptions = 0;
  let starts = 0;
  let active = true;
  const queue = createAgentTurnQueue({
    isActive: () => active,
    canStart: () => !active,
    changed: (value) => {
      snapshot = plain(value);
      return save;
    },
    interrupt: async () => {
      interruptions++;
      active = false;
    },
    start: async () => {
      starts++;
      active = true;
    },
  });
  queue.enqueue(input('one'));
  save = false;
  await queue.sendNow('session', 'one');
  assert.equal(interruptions, 0);
  assert.equal(starts, 0);
  assert.equal(snapshot.session[0].state, 'failed');
  assert.ok(snapshot.session[0].error);
  active = false;
  save = true;
  queue.notify('session');
  await tick();
  assert.equal(starts, 0, 'a later status update must not bypass the failed persistence');
  active = true;
  await queue.sendNow('session', 'one');
  await tick();
  assert.equal(interruptions, 1);
  assert.equal(starts, 1);
});

test('failed persistence after stopping pauses the selected message until explicitly resumed', async () => {
  const stopped = deferred();
  let active = true;
  let save = true;
  let snapshot;
  const starts = [];
  const queue = createAgentTurnQueue({
    isActive: () => active,
    canStart: () => !active,
    changed: (value) => {
      snapshot = plain(value);
      return save;
    },
    interrupt: () => stopped.promise,
    start: async (turn) => {
      starts.push(plain(turn));
      active = true;
    },
  });
  queue.enqueue(input('one'));
  const sending = queue.sendNow('session', 'one');
  assert.equal(snapshot.session[0].state, 'interrupting');
  active = false;
  save = false;
  stopped.resolve();
  await sending;
  await tick();
  assert.equal(snapshot.session[0].state, 'failed');
  assert.ok(snapshot.session[0].error);
  assert.deepEqual(starts, []);
  save = true;
  queue.notify('session');
  await tick();
  assert.deepEqual(starts, [], 'save recovery must not revive the previous manual-send permission');
  queue.resume('session');
  await tick();
  assert.deepEqual(starts, [input('one', { allow_parallel_checkout: true })]);
});

test('send now cannot bypass a first-message dependency by promoting a later follow-up', async () => {
  let snapshot;
  let interruptions = 0;
  const queue = createAgentTurnQueue({
    canStart: () => true,
    dependencyState: () => 'waiting',
    changed: (value) => {
      snapshot = plain(value);
    },
    interrupt: async () => interruptions++,
    start: async () => assert.fail('the prerequisite is still running'),
  });
  queue.enqueue({
    ...input('first'),
    startAfter: { sessionId: 'preceding-session', title: 'Preceding task' },
  });
  queue.enqueue(input('follow-up'));
  const before = plain(snapshot);
  await queue.sendNow('session', 'first');
  await queue.sendNow('session', 'follow-up');
  await tick();
  assert.equal(interruptions, 0);
  assert.deepEqual(snapshot, before);
});

test('send now does not interrupt or overtake an unacknowledged dispatch', async () => {
  const accepted = deferred();
  let active = false;
  let snapshot;
  let interruptions = 0;
  const starts = [];
  const queue = createAgentTurnQueue({
    canStart: () => !active,
    changed: (value) => {
      snapshot = plain(value);
    },
    interrupt: async () => interruptions++,
    start: (turn) => {
      starts.push(turn.request_id);
      active = true;
      return accepted.promise;
    },
  });
  queue.enqueue(input('sending'));
  queue.enqueue(input('waiting'));
  await queue.sendNow('session', 'sending');
  await queue.sendNow('session', 'waiting');
  assert.equal(interruptions, 0);
  assert.deepEqual(starts, ['sending']);
  assert.equal(snapshot.session[0].state, 'sending');
  assert.equal(snapshot.session[1].request_id, 'waiting');
  accepted.resolve();
  await tick();
  assert.deepEqual(starts, ['sending']);
});

for (const outcome of ['acknowledged', 'failed']) {
  test(`clearing the queue during interruption never resurrects its message when the stop ${outcome === 'acknowledged' ? 'succeeds' : 'fails'}`, async () => {
    const stopped = deferred();
    let active = true;
    let snapshot;
    let starts = 0;
    const queue = createAgentTurnQueue({
      canStart: () => !active,
      changed: (value) => {
        snapshot = plain(value);
      },
      interrupt: () => stopped.promise,
      start: async () => starts++,
    });
    queue.enqueue(input('one'));
    const sending = queue.sendNow('session', 'one');
    queue.clear('session');
    active = false;
    if (outcome === 'acknowledged') stopped.resolve();
    else stopped.reject(new Error('Session no longer exists'));
    await sending;
    queue.notify('session');
    await tick();
    assert.equal(snapshot.session.length, 0);
    assert.equal(starts, 0);
  });
}

test('restart validates and pauses interrupting entries without replaying a stop or send', async () => {
  const record = {
    session: [
      { ...input('selected'), state: 'interrupting' },
      { ...input('next'), state: 'queued' },
    ],
  };
  assert.equal(isAgentQueueRecord(record), true);
  const initial = recoverAgentQueues(record);
  assert.equal(initial.session[0].state, 'failed');
  assert.ok(initial.session[0].error);
  assert.equal(initial.session[1].state, 'queued');
  assert.deepEqual(plain(initial.session[0]).request_id, 'selected');
  // Also pause any interrupted entry in an otherwise malformed historical order.
  const later = recoverAgentQueues({ session: [record.session[1], record.session[0]] });
  assert.equal(later.session[1].state, 'failed');

  let active = false;
  let interruptions = 0;
  const starts = [];
  const queue = createAgentTurnQueue({
    initial,
    canStart: (_id, manual) => !active && manual,
    changed: () => {},
    interrupt: async () => interruptions++,
    start: async (turn) => {
      starts.push(plain(turn));
      active = true;
    },
  });
  queue.notify('session');
  await tick();
  assert.deepEqual(starts, []);
  assert.equal(interruptions, 0);
  queue.resume('session');
  await tick();
  assert.deepEqual(starts, [input('selected')]);
  assert.equal(interruptions, 0, 'reviewing a recovered entry does not repeat an uncertain stop');
});
