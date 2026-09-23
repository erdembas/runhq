import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: () => ({}) },
  );
  return exports;
}
const { formatAgentDuration, agentElapsedMs, agentTaskTiming } = load(
  '../src/components/agents/agentDuration.ts',
);
const now = 1_000_000;

test('durations read in whole units and never invent precision', () => {
  assert.equal(formatAgentDuration(0), '0s');
  assert.equal(formatAgentDuration(45_000), '45s');
  assert.equal(formatAgentDuration(95_000), '1m 35s');
  assert.equal(formatAgentDuration(3_700_000), '1h 1m');
});

test('an unmeasured turn is absent rather than zero', () => {
  // Providers report tokens, not duration, so "no measurement" must not read as "took no time".
  for (const value of [null, undefined, Number.NaN, -1])
    assert.equal(formatAgentDuration(value), null);
  assert.equal(agentElapsedMs({ turn_started_at: null }, now), null);
  const idle = agentTaskTiming({ turn_started_at: null, total_run_ms: 0 }, now);
  assert.equal(idle.current, null);
  assert.equal(idle.total, null);
  assert.equal(idle.isRunning, false);
});

test('a running turn reports live elapsed time, an idle task its last turn', () => {
  const running = agentTaskTiming(
    { turn_started_at: now - 30_000, last_turn_ms: 5_000, total_run_ms: 5_000 },
    now,
  );
  assert.equal(running.isRunning, true);
  assert.equal(running.current, '30s');
  assert.equal(running.total, '5s');

  const finished = agentTaskTiming(
    { turn_started_at: null, last_turn_ms: 62_000, total_run_ms: 120_000 },
    now,
  );
  assert.equal(finished.isRunning, false);
  assert.equal(finished.current, '1m 2s');
  assert.equal(finished.total, '2m 0s');
});

test('a clock that moved backwards cannot produce a negative duration', () => {
  assert.equal(agentElapsedMs({ turn_started_at: now + 5_000 }, now), 0);
});
