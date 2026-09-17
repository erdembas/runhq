import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/components/agents/agentTaskLauncher.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const exports = {};
runInNewContext(compiled, { exports, crypto: { randomUUID } });
const { createAgentTaskLauncher } = exports;
const input = {
  project_id: 'project-a',
  backend: 'claude',
  isolated: true,
  model: 'opus',
  effort: 'high',
  mode: 'plan',
  agent: 'reviewer',
};
const session = { ...input, id: 'session-a' };

test('one send creates the chosen project workspace and starts its first turn with the selected settings', async () => {
  const order = [];
  const launcher = createAgentTaskLauncher({
    create: async (actual) => {
      assert.equal(actual, input);
      order.push('create');
      return session;
    },
    created: (actual, text) => {
      assert.equal(actual.id, session.id);
      assert.equal(text, 'Review this change');
      order.push('save draft');
    },
    start: async (turn) => {
      assert.equal(turn.session_id, session.id);
      assert.equal(turn.prompt, 'Review this change');
      for (const key of ['model', 'effort', 'mode', 'agent']) assert.equal(turn[key], input[key]);
      assert(turn.request_id);
      order.push('send');
      return { ...session, status: 'running' };
    },
  });
  assert.equal((await launcher.send(input, 'Review this change')).status, 'running');
  assert.deepEqual(order, ['create', 'save draft', 'send']);
});

test('double submission shares one creation and one first turn', async () => {
  let release;
  let creations = 0;
  let starts = 0;
  const launcher = createAgentTaskLauncher({
    create: () => {
      creations++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    created: () => {},
    start: async () => {
      starts++;
      return session;
    },
  });
  const first = launcher.send(input, 'Build it');
  const second = launcher.send(input, 'Build it');
  assert.equal(first, second);
  release(session);
  await Promise.all([first, second]);
  assert.equal(creations, 1);
  assert.equal(starts, 1);
});

test('failed first turn retains its workspace, message and idempotency key for retry', async () => {
  let creations = 0;
  const turns = [];
  const launcher = createAgentTaskLauncher({
    create: async () => {
      creations++;
      return session;
    },
    created: () => {},
    start: async (turn) => {
      turns.push(turn);
      if (turns.length === 1) throw new Error('Connection lost');
      return session;
    },
  });
  await assert.rejects(launcher.send(input, 'Original message'), /Connection lost/);
  assert.equal(launcher.session.id, session.id);
  await launcher.send({ ...input, backend: 'codex' }, 'Changed message');
  assert.equal(creations, 1);
  assert.equal(turns[0], turns[1]);
  assert.equal(turns[1].prompt, 'Original message');
});

test('a creation error permits retry and an empty message never creates a workspace', async () => {
  let creations = 0;
  let starts = 0;
  const launcher = createAgentTaskLauncher({
    create: async () => {
      if (++creations === 1) throw new Error('Invalid workspace');
      return session;
    },
    created: () => {},
    start: async () => {
      starts++;
      return session;
    },
  });
  await assert.rejects(launcher.send(input, '   '), /Write a message/);
  assert.equal(creations, 0);
  await assert.rejects(launcher.send(input, 'Fix it'), /Invalid workspace/);
  assert.equal(launcher.session, null);
  assert.equal(starts, 0);
  await launcher.send(input, 'Fix it');
  assert.equal(creations, 2);
  assert.equal(starts, 1);
});
