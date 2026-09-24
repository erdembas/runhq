import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { TextEncoder } from 'node:util';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(name) {
  const source = readFileSync(
    new URL(`../src/components/ai/chat-panel/${name}.ts`, import.meta.url),
    'utf8',
  );
  const exports = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      crypto: { randomUUID },
      TextEncoder,
      setTimeout,
      require: (name) => {
        if (name === '@/lib/ai/aiGenerationSettings')
          return load('../../../lib/ai/aiGenerationSettings');
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return exports;
}
const { runCliChat, cliChatPrompt } = load('cliChatStream');
const { cliChatProviders, canUseChatProvider } = load('aiChatProviders');
const backend = {
  id: 'codex',
  name: 'Codex',
  adapter: 'codex',
  available: true,
  executable: '/bin/codex',
};
const history = [
  { role: 'system', content: 'Attached project context and selected log lines' },
  { role: 'user', content: 'What does the error mean?' },
  { role: 'assistant', content: 'An earlier response from an API provider' },
  { role: 'user', content: 'Explain the previous answer using CLI' },
];
const item = (id, kind, text, created_at = 1) => ({
  id,
  kind,
  text,
  created_at,
  status: 'completed',
  title: kind,
});
function harness({ pages = [], tool = backend } = {}) {
  const calls = [];
  const session = { id: 'runtime-session', status: 'idle', pending: [] };
  const controller = new globalThis.AbortController();
  const snapshots = [];
  const client = {
    agentCreate: async (input) => {
      calls.push(['create', input]);
      return session;
    },
    agentStart: async (input) => {
      calls.push(['start', input]);
      return { ...session, status: 'starting' };
    },
    agentSnapshot: async (id, before) => {
      calls.push(['snapshot', before]);
      return {
        session: { ...session, status: 'completed' },
        items: [item('a', 'assistant', 'Final answer')],
        before: null,
        ...pages.shift(),
      };
    },
    agentInterrupt: async (id) => {
      calls.push(['interrupt', id]);
    },
    agentUpdate: async (id, updates) => {
      calls.push(['update', updates]);
      return session;
    },
  };
  return {
    calls,
    client,
    controller,
    snapshots,
    session,
    args: {
      client,
      backend: tool,
      projectId: 'project',
      history,
      signal: controller.signal,
      onSnapshot: (snapshot, content, reasoning) =>
        snapshots.push({ snapshot, content, reasoning }),
      onStopError: (error) => calls.push(['stop-error', error]),
      wait: async () => {},
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('CLI turn preserves context and API history, streams final output, then archives its runtime transcript', async () => {
  const h = harness();
  const result = await runCliChat(h.args);
  assert.equal(result.content, 'Final answer');
  const request = h.calls.find(([method]) => method === 'start')[1];
  assert.equal(request.mode, 'plan');
  assert.deepEqual(JSON.parse(request.prompt.split('\n\n').at(-1)), history);
  assert.equal(h.snapshots.at(-1).content, 'Final answer');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), [
    'update',
    { archived: true, read: true },
  ]);
});

test('a provider switch sends canonical role-encoded history into a fresh run', async () => {
  const first = harness();
  const second = harness({ tool: { ...backend, id: 'claude', adapter: 'claude', name: 'Claude' } });
  await runCliChat(first.args);
  await runCliChat({
    ...second.args,
    history: [
      ...history,
      { role: 'assistant', content: 'Final answer' },
      { role: 'user', content: 'Continue' },
    ],
  });
  assert.equal(second.calls[0][1].backend, 'claude');
  const prompt = second.calls.find(([method]) => method === 'start')[1].prompt;
  const messages = JSON.parse(prompt.split('\n\n').at(-1));
  assert.equal(messages.length, history.length + 2);
  assert.equal(messages.at(-1).content, 'Continue');
  assert.equal(cliChatPrompt(history).includes('Do not change files'), true);
});

test('native input and approval requests are surfaced without being answered automatically', async () => {
  const pending = [{ id: 'approval', kind: 'approval', title: 'Allow command?' }];
  const h = harness({
    pages: [
      {
        session: { id: 'runtime-session', status: 'waiting_permission', pending },
        items: [],
        before: null,
      },
    ],
  });
  await runCliChat(h.args);
  assert.equal(h.snapshots[0].snapshot.session.pending, pending);
  assert.equal(
    h.calls.some(([method]) => method === 'answer'),
    false,
  );
});

test('fast turns hydrate earlier transcript pages and retain complete assistant output', async () => {
  const h = harness({
    pages: [
      { items: [item('b', 'assistant', 'Second', 1)], before: 2 },
      { items: [item('a', 'assistant', 'First', 1)], before: null },
    ],
  });
  const result = await runCliChat(h.args);
  assert.equal(result.content, 'First\n\nSecond');
  assert.equal(
    h.calls.some(([method, before]) => method === 'snapshot' && before === 2),
    true,
  );
});

test('late updates to earlier messages retain durable transcript order', async () => {
  const h = harness({
    pages: [
      {
        session: { id: 'runtime-session', status: 'running', pending: [] },
        items: [item('a', 'assistant', 'First', 1), item('b', 'assistant', 'Second', 2)],
        before: null,
      },
      {
        items: [item('a', 'assistant', 'First completed', 20), item('b', 'assistant', 'Second', 2)],
        before: null,
      },
    ],
  });
  const result = await runCliChat(h.args);
  assert.equal(result.content, 'First completed\n\nSecond');
});

test('stopping before creation starts no runtime; stopping during creation never sends the prompt', async () => {
  const before = harness();
  before.controller.abort();
  assert.equal(await runCliChat(before.args), null);
  assert.equal(before.calls.length, 0);
  const h = harness();
  const creation = deferred();
  h.client.agentCreate = async () => creation.promise;
  const run = runCliChat(h.args);
  h.controller.abort();
  creation.resolve(h.session);
  assert.equal(await run, null);
  assert.equal(
    h.calls.some(([method]) => method === 'start'),
    false,
  );
  assert.equal(h.calls.at(-1)[0], 'update');
});

test('stopping during start interrupts once after acknowledgement and archives only after completion', async () => {
  const h = harness({
    pages: [
      {
        session: { id: 'runtime-session', status: 'cancelling', pending: [] },
        items: [],
        before: null,
      },
      {
        session: { id: 'runtime-session', status: 'cancelled', pending: [] },
        items: [],
        before: null,
      },
    ],
  });
  const starting = deferred();
  const started = deferred();
  h.client.agentStart = async () => {
    started.resolve();
    return starting.promise;
  };
  const run = runCliChat(h.args);
  await started.promise;
  h.controller.abort();
  starting.resolve({ ...h.session, status: 'running' });
  assert.equal(await run, null);
  assert.equal(h.calls.filter(([method]) => method === 'interrupt').length, 1);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.calls.at(-1)[0], 'update');
});

test('provider failures preserve partial output, propagate the error and never retry a CLI run', async () => {
  const h = harness({
    pages: [
      {
        session: {
          id: 'runtime-session',
          status: 'failed',
          pending: [],
          last_error: 'Login required',
        },
        items: [item('a', 'assistant', 'Partial')],
        before: null,
      },
    ],
  });
  await assert.rejects(runCliChat(h.args), /Login required/);
  assert.equal(h.snapshots[0].content, 'Partial');
  assert.equal(h.calls.filter(([method]) => method === 'start').length, 1);
  assert.equal(h.calls.at(-1)[0], 'update');
});

test('ACP keeps its provider-defined default mode and unavailable/terminal tools are not sendable', async () => {
  const h = harness({ tool: { ...backend, id: 'cursor', adapter: 'acp' } });
  await runCliChat(h.args);
  assert.equal(h.calls.find(([method]) => method === 'start')[1].mode, 'default');
  const providers = cliChatProviders([
    backend,
    { ...backend, id: 'missing', available: false },
    { ...backend, id: 'off', enabled: false },
    { ...backend, id: 'shell', adapter: 'terminal' },
  ]);
  assert.equal(providers.length, 2);
  assert.equal(canUseChatProvider(providers[0]), true);
  assert.equal(canUseChatProvider(providers[1]), false);
});

test('selected reasoning effort, work mode and profile reach both CLI session creation and its turn', async () => {
  const h = harness();
  await runCliChat({
    ...h.args,
    model: 'selected-model',
    effort: 'high',
    mode: 'default',
    agent: 'reviewer',
  });
  for (const method of ['create', 'start']) {
    const input = h.calls.find(([name]) => name === method)[1];
    assert.equal(input.model, 'selected-model');
    assert.equal(input.effort, 'high');
    assert.equal(input.mode, 'default');
    assert.equal(input.agent, 'reviewer');
  }
  assert.match(h.calls.find(([name]) => name === 'start')[1].prompt, /selected agent mode/);
});

test('ACP Ask retains its exact native mode and a read-only prompt', async () => {
  const h = harness({ tool: { ...backend, id: 'cursor', adapter: 'acp' } });
  await runCliChat({ ...h.args, mode: 'default', agent: 'ask', effort: 'provider-variant' });
  const start = h.calls.find(([name]) => name === 'start')[1];
  assert.equal(start.agent, 'ask');
  assert.equal(start.effort, 'provider-variant');
  assert.match(start.prompt, /Do not change files/);
});
