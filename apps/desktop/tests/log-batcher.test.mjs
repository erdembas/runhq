import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/store/runtime/logBatcher.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const exports = {};
  const timers = [];
  runInNewContext(compiled, {
    exports,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
  });
  return { ...exports, timers };
}
const line = (seq) => ({ seq, text: `line ${seq}`, stream: 'stdout', ts_ms: seq });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a burst across projects produces one store update and retains order', () => {
  const { createLogBatcher, timers } = setup();
  const batches = [];
  const batcher = createLogBatcher((batch) => batches.push(plain(batch)), 5000);
  for (let i = 1; i <= 1000; i++) {
    batcher.append('a', line(i));
    batcher.append('b', line(i));
  }
  assert.equal(timers.length, 1);
  assert.equal(batches.length, 0);
  timers.shift()();
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].a.map((entry) => entry.seq),
    Array.from({ length: 1000 }, (_, i) => i + 1),
  );
  assert.equal(batches[0].b.length, 1000);
  batcher.append('a', line(1001));
  assert.equal(timers.length, 1);
});

test('clearing a project discards queued logs without dropping another project', () => {
  const { createLogBatcher, timers } = setup();
  let result;
  const batcher = createLogBatcher((batch) => {
    result = plain(batch);
  }, 3);
  batcher.append('a', line(1));
  batcher.append('b', line(2));
  batcher.drop('a');
  timers.shift()();
  assert.deepEqual(result, { b: [line(2)] });
});

test('a large burst is bounded and keeps the most recent entries', () => {
  const { createLogBatcher, appendLogBatch, timers } = setup();
  let result;
  const batcher = createLogBatcher((batch) => {
    assert.ok(batch.a.length < 6);
    result = appendLogBatch({ lines: [], lastSeq: 0 }, batch.a, 3);
  }, 3);
  for (let i = 1; i <= 10000; i++) batcher.append('a', line(i));
  timers.shift()();
  assert.deepEqual(
    plain(result.lines).map((entry) => entry.seq),
    [9998, 9999, 10000],
  );
});

test('deduplication, rolling retention and no-op identity match live log semantics', () => {
  const { appendLogBatch } = setup();
  const current = { lines: [line(1), line(2)], lastSeq: 2 };
  assert.equal(appendLogBatch(current, [line(1), line(2)], 3), current);
  const next = appendLogBatch(current, [line(2), line(3), line(3), line(4), line(5)], 3);
  assert.deepEqual(plain(next), { lines: [line(3), line(4), line(5)], lastSeq: 5 });
  assert.deepEqual(current, { lines: [line(1), line(2)], lastSeq: 2 });
});
