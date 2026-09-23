import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(path, resolve = () => ({})) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: resolve },
  );
  return exports;
}
const duration = load('../src/components/agents/agentDuration.ts');
const { parseAgentSubagent, agentSubagentSummary } = load(
  '../src/components/agents/agentSubagentItem.ts',
  (name) => (name === './agentDuration' ? duration : {}),
);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a reported subagent becomes structured detail', () => {
  const details = parseAgentSubagent(
    JSON.stringify({
      prompt: 'Find route handlers',
      agentId: 'explorer-1',
      subagentType: 'explore',
      model: 'composer-1',
      durationMs: 123_000,
    }),
  );
  assert.deepEqual(plain(details), {
    prompt: 'Find route handlers',
    type: 'explore',
    model: 'composer-1',
    agentId: 'explorer-1',
    duration: '2m 3s',
  });
  assert.deepEqual(plain(agentSubagentSummary(details)), ['explore', 'composer-1', '2m 3s']);
});

test('missing fields are absent rather than invented', () => {
  const details = parseAgentSubagent(JSON.stringify({ prompt: '  ', subagentType: 'review' }));
  assert.equal(details.prompt, null);
  assert.equal(details.model, null);
  assert.equal(details.duration, null);
  assert.deepEqual(plain(agentSubagentSummary(details)), ['review']);
});

test('a malformed payload still shows what the provider sent', () => {
  // Providers own this payload, so an unexpected body must not make the item disappear.
  const details = parseAgentSubagent('not json at all');
  assert.equal(details.prompt, 'not json at all');
  assert.deepEqual(plain(agentSubagentSummary(details)), []);
  assert.equal(parseAgentSubagent('[1,2]').prompt, '[1,2]');
});
