import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/stackLogs.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const { mergeRecentLogLines } = exports;

test('stack preview matches the latest merged lines across differently sized command buffers', () => {
  const buffers = [
    Array.from({ length: 5000 }, (_, index) => ({ seq: index * 3 })),
    Array.from({ length: 900 }, (_, index) => ({ seq: index * 13 + 1 })),
    [],
    Array.from({ length: 4000 }, (_, index) => ({ seq: index * 4 + 2 })),
  ];
  const expected = buffers
    .flat()
    .sort((a, b) => a.seq - b.seq)
    .slice(-200);
  assert.deepEqual(Array.from(mergeRecentLogLines(buffers, 200)), expected);
  assert.equal(buffers[0].length, 5000);
  assert.equal(buffers[0][0].seq, 0);
});

test('stack previews inspect only the requested tail of each retained command buffer', () => {
  let reads = 0;
  const buffer = new Proxy(
    Array.from({ length: 5000 }, (_, seq) => ({ seq })),
    {
      get(target, key, receiver) {
        if (/^\d+$/.test(String(key))) reads++;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  assert.equal(mergeRecentLogLines([buffer], 200).length, 200);
  assert.equal(reads, 200);
  assert.equal(mergeRecentLogLines([buffer], 0).length, 0);
  assert.equal(mergeRecentLogLines([], 200).length, 0);
});
