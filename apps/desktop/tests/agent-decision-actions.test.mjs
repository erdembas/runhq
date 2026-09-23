import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function setup() {
  const exports = {};
  const state = {
    sessions: { task: { pending: [{ id: 'request' }], status: 'waiting_permission' } },
    refresh: async () => {},
  };
  let finish;
  const sent = [];
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL('../src/components/agents/agentDecisionActions.ts', import.meta.url),
        'utf8',
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    {
      exports,
      require: (name) => {
        if (name === '@/store/useAgentStore') return { useAgentStore: { getState: () => state } };
        if (name === '@/lib/ipc')
          return {
            ipc: {
              agentAnswer: (...args) => {
                sent.push(args);
                return new Promise((resolve) => {
                  finish = resolve;
                });
              },
            },
          };
        throw new Error(name);
      },
    },
  );
  return { ...exports, state, sent, finish: () => finish() };
}

test('decision reply retains the exact provider payload and rejects concurrent answers', async () => {
  const context = setup();
  const value = { decision: { optionId: 'allow-once', scope: 'operation' } };
  const first = context.answerPendingAgentRequest('task', 'request', value);
  await assert.rejects(
    context.answerPendingAgentRequest('task', 'request', value),
    /already being sent/,
  );
  assert.equal(context.sent.length, 1);
  assert.equal(context.sent[0][0], 'task');
  assert.equal(context.sent[0][1], 'request');
  assert.equal(context.sent[0][2], value);
  context.finish();
  await first;
});

test('resolved and cancelling requests are rejected before IPC', async () => {
  const context = setup();
  context.state.sessions.task.pending = [];
  await assert.rejects(
    context.answerPendingAgentRequest('task', 'request', {}),
    /no longer waiting/,
  );
  context.state.sessions.task.pending = [{ id: 'request' }];
  context.state.sessions.task.status = 'cancelling';
  await assert.rejects(
    context.answerPendingAgentRequest('task', 'request', {}),
    /no longer waiting/,
  );
  assert.equal(context.sent.length, 0);
});
