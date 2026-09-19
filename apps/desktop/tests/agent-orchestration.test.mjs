import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function load(path) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require(name) {
      if (name === '@runhq/cockpit-ui')
        return load('../../../packages/cockpit-ui/src/lib/agentAttachments.ts');
      throw new Error(name);
    },
  });
  return exports;
}
const { createAgentTurnQueue } = load('../src/components/agents/agentTurnQueue.ts');
const { collectAgentPlans, agentPlanDocument, buildAgentPlanPrompt } = load(
  '../../../packages/cockpit-ui/src/lib/agentPlans.ts',
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const input = (id, prompt = id) => ({
  session_id: 'session',
  request_id: id,
  prompt,
  model: 'chosen-model',
  effort: 'high',
  mode: 'plan',
  agent: '',
});

test('queue runs in order after completion, prevents concurrent dispatch, and preserves turn settings', async () => {
  let state = 'running';
  let snapshot = {};
  const started = [];
  const queue = createAgentTurnQueue({
    canStart: () => state === 'completed',
    changed: (value) => {
      snapshot = value;
    },
    start: async (turn) => {
      started.push(turn);
      state = 'running';
    },
  });
  queue.enqueue(input('one'));
  queue.enqueue(input('two'));
  assert.equal(started.length, 0);
  state = 'completed';
  queue.notify('session');
  queue.notify('session');
  await tick();
  assert.equal(started.length, 1);
  assert.equal(started[0].mode, 'plan');
  assert.equal(started[0].model, 'chosen-model');
  assert.equal(snapshot.session.length, 1);
  state = 'completed';
  queue.notify('session');
  await tick();
  assert.equal(started[1].request_id, 'two');
  assert.equal(snapshot.session.length, 0);
});

test('transport failure pauses queue and manual retry reuses request ID instead of duplicating the turn', async () => {
  let snapshot = {};
  const ids = [];
  const queue = createAgentTurnQueue({
    canStart: () => true,
    changed: (value) => {
      snapshot = value;
    },
    start: async (turn) => {
      ids.push(turn.request_id);
      if (ids.length === 1) throw new Error('Connection lost');
    },
  });
  queue.enqueue(input('stable'));
  await tick();
  assert.equal(snapshot.session[0].state, 'failed');
  queue.notify('session');
  await tick();
  assert.equal(ids.length, 1);
  queue.resume('session');
  await tick();
  assert.deepEqual(ids, ['stable', 'stable']);
  assert.equal(snapshot.session.length, 0);
});

test('reorder, cancellation, empty prompts and duplicate IDs are handled without starting work', () => {
  let snapshot = {};
  const queue = createAgentTurnQueue({
    canStart: () => false,
    start: async () => assert.fail(),
    changed: (value) => {
      snapshot = value;
    },
  });
  queue.enqueue(input('empty', '  '));
  assert.equal(snapshot.session, undefined);
  queue.enqueue(input('one'));
  queue.enqueue(input('two'));
  queue.enqueue(input('two'));
  queue.move('session', 'two', -1);
  assert.equal(snapshot.session[0].request_id, 'two');
  queue.remove('session', 'two');
  assert.equal(snapshot.session[0].request_id, 'one');
  queue.clear('session');
  assert.equal(snapshot.session.length, 0);
});

test('in-flight messages cannot be cancelled or reordered and deletion cannot resurrect the queue', async () => {
  let resolve;
  let snapshot = {};
  const queue = createAgentTurnQueue({
    canStart: () => true,
    start: () =>
      new Promise((done) => {
        resolve = done;
      }),
    changed: (value) => {
      snapshot = value;
    },
  });
  queue.enqueue(input('one'));
  queue.enqueue(input('two'));
  queue.remove('session', 'one');
  queue.move('session', 'two', -1);
  assert.equal(snapshot.session[0].request_id, 'one');
  assert.equal(snapshot.session[0].state, 'sending');
  queue.clear('session');
  resolve();
  await tick();
  assert.equal(snapshot.session.length, 0);
});

test('failed and interrupted sessions stay paused until an explicit resume', async () => {
  let calls = 0;
  const queue = createAgentTurnQueue({
    canStart: (_id, manual) => manual,
    start: async () => {
      calls++;
    },
    changed: () => {},
  });
  queue.enqueue(input('one'));
  queue.notify('session');
  await tick();
  assert.equal(calls, 0);
  queue.resume('session');
  await tick();
  assert.equal(calls, 1);
});

const item = (text, kind = 'plan', id = 'plan-1') => ({
  id,
  text,
  kind,
  title: 'Implementation',
  status: 'completed',
  created_at: 1,
});
test('normalizes Codex and ACP plan status without inventing progress', () => {
  const plan = agentPlanDocument(
    item(
      JSON.stringify([
        { step: 'Inspect', status: 'completed' },
        { content: 'Build', status: 'in_progress' },
        { step: 'Verify', status: 'pending' },
      ]),
    ),
  );
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].status, 'completed');
  assert.equal(plan.steps[1].status, 'in_progress');
  assert.match(plan.body, /\[x\] Inspect/);
});

test('retains complete Cursor plans and markdown checklists', () => {
  const plan = agentPlanDocument(
    item(
      JSON.stringify({
        overview: 'Scope',
        plan: 'Implement the module',
        entries: [{ content: 'Verify', status: 'pending' }],
      }),
    ),
  );
  assert.match(plan.body, /Scope/);
  assert.match(plan.body, /Implement the module/);
  assert.equal(plan.steps[0].text, 'Verify');
  const markdown = agentPlanDocument(item('## Plan\n- [x] Read code\n- [ ] Build'));
  assert.equal(markdown.steps[0].status, 'completed');
  assert.equal(markdown.steps[1].status, 'pending');
  assert.equal(agentPlanDocument(item('{partial')).body, '{partial');
});

test('assistant plan fallback uses only current turn and build prompt includes exact edited plan', () => {
  const items = [item('old', 'assistant', 'old'), item('new task', 'user', 'user')];
  assert.equal(collectAgentPlans(items, true).length, 0);
  items.push(item('New plan', 'assistant', 'new'));
  assert.equal(collectAgentPlans(items, true)[0].body, 'New plan');
  assert.equal(collectAgentPlans(items, false).length, 0);
  assert.match(
    buildAgentPlanPrompt('Edited plan\nKeep this'),
    /<reviewed_plan>\nEdited plan\nKeep this\n<\/reviewed_plan>/,
  );
});

test('removing a failed head starts the next eligible message', async () => {
  const started = [];
  const queue = createAgentTurnQueue({
    canStart: () => true,
    changed: () => {},
    start: async (turn) => {
      started.push(turn.request_id);
      if (turn.request_id === 'failed') throw new Error('Unavailable');
    },
  });
  queue.enqueue(input('failed'));
  queue.enqueue(input('next'));
  await tick();
  assert.deepEqual(started, ['failed']);
  queue.remove('session', 'failed');
  await tick();
  assert.deepEqual(started, ['failed', 'next']);
});

test('reviewed plan remains accessible after transitioning to implementation mode', () => {
  const plans = collectAgentPlans(
    [item(buildAgentPlanPrompt('Approved approach'), 'user', 'build')],
    false,
  );
  assert.equal(plans[0].body, 'Approved approach');
  assert.equal(plans[0].title, 'Reviewed implementation plan');
});

const { clearAgentLocalArtifacts } = load('../src/lib/agentLocalArtifacts.ts');
test('artifact cleanup removes only the deleted session including all edits', () => {
  const entries = new Map([
    ['runhq:agent-canvas:v1:["session","artifact"]', 'private content'],
    ['runhq:agent-canvas:v1:["another-session","artifact"]', 'keep'],
    ['runhq:plan:session:plan1', 'private plan'],
    ['runhq:plan:another-session:plan1', 'keep'],
    ['runhq:agent-canvas:v1:invalid', 'keep'],
    ['other-app-preferences', 'keep'],
  ]);
  clearAgentLocalArtifacts('session', {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index],
    removeItem: (key) => entries.delete(key),
  });
  assert.equal(entries.size, 4);
  assert.equal(entries.has('runhq:plan:session:plan1'), false);
  assert.equal(entries.get('runhq:agent-canvas:v1:["another-session","artifact"]'), 'keep');
});
