import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { Context } from '../src/protocol.mjs';
import { runAcp, acpCatalog } from '../src/acp.mjs';
const config = {
  cwd: process.cwd(),
  executable: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/acp.mjs', import.meta.url))],
  prompt: 'Hello',
  model: 'm1',
  effort: 'high',
  mode: 'plan',
};
async function until(f) {
  for (let i = 0; i < 200; i++) {
    if (f()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out');
}
test('ACP discovers only advertised models, current-model effort and modes', async () => {
  const ctx = new Context(config, () => {});
  try {
    const result = await runAcp(ctx, true);
    assert.equal(result.models[0].id, 'm1');
    assert.deepEqual(result.models[0].efforts, ['low', 'high']);
    assert.deepEqual(result.models[1].efforts, []);
    assert.equal(result.can_resume, true);
    assert.deepEqual(result.agents, ['ask', 'plan']);
    assert.deepEqual(acpCatalog({}).modes, ['default']);
  } finally {
    ctx.close();
  }
});
test('ACP resumes without duplicate replay and validates permission selections', async () => {
  const events = [];
  const ctx = new Context({ ...config, native_id: 'acp-saved' }, (e) => events.push(e));
  try {
    const turn = runAcp(ctx);
    await until(() => ctx.requests.has('acp-999'));
    await assert.rejects(ctx.answer('acp-999', { decision: 'invented' }));
    await ctx.answer('acp-999', { decision: 'deny' });
    assert.equal((await turn).status, 'completed');
    assert(!events.some((e) => e.item?.text?.includes('Old history')));
    assert(events.some((e) => e.item?.text === 'Working'));
  } finally {
    ctx.close();
  }
});
test('ACP cancellation resolves pending permission and cancels the prompt', async () => {
  const ctx = new Context(config, () => {});
  try {
    const turn = runAcp(ctx);
    await until(() => ctx.requests.has('acp-999'));
    await ctx.interrupt();
    assert.equal((await turn).status, 'cancelled');
    assert.equal(ctx.requests.size, 0);
  } finally {
    ctx.close();
  }
});
test('ACP never silently replaces an unresumable conversation', async () => {
  const ctx = new Context(
    { ...config, native_id: 'acp-saved', args: [...config.args, '--no-resume'] },
    () => {},
  );
  try {
    await assert.rejects(runAcp(ctx), /cannot resume/);
  } finally {
    ctx.close();
  }
});

test('ACP keeps discovered configuration when a load response omits optional metadata', async () => {
  let saved;
  for (const resumed of [false, true]) {
    const ctx = new Context(
      {
        ...config,
        ...(resumed
          ? { native_id: 'acp-saved', runtime_state: saved, args: [...config.args, '--empty-load'] }
          : {}),
      },
      (event) => {
        if (event.type === 'state') saved = event.state;
      },
    );
    try {
      const turn = runAcp(ctx);
      await until(() => ctx.requests.has('acp-999'));
      await ctx.answer('acp-999', { decision: 'deny' });
      assert.equal((await turn).status, 'completed');
      assert(
        saved.configOptions.some(
          (option) => option.id === 'thought' && option.currentValue === 'high',
        ),
      );
    } finally {
      ctx.close();
    }
  }
});

test('ACP restores the observed default after a saved plan, without guessing custom modes', async () => {
  let saved;
  const ctx = new Context(
    {
      ...config,
      native_id: 'acp-saved',
      mode: 'default',
      args: [...config.args, '--saved-plan'],
      runtime_state: { defaultMode: 'ask' },
    },
    (event) => {
      if (event.type === 'state') saved = event.state;
    },
  );
  try {
    const turn = runAcp(ctx);
    await until(() => ctx.requests.has('acp-999'));
    await ctx.answer('acp-999', { decision: 'deny' });
    assert.equal((await turn).status, 'completed');
    assert.equal(
      saved.configOptions.find((option) => option.category === 'mode').currentValue,
      'ask',
    );
  } finally {
    ctx.close();
  }

  const unknown = new Context(
    { ...config, native_id: 'acp-saved', mode: 'default', args: [...config.args, '--saved-plan'] },
    () => {},
  );
  try {
    await assert.rejects(runAcp(unknown), /Choose an agent mode/);
  } finally {
    unknown.close();
  }
});
