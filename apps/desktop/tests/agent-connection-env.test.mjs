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
    { exports, require: () => ({}) },
  );
  return exports;
}
const { parseEnvironmentLines, environmentLines } = load(
  '../src/components/agents/agentConnectionEnv.ts',
);
// The module runs in its own VM realm, so compare plain data rather than realm-bound objects.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('an account environment survives a round trip through the editor', () => {
  const env = { CODEX_HOME: '/Users/me/.codex-work', OPENAI_BASE_URL: 'https://example.test/v1' };
  assert.deepEqual(plain(parseEnvironmentLines(environmentLines(env)).env), env);
  assert.equal(environmentLines(undefined), '');
  assert.deepEqual(plain(parseEnvironmentLines('').env), {});
});

test('blank lines and comments are ignored and a value may contain equals signs', () => {
  const { env, invalid } = parseEnvironmentLines(
    ['# work account', '', '  CODEX_HOME = /home/work  ', 'TOKEN_HINT=a=b=c'].join('\n'),
  );
  assert.equal(invalid, null);
  assert.deepEqual(plain(env), { CODEX_HOME: '/home/work', TOKEN_HINT: 'a=b=c' });
});

test('a malformed line is reported rather than dropped', () => {
  // Silently discarding it would start the connection against the wrong account.
  const { invalid } = parseEnvironmentLines('CODEX_HOME=/home/work\njust-a-name');
  assert.equal(invalid, 'just-a-name');
  assert.equal(parseEnvironmentLines('=novalue').invalid, '=novalue');
});
