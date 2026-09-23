import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function compile(path, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, ...globals });
  return exports;
}

function setup(characterCount = 1, elapsedPerEntry = 0) {
  const timers = new Map();
  const drains = [];
  const written = [];
  let nextTimer = 0;
  let now = 0;
  let drainCount = 0;
  const { queueTerminalWrites } = compile('../src/components/log-panel/terminalWriteQueue.ts', {
    performance: { now: () => now },
    setTimeout: (callback) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const cancel = queueTerminalWrites({
    from: 20,
    to: 1020,
    append: (index) => {
      written.push(index);
      now += elapsedPerEntry;
      return characterCount;
    },
    drain: (done) => drains.push(done),
    onDrain: () => drainCount++,
  });
  const flushTimer = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  return { cancel, timers, drains, written, flushTimer, drainCount: () => drainCount };
}

test('large backlogs yield before formatting and keep only one bounded batch in flight', () => {
  const queue = setup();
  assert.equal(queue.written.length, 0);
  queue.flushTimer();
  assert.equal(queue.written.length, 128);
  assert.equal(queue.timers.size, 0);
  assert.equal(queue.drains.length, 1);
  queue.drains.shift()();
  assert.equal(queue.drainCount(), 1);
  assert.equal(queue.timers.size, 1);
  while (queue.timers.size) {
    queue.flushTimer();
    queue.drains.shift()();
  }
  assert.deepEqual(
    queue.written,
    Array.from({ length: 1000 }, (_, i) => i + 20),
  );
});

test('long entries and expensive formatting also yield before reaching the line limit', () => {
  const largeEntries = setup(40_000);
  largeEntries.flushTimer();
  assert.equal(largeEntries.written.length, 2);
  const expensiveEntries = setup(1, 2);
  expensiveEntries.flushTimer();
  assert.equal(expensiveEntries.written.length, 2);
});

test('hiding or replacing a view cancels both scheduled and in-flight catch-up', () => {
  const scheduled = setup();
  scheduled.cancel();
  assert.equal(scheduled.timers.size, 0);
  assert.equal(scheduled.written.length, 0);
  const inFlight = setup();
  inFlight.flushTimer();
  inFlight.cancel();
  inFlight.drains.shift()();
  assert.equal(inFlight.timers.size, 0);
  assert.equal(inFlight.written.length, 128);
  assert.equal(inFlight.drainCount(), 0);
});

test('replayed line markers register after preceding asynchronous terminal writes', () => {
  const { appendLineWithMarker } = compile('../src/components/log-xterm/markers.ts', {
    require: () => ({ formatLineBytes: (line) => `${line.text}\r\n` }),
  });
  const queued = [];
  const markers = [];
  let row = 0;
  const term = {
    write: (data, callback) =>
      queued.push(() => {
        row += data.split('\n').length - 1;
        callback?.();
      }),
    registerMarker: () => ({ line: row }),
  };
  appendLineWithMarker(term, { text: 'first' }, markers, {});
  appendLineWithMarker(term, { text: 'second' }, markers, {});
  assert.equal(markers.length, 0);
  for (const parse of queued) parse();
  assert.deepEqual(
    markers.map((marker) => marker.line),
    [0, 1],
  );
});

test('unsupported marker slots do not shift subsequent entry indexes', () => {
  const { appendLineWithMarker, findLineIndexAtY } = compile(
    '../src/components/log-xterm/markers.ts',
    {
      require: () => ({ formatLineBytes: (line) => `${line.text}\r\n` }),
    },
  );
  const queued = [];
  const markers = [];
  let nextMarker = 0;
  const term = {
    write: (_, callback) => {
      if (callback) queued.push(callback);
    },
    registerMarker: () => (++nextMarker === 1 ? undefined : { line: 5 }),
  };
  appendLineWithMarker(term, { text: 'alternate screen' }, markers, {});
  appendLineWithMarker(term, { text: 'normal screen' }, markers, {});
  queued.forEach((callback) => callback());
  assert.equal(markers.length, 2);
  assert.equal(markers[0], undefined);
  assert.equal(findLineIndexAtY(markers, 5), 1);
});

test('pointer actions resolve submitted sequences while the source buffer changes ahead of parsing', () => {
  const markersModule = compile('../src/components/log-xterm/markers.ts', {
    require: () => ({}),
  });
  const { lineIndexFromPointer } = compile('../src/components/log-xterm/pointer.ts', {
    require: () => markersModule,
  });
  const term = { rows: 10, buffer: { active: { type: 'normal', viewportY: 0 } } };
  const markers = [0, 1, 2].map((line) => ({ line }));
  const rect = { height: 100, top: 0 };
  const lines = (sequences) => sequences.map((seq) => ({ seq }));
  const locate = (written, current, y) =>
    lineIndexFromPointer(term, markers, written, lines(current), rect, y);
  assert.equal(locate([1, 2, 3], [1, 2, 3], 25), 2, 'aligned fast path');
  assert.equal(locate([1, 2, 3], [3, 4, 5], 25), 0, 'retention trimmed earlier entries');
  assert.equal(locate([1, 3, 7], [3, 7], 15), 0, 'filter removed an earlier entry');
  assert.equal(
    locate([1, 2, 3], [3, 4, 5], 15),
    -1,
    'removed entry cannot target a different line',
  );
  term.buffer.active.type = 'alternate';
  assert.equal(
    locate([1, 2, 3], [1, 2, 3], 25),
    -1,
    'normal markers do not describe alternate screen',
  );
});
