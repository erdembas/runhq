import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../../../packages/cockpit-ui/src/lib/agentMissionControl.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const { agentTaskLane, groupAgentTasks } = exports;
const session = (status, properties = {}) => ({
  id: status,
  status,
  pending: [],
  unread: false,
  updated_at: 1,
  ...properties,
});

test('every lifecycle state has a board lane, and pending work always needs attention', () => {
  const expected = {
    idle: 'ready',
    starting: 'working',
    running: 'working',
    waiting_input: 'attention',
    waiting_permission: 'attention',
    cancelling: 'working',
    completed: 'completed',
    failed: 'attention',
    cancelled: 'ready',
    interrupted: 'attention',
  };
  for (const [status, lane] of Object.entries(expected)) {
    assert.equal(agentTaskLane(session(status)), lane, status);
    assert.equal(
      agentTaskLane(session(status, { pending: [{ id: 'approval' }] })),
      'attention',
      `pending request in ${status}`,
    );
  }
});

test('board totals use only the supplied view and prioritize unread updates without mutating it', () => {
  const input = [
    session('completed', { id: 'older', updated_at: 2 }),
    session('running', { id: 'active' }),
    session('completed', { id: 'unread', unread: true, updated_at: 1 }),
    session('completed', { id: 'newer', updated_at: 3 }),
  ];
  const original = input.slice();
  const groups = groupAgentTasks(input);
  assert.equal(Object.values(groups).flat().length, input.length);
  assert.equal(groups.attention.length, 0);
  assert.equal(groups.ready.length, 0);
  assert.equal(groups.working[0].id, 'active');
  assert.deepEqual(
    Array.from(groups.completed, ({ id }) => id),
    ['unread', 'newer', 'older'],
  );
  assert.deepEqual(input, original);
});
