import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Context, elicitationResponse, elicitationView } from '../src/protocol.mjs';
import { runCodex } from '../src/codex.mjs';
import { runOpenCode } from '../src/opencode.mjs';
import { runClaude } from '../src/claude.mjs';

const until = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for agent event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
function fixture(backend, onEvent = () => {}) {
  const events = [];
  const ctx = new Context(
    { cwd: process.cwd(), native_id: 'saved-thread', mode: 'plan', prompt: 'Hello' },
    (e) => {
      events.push(e);
      onEvent(e);
    },
  );
  const spawnChild = ctx.child.bind(ctx);
  ctx.child = (_executable, args, options) =>
    spawnChild(
      process.execPath,
      [
        fileURLToPath(new URL(`./fixtures/${backend}.mjs`, import.meta.url)),
        ...(backend === 'opencode' ? [args.at(-1)] : []),
      ],
      options,
    );
  return { ctx, events };
}

test(
  'Codex resumes native thread, asks, accepts answers and finishes streaming',
  { timeout: 10000 },
  async () => {
    const { ctx, events } = fixture('codex');
    try {
      const result = runCodex(ctx);
      await until(() => events.some((e) => e.type === 'request'));
      await ctx.answer('900', { answers: { color: ['Blue'] } });
      assert.equal((await result).status, 'completed');
      assert.equal(ctx.items.get('answer').text, 'Blue');
      assert.equal(ctx.items.get('answer').status, 'completed');
    } finally {
      ctx.close();
    }
  },
);
test(
  'Codex steering uses active turn guard and interrupt reaches native protocol',
  { timeout: 10000 },
  async () => {
    const { ctx, events } = fixture('codex');
    try {
      const result = runCodex(ctx);
      await until(() => events.some((e) => e.type === 'request'));
      await ctx.steer('Pause this task');
      await ctx.interrupt();
      assert.equal((await result).status, 'cancelled');
    } finally {
      ctx.close();
    }
  },
);
test(
  'OpenCode authenticates its owned server and routes permissions and multiple answers',
  { timeout: 15000 },
  async () => {
    const { ctx, events } = fixture('opencode');
    try {
      const result = runOpenCode(ctx);
      result.catch(() => {});
      await until(() => ctx.requests.has('p1'));
      assert(!ctx.requests.has('ignore'));
      await ctx.answer('p1', { decision: 'reject' });
      await until(() => ctx.requests.has('q1'));
      await ctx.answer('q1', { answers: { 0: ['A', 'B'] } });
      assert.equal((await result).status, 'completed');
      assert(
        !ctx.items.has('echo'),
        'Do not present the echoed user prompt as an assistant response',
      );
      assert.equal(ctx.items.get('final').text, 'Received both answers');
      assert(events.some((e) => e.type === 'native' && e.id === 'saved-thread'));
    } finally {
      ctx.close();
    }
  },
);
test('MCP form responses reject nonobjects and only expose HTTP browser links', () => {
  assert.throws(() => elicitationResponse({ action: 'accept', content: [] }), /JSON object/);
  assert.deepEqual(elicitationResponse({ action: 'decline', content: { secret: 'discard' } }), {
    action: 'decline',
  });
  assert.equal(elicitationView({ url: 'file:///etc/passwd' }).url, undefined);
  assert.equal(
    elicitationView({ url: 'https://example.com/auth' }).url,
    'https://example.com/auth',
  );
});
test(
  'Claude SDK callbacks resolve user questions, deny tools and answer MCP forms',
  { timeout: 10000 },
  async () => {
    const events = [];
    const ctx = new Context(
      { cwd: process.cwd(), prompt: 'Hello', native_id: 'saved-thread' },
      (e) => events.push(e),
    );
    let closed = false;
    const mockQuery = ({ options }) => ({
      close() {
        closed = true;
      },
      async *[Symbol.asyncIterator]() {
        assert.equal(options.resume, 'saved-thread');
        const signal = new AbortController().signal;
        const answer = await options.canUseTool(
          'AskUserQuestion',
          { questions: [{ question: 'Pick', options: [{ label: 'A' }] }] },
          { toolUseID: 'q', signal },
        );
        assert.equal(answer.updatedInput.answers.Pick, 'A');
        const denied = await options.canUseTool(
          'Bash',
          { command: 'echo test' },
          { toolUseID: 'p', signal },
        );
        assert.equal(denied.behavior, 'deny');
        const form = await options.onElicitation(
          { message: 'Name?', requestedSchema: { type: 'object' } },
          { requestId: 'f', signal },
        );
        assert.deepEqual(form, { action: 'accept', content: { name: 'Test' } });
        yield {
          type: 'assistant',
          session_id: 'saved-thread',
          message: { id: 'm', content: [{ type: 'text', text: 'Done' }] },
        };
        yield { type: 'result', is_error: false };
      },
    });
    try {
      const result = runClaude(ctx, false, mockQuery);
      await until(() => ctx.requests.has('q'));
      await ctx.answer('q', { answers: { Pick: ['A'] } });
      await until(() => ctx.requests.has('p'));
      await ctx.answer('p', { decision: 'decline' });
      await until(() => ctx.requests.has('elicitation-f'));
      await ctx.answer('elicitation-f', { action: 'accept', content: { name: 'Test' } });
      assert.equal((await result).status, 'completed');
      assert(closed);
      assert.equal(ctx.items.get('m-0').text, 'Done');
    } finally {
      ctx.close();
    }
  },
);

test(
  'Bridge acknowledges an answer when OpenCode finishes before the HTTP reply',
  { timeout: 15000, skip: process.platform === 'win32' },
  async () => {
    const { spawn } = await import('node:child_process');
    const { jsonLines } = await import('../src/protocol.mjs');
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../src/main.mjs', import.meta.url))],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stderr.resume();
    const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
    const acknowledged = [];
    try {
      send({
        type: 'start',
        config: {
          backend: 'opencode',
          executable: fileURLToPath(new URL('./fixtures/opencode.mjs', import.meta.url)),
          cwd: process.cwd(),
          native_id: 'saved-thread',
          mode: 'default',
          prompt: 'Hello',
        },
      });
      for await (const event of jsonLines(child.stdout)) {
        if (event.type === 'request')
          send({
            type: 'answer',
            id: event.request.id,
            command_id: event.request.id,
            value:
              event.request.kind === 'approval'
                ? { decision: 'reject' }
                : { answers: { 0: ['A', 'B'] } },
          });
        if (event.type === 'ack') acknowledged.push(event.command_id);
        if (event.type === 'finished') {
          assert.equal(event.status, 'completed');
          assert(
            acknowledged.includes('q1'),
            'The successful answer must be acknowledged before completion',
          );
          return;
        }
      }
      assert.fail('Bridge exited without completion');
    } finally {
      child.kill();
    }
  },
);

test('Claude discovery preserves version metadata without starting a model turn', async () => {
  const ctx = new Context({ cwd: process.cwd() }, () => {});
  let closed = false;
  try {
    const result = await runClaude(ctx, true, ({ prompt }) => {
      assert.equal(typeof prompt[Symbol.asyncIterator], 'function');
      return {
        supportedModels: async () => [
          {
            value: 'opus',
            displayName: 'Opus',
            resolvedModel: 'claude-opus-test',
            description: 'Resolved provider version',
            supportedEffortLevels: ['low', 'high'],
          },
          { value: 'sonnet[1m]', displayName: 'Sonnet', description: 'Legacy CLI description' },
          { value: 'claude-custom', displayName: 'Custom', description: 'Pinned model' },
        ],
        supportedCommands: async () => [],
        close: () => {
          closed = true;
        },
        [Symbol.asyncIterator]() {
          throw new Error('Discovery must not start a model turn');
        },
      };
    });
    assert.equal(result.models[0].resolved_model, 'claude-opus-test');
    assert.equal(result.models[0].description, 'Resolved provider version');
    assert.equal(result.models[0].is_alias, true);
    assert.deepEqual(result.models[0].efforts, ['low', 'high']);
    assert.equal(result.models[1].resolved_model, undefined);
    assert.equal(result.models[1].is_alias, true);
    assert.equal(result.models[2].is_alias, false);
    assert(closed);
  } finally {
    ctx.close();
  }
});

test('Claude passes pinned model IDs and Agent / Plan permissions unchanged', async () => {
  for (const mode of ['default', 'plan']) {
    const ctx = new Context(
      {
        cwd: process.cwd(),
        model: 'provider.exact-model-version',
        effort: 'high',
        mode,
        prompt: 'Test',
      },
      () => {},
    );
    try {
      await runClaude(ctx, false, ({ options }) => ({
        close() {},
        async *[Symbol.asyncIterator]() {
          assert.equal(options.model, 'provider.exact-model-version');
          assert.equal(options.permissionMode, mode);
          assert.equal(options.effort, 'high');
          yield { type: 'result', is_error: false };
        },
      }));
    } finally {
      ctx.close();
    }
  }
});
