import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/ipc/terminalIpc.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(invoke) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    crypto: webcrypto,
    require: () => ({ invoke, Channel: class {} }),
  });
  return exports.terminalIpc;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const create = (ipc, id) => ipc.terminalCreate(id, '/tmp', 80, 24, () => {});

test('restart waits for pending creation and destruction, without blocking another project', async () => {
  const starting = deferred();
  const stopping = deferred();
  const calls = [];
  const ipc = setup((command, args) => {
    calls.push(`${command}:${args.id}`);
    if (args.id === 'a' && command === 'terminal_create' && calls.length === 1)
      return starting.promise;
    if (args.id === 'a' && command === 'terminal_destroy') return stopping.promise;
    return Promise.resolve();
  });
  const first = create(ipc, 'a');
  const destroy = ipc.terminalDestroy('a');
  const restart = create(ipc, 'a');
  await create(ipc, 'b');
  assert.deepEqual(calls, ['terminal_create:a', 'terminal_create:b']);
  starting.resolve();
  await first;
  await tick();
  assert.equal(calls.at(-1), 'terminal_destroy:a');
  stopping.resolve();
  await Promise.all([destroy, restart]);
  assert.equal(calls.at(-1), 'terminal_create:a');
});

test('input waits for creation and preserves byte order across chunked pastes', async () => {
  const starting = deferred();
  const bytes = [];
  const ipc = setup((command, args) => {
    if (command === 'terminal_create') return starting.promise;
    if (command === 'terminal_write') bytes.push(...args.data);
    return Promise.resolve();
  });
  const ready = create(ipc, 'a');
  const paste = Array.from({ length: 10_000 }, (_, i) => i % 256);
  const first = ipc.terminalWrite('a', paste);
  const second = ipc.terminalWrite('a', [42]);
  await tick();
  assert.equal(bytes.length, 0);
  starting.resolve();
  await Promise.all([ready, first, second]);
  assert.deepEqual(bytes, [...paste, 42]);
});

test('a blocked old paste cannot prevent restart or send its tail into the new shell', async () => {
  const writing = deferred();
  const calls = [];
  let blocked = true;
  const ipc = setup((command, args) => {
    calls.push({ command, data: args.data });
    if (command === 'terminal_write' && blocked) {
      blocked = false;
      return writing.promise;
    }
    return Promise.resolve();
  });
  await create(ipc, 'a');
  const oldWrite = ipc.terminalWrite('a', Array(8192).fill(1));
  const rejected = assert.rejects(oldWrite, /restarting/);
  await tick();
  await ipc.terminalDestroy('a');
  await create(ipc, 'a');
  await ipc.terminalWrite('a', [2]);
  writing.resolve();
  await rejected;
  assert.deepEqual(
    calls.filter((c) => c.command === 'terminal_write').map((c) => c.data.length),
    [4096, 1],
  );
});

test('failed creation does not poison later cleanup and restart', async () => {
  let attempts = 0;
  const ipc = setup((command) => {
    if (command === 'terminal_create' && ++attempts === 1)
      return Promise.reject(new Error('spawn failed'));
    return Promise.resolve();
  });
  await assert.rejects(create(ipc, 'a'), /spawn failed/);
  await ipc.terminalDestroy('a');
  await create(ipc, 'a');
  assert.equal(attempts, 2);
});
