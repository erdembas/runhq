import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../src/components/agents/agentSnapshotMerge.ts', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports },
);
const { mergeAgentSnapshot } = exports;
const item = (id, text = 'Message') => ({
  id,
  text,
  kind: 'assistant',
  title: 'Agent',
  status: 'completed',
  created_at: 1,
});
const snapshot = (items, before = null, id = 'session') => ({
  session: { id, revision: 1 },
  items,
  before,
});

test('streaming one message preserves every unchanged transcript item reference', () => {
  const previous = snapshot(Array.from({ length: 500 }, (_, i) => item(String(i))));
  const incoming = snapshot(previous.items.map((entry) => ({ ...entry })));
  incoming.items[499].text += ' new token';
  const next = mergeAgentSnapshot(previous, incoming);
  assert.equal(next.items.filter((entry, i) => entry === previous.items[i]).length, 499);
  assert.equal(next.items[499], incoming.items[499]);
  assert.equal(previous.items[499].text, 'Message');
});

test('status-only snapshots preserve the entire transcript array', () => {
  const previous = snapshot([item('a'), item('b')]);
  const incoming = snapshot(previous.items.map((entry) => ({ ...entry })));
  incoming.session.revision += 1;
  const next = mergeAgentSnapshot(previous, incoming);
  assert.equal(next.items, previous.items);
  assert.equal(next.session.revision, 2);
});

test('refresh retains loaded history and its pagination cursor without duplicating overlap', () => {
  const older = item('older');
  const overlap = item('overlap');
  const next = mergeAgentSnapshot(
    snapshot([older, overlap], 10),
    snapshot([{ ...overlap }, item('new')], 20),
  );
  assert.deepEqual(
    Array.from(next.items, (entry) => entry.id),
    ['older', 'overlap', 'new'],
  );
  assert.equal(next.items[0], older);
  assert.equal(next.items[1], overlap);
  assert.equal(next.before, 10);
});

test('metadata changes update the rendered item even when message text stays unchanged', () => {
  for (const [field, value] of [
    ['kind', 'notice'],
    ['title', 'Updated'],
    ['status', 'running'],
    ['created_at', 2],
  ]) {
    const original = item('a');
    const changed = { ...original, [field]: value };
    const next = mergeAgentSnapshot(snapshot([original]), snapshot([changed]));
    assert.equal(next.items[0], changed, `${field} must not reuse stale content`);
  }
});

test('switching conversations never retains another conversation history', () => {
  const next = snapshot([item('b')], null, 'different-session');
  assert.equal(mergeAgentSnapshot(snapshot([item('a')]), next), next);
});
