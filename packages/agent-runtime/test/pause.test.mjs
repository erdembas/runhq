import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseGate } from '../src/pause.mjs';
import { Context } from '../src/protocol.mjs';
import { runClaude, claudeSupportsPause } from '../src/claude.mjs';

test('early pause support is limited to verified CLI versions; unknown builds use observed hooks', () => {
  for (const version of ['2.1.119', '2.1.120', '2.2.0']) assert(claudeSupportsPause(version));
  for (const version of ['2.1.118', '2.0.999', '3.0.0', '2.1.119-custom', undefined])
    assert.equal(claudeSupportsPause(version), false);
});

test('pause is acknowledged only at a checkpoint, and resumes the same continuation', async () => {
  const events = [];
  const gate = new PauseGate((event) => events.push(event.state));
  assert.throws(() => gate.request(), /unavailable/);
  gate.enable();
  gate.request();
  gate.request();
  assert.deepEqual(events, ['running', 'pausing']);
  let nextRequests = 0;
  const step = gate.checkpoint().then(() => nextRequests++);
  await Promise.resolve();
  assert.equal(nextRequests, 0);
  assert.equal(gate.state, 'paused');
  gate.resume();
  await step;
  assert.equal(nextRequests, 1);
  assert.deepEqual(events, ['running', 'pausing', 'paused', 'running']);
  gate.close();
});

test('withdraw pause before the checkpoint, then pause again without replaying work', async () => {
  const gate = new PauseGate(() => {});
  gate.enable();
  gate.request();
  gate.resume();
  await gate.checkpoint();
  gate.request();
  const step = gate.checkpoint();
  assert.equal(gate.state, 'paused');
  gate.resume();
  await step;
  gate.close();
});

test('a rapid resume/pause cannot leak the waiting operation through the barrier', async () => {
  const gate = new PauseGate(() => {});
  gate.enable();
  gate.request();
  let advanced = false;
  const step = gate.checkpoint().then(() => {
    advanced = true;
  });
  gate.resume();
  gate.request();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(advanced, false);
  assert.equal(gate.state, 'paused');
  gate.resume();
  await step;
  gate.close();
});

test('stop releases all blocked callbacks with errors, never as successful resumes', async () => {
  const gate = new PauseGate(() => {});
  gate.enable();
  gate.request();
  const steps = [gate.checkpoint(), gate.checkpoint()];
  gate.close();
  const results = await Promise.allSettled(steps);
  assert(results.every((result) => result.status === 'rejected'));
  assert.equal(gate.waiters.size, 0);
  assert.throws(() => gate.resume(), /unavailable/);
});

test('hook cancellation releases its waiter and does not approve subsequent work', async () => {
  const gate = new PauseGate(() => {});
  gate.enable();
  gate.request();
  const controller = new AbortController();
  const step = gate.checkpoint(controller.signal);
  controller.abort();
  await assert.rejects(step, /cancelled/);
  assert.equal(gate.waiters.size, 0);
  gate.close();
});

test('Claude drains the tool batch and resumes without re-querying or replaying tools', async () => {
  const events = [];
  const ctx = new Context({ cwd: process.cwd(), prompt: 'Hello' }, (event) => events.push(event));
  let hooks;
  let releaseBatch;
  let batchStarted;
  const started = new Promise((resolve) => {
    batchStarted = resolve;
  });
  const batch = new Promise((resolve) => {
    releaseBatch = resolve;
  });
  let queryCount = 0;
  let toolsExecuted = 0;
  let secondRequest = false;
  const signal = new AbortController().signal;
  const input = { hook_event_name: 'PostToolBatch', tool_calls: [] };
  const mockQuery = ({ options }) => {
    queryCount++;
    hooks = options.hooks;
    return {
      close() {},
      async *[Symbol.asyncIterator]() {
        // An actual callback is required before advertising external CLI support.
        assert.equal(ctx.pause.state, null);
        await hooks.PostToolBatch[0].hooks[0](input, undefined, { signal });
        batchStarted();
        await batch;
        toolsExecuted += 2;
        yield {
          type: 'assistant',
          message: { id: 'result', content: [{ type: 'text', text: 'Tools completed' }] },
        };
        await hooks.PostToolBatch[0].hooks[0](input, undefined, { signal });
        secondRequest = true;
        yield { type: 'result', is_error: false };
      },
    };
  };
  const result = runClaude(ctx, false, mockQuery);
  try {
    await started;
    ctx.pause.request();
    assert.equal(ctx.pause.state, 'pausing');
    // Subagents already running must drain, not deadlock their parent tool.
    await hooks.PostToolBatch[0].hooks[0]({ ...input, agent_id: 'child' }, undefined, { signal });
    assert.equal(ctx.pause.state, 'pausing');
    releaseBatch();
    for (let n = 0; n < 20 && ctx.pause.state !== 'paused'; n++) await Promise.resolve();
    assert.equal(ctx.pause.state, 'paused');
    assert.equal(toolsExecuted, 2);
    assert.equal(secondRequest, false);
    assert(events.some((event) => event.type === 'item' && event.item.text === 'Tools completed'));
    ctx.pause.resume();
    assert.equal((await result).status, 'completed');
    assert.equal(queryCount, 1);
    assert.equal(toolsExecuted, 2);
    assert.equal(secondRequest, true);
  } finally {
    ctx.close();
  }
});

test('a provider that never reaches a checkpoint finishes normally after a pause request', async () => {
  const ctx = new Context({ cwd: process.cwd(), prompt: 'Hello' }, () => {});
  ctx.pause.enable();
  ctx.pause.request();
  try {
    const result = await runClaude(ctx, false, () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', is_error: false };
      },
    }));
    assert.equal(result.status, 'completed');
    assert.equal(ctx.pause.state, 'pausing');
  } finally {
    ctx.close();
  }
});
