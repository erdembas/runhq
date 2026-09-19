import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: () => ({}), Date, Number, Error },
  );
  return exports;
}
const { parseSchedule, parseCadence, nextScheduledRun, scheduleDecision, describeCadence } = load(
  '../src/components/agents/agentSchedule.ts',
);
const base = { id: 's1', recipeId: 'r1', projectId: 'p1', enabled: true };
const at = (iso) => new Date(iso).getTime();

test('a cadence is validated before it can be stored', () => {
  assert.throws(() => parseCadence({ kind: 'daily', time: '25:00' }), /HH:MM/);
  assert.throws(() => parseCadence({ kind: 'interval', hours: 0 }), /1 hour/);
  assert.throws(() => parseCadence({ kind: 'interval', hours: 400 }), /14 days/);
  assert.throws(() => parseCadence({ kind: 'weekly', time: '09:00', day: 9 }), /weekday/);
  assert.throws(() => parseCadence({ kind: 'hourly' }), /how often/);
  assert.deepEqual(JSON.parse(JSON.stringify(parseCadence({ kind: 'daily', time: '09:30' }))), {
    kind: 'daily',
    time: '09:30',
  });
});

test('a stored schedule keeps only the fields the runner owns', () => {
  const stored = parseSchedule({
    ...base,
    cadence: { kind: 'daily', time: '07:00' },
    lastRunAt: 5,
    lastOutcome: 'Started',
    somethingElse: 'dropped',
  });
  assert.equal(stored.lastOutcome, 'Started');
  assert.equal('somethingElse' in stored, false);
  assert.throws(() =>
    parseSchedule({ ...base, id: '', cadence: { kind: 'daily', time: '07:00' } }),
  );
});

test('the next run follows the local clock and rolls to the next day or weekday', () => {
  const monday09 = at('2026-09-21T09:00:00');
  assert.equal(
    nextScheduledRun({ kind: 'daily', time: '10:00' }, monday09),
    at('2026-09-21T10:00:00'),
  );
  // A time that has already passed today belongs to tomorrow, never to the past.
  assert.equal(
    nextScheduledRun({ kind: 'daily', time: '08:00' }, monday09),
    at('2026-09-22T08:00:00'),
  );
  assert.equal(
    nextScheduledRun({ kind: 'weekly', day: 3, time: '08:00' }, monday09),
    at('2026-09-23T08:00:00'),
  );
  assert.equal(
    nextScheduledRun({ kind: 'interval', hours: 6 }, monday09),
    at('2026-09-21T15:00:00'),
  );
});

test('enabling a schedule does not start work immediately', () => {
  // Without this, saving a schedule would launch an agent turn the user did not ask for yet.
  const now = at('2026-09-21T09:00:00');
  const decision = scheduleDecision({ ...base, cadence: { kind: 'daily', time: '08:00' } }, now);
  assert.equal(decision.due, false);
  assert.equal(decision.reason, null);
});

test('occurrences missed while RunHQ was closed collapse into one run', () => {
  const schedule = {
    ...base,
    cadence: { kind: 'daily', time: '08:00' },
    lastRunAt: at('2026-09-18T08:00:00'),
  };
  const decision = scheduleDecision(schedule, at('2026-09-21T09:00:00'));
  assert.equal(decision.due, true);
  assert.equal(decision.missed, 2, 'the 19th and 20th are reported, not replayed');
});

test('a paused or blocked schedule reports why instead of running', () => {
  const due = { ...base, cadence: { kind: 'interval', hours: 1 }, lastRunAt: 0 };
  assert.deepEqual(
    (({ due: d, reason }) => ({ d, reason }))(scheduleDecision({ ...due, enabled: false }, 10)),
    { d: false, reason: 'Paused' },
  );
  const blocked = scheduleDecision(due, at('2026-09-21T09:00:00'), () => 'Previous run is active');
  assert.equal(blocked.due, false);
  assert.equal(blocked.reason, 'Previous run is active');
});

test('a cadence describes itself in words a person can check', () => {
  assert.equal(describeCadence({ kind: 'interval', hours: 1 }), 'Every hour');
  assert.equal(describeCadence({ kind: 'interval', hours: 6 }), 'Every 6 hours');
  assert.equal(describeCadence({ kind: 'daily', time: '07:30' }), 'Every day at 07:30');
  assert.equal(describeCadence({ kind: 'weekly', day: 1, time: '09:00' }), 'Every Monday at 09:00');
});
