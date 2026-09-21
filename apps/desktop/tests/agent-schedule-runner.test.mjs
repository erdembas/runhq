import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(path, resolve = () => ({})) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: resolve, Date, Number, Error, crypto: webcrypto, Promise, String },
  );
  return exports;
}
const schedule = load('../src/components/agents/agentSchedule.ts');
const { runDueSchedules } = load('../src/components/agents/agentScheduleRunner.ts', (name) =>
  name === './agentSchedule' ? schedule : {},
);

const at = (iso) => new Date(iso).getTime();
const now = at('2026-09-21T09:00:00');
const recipe = {
  id: 'r1',
  name: 'Dependency update',
  prompt: 'Update dependencies',
  backend: 'codex',
  model: '',
  effort: '',
  agent: '',
  mode: 'default',
  isolated: true,
};
const due = {
  id: 's1',
  recipeId: 'r1',
  projectId: 'p1',
  cadence: { kind: 'daily', time: '08:00' },
  enabled: true,
  lastRunAt: at('2026-09-20T08:00:00'),
};
const harness = (overrides = {}) => {
  const saved = [];
  const launched = [];
  return {
    saved,
    launched,
    deps: {
      now,
      schedules: [due],
      recipe: () => recipe,
      blocked: () => null,
      route: () => ({ accountId: 'codex', reason: '', rejected: [] }),
      launch: async (input, prompt, creationId) => {
        launched.push({ input, prompt, creationId });
        return { id: 'session-1', title: input.title };
      },
      save: async (next) => void saved.push(next),
      ...overrides,
    },
  };
};

test('a due schedule starts its recipe and records what happened', async () => {
  const { deps, saved, launched } = harness();
  const runs = await runDueSchedules(deps);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].prompt, 'Update dependencies');
  assert.equal(launched[0].input.title, 'Dependency update');
  assert.equal(launched[0].input.isolated, true);
  assert.equal(runs[0].outcome, 'Started Dependency update');
  // The creation id is reserved before the launch and cleared only once it succeeded.
  assert.equal(saved[0].pendingCreationId, launched[0].creationId);
  assert.equal(saved.at(-1).pendingCreationId, undefined);
  assert.equal(saved.at(-1).lastRunAt, now);
});

test('a failed launch keeps the reserved id so a retry cannot duplicate the task', async () => {
  const { deps, saved } = harness({
    launch: async () => {
      throw new Error('provider offline');
    },
  });
  const runs = await runDueSchedules(deps);
  assert.match(runs[0].outcome, /Could not start.*provider offline/);
  assert.equal(typeof saved.at(-1).pendingCreationId, 'string');
  assert.equal(saved.at(-1).lastRunAt, now);
});

test('a blocked schedule is recorded rather than retried every tick', async () => {
  const { deps, saved, launched } = harness({ blocked: () => 'Previous run is still active' });
  const runs = await runDueSchedules(deps);
  assert.equal(launched.length, 0);
  assert.equal(runs[0].outcome, 'Previous run is still active');
  assert.equal(saved.at(-1).lastRunAt, now, 'the occurrence is consumed, not left overdue');
});

test('a schedule whose recipe was deleted pauses itself', async () => {
  const { deps, launched, saved } = harness({ recipe: () => null });
  const runs = await runDueSchedules(deps);
  assert.equal(launched.length, 0);
  assert.equal(runs[0].outcome, 'Recipe was removed');
  assert.equal(saved.at(-1).enabled, false);
});

test('runs missed while RunHQ was closed are reported once, not replayed', async () => {
  const { deps, launched, saved } = harness({
    schedules: [{ ...due, lastRunAt: at('2026-09-18T08:00:00') }],
  });
  await runDueSchedules(deps);
  assert.equal(launched.length, 1, 'three due days produce one run');
  assert.match(saved.at(-1).lastOutcome, /2 earlier runs were missed while RunHQ was closed/);
});

test('a paused schedule produces nothing at all', async () => {
  const { deps, saved, launched } = harness({ schedules: [{ ...due, enabled: false }] });
  assert.equal((await runDueSchedules(deps)).length, 0);
  assert.equal(saved.length, 0);
  assert.equal(launched.length, 0);
});

test('a pooled recipe starts on the routed account and says which one it chose', async () => {
  const { deps, launched } = harness({
    recipe: () => ({ ...recipe, backend: 'pool:codex-accounts' }),
    route: () => ({
      accountId: 'codex-second',
      reason: 'Codex (second account) had the most free slots in Codex accounts',
      rejected: [],
    }),
  });
  const runs = await runDueSchedules(deps);
  assert.equal(launched[0].input.backend, 'codex-second', 'a task is created against one account');
  assert.match(runs[0].outcome, /Codex \(second account\) had the most free slots/);
});

test('a recipe that cannot reach an account records why instead of starting nothing', async () => {
  const { deps, launched, saved } = harness({
    route: () => ({
      accountId: null,
      reason: 'No account in Codex accounts is free: Codex reported a limit and is on cool-down',
      rejected: [{ id: 'codex', name: 'Codex', signal: 'quota', reason: 'is on cool-down' }],
    }),
  });
  const runs = await runDueSchedules(deps);
  assert.equal(launched.length, 0);
  assert.match(runs[0].outcome, /reported a limit and is on cool-down/);
  assert.equal(saved.at(-1).lastRunAt, now, 'the occurrence is consumed, not left overdue');
  assert.equal(saved.at(-1).pendingCreationId, undefined, 'nothing was reserved for a task');
});

test('an unattended run writes down the account it chose, beside the task', async () => {
  const noted = [];
  const { deps } = harness({
    recipe: () => ({ ...recipe, backend: 'pool:codex-accounts' }),
    route: () => ({ accountId: 'codex-second', reason: 'had the most free slots', rejected: [] }),
    routed: async (session, choice, used) => {
      noted.push({ id: session.id, reason: choice.reason, target: used.backend });
    },
  });
  await runDueSchedules(deps);
  assert.deepEqual(noted, [
    { id: 'session-1', reason: 'had the most free slots', target: 'pool:codex-accounts' },
  ]);
});

test('a run that never started records nothing about an account', async () => {
  const noted = [];
  const { deps } = harness({
    route: () => ({ accountId: null, reason: 'Codex is on cool-down', rejected: [] }),
    routed: async () => void noted.push('written'),
  });
  await runDueSchedules(deps);
  assert.deepEqual(noted, []);
});
