import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { Context } from '../src/protocol.mjs';
import { runAcp } from '../src/acp.mjs';

const config = {
  backend: 'cursor',
  cwd: process.cwd(),
  executable: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/cursor.mjs', import.meta.url))],
  prompt: 'Plan navigation improvements',
  model: 'cursor-model',
  mode: 'plan',
};
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out');
}
const answers = { layout: ['right'], features: ['search', 'tabs'] };

test('Cursor refuses old CLI builds before acp can be mistaken for a chat prompt', async () => {
  const ctx = new Context({ ...config, args: [...config.args, '--old-cli'] }, () => {});
  try {
    await assert.rejects(runAcp(ctx), /Run agent update/);
  } finally {
    ctx.close();
  }
});

test('Cursor authenticates and advertises only its discovered models and modes', async () => {
  const ctx = new Context(config, () => {});
  try {
    const catalog = await runAcp(ctx, true);
    assert.deepEqual(catalog.agents, ['agent', 'plan', 'ask']);
    assert.deepEqual(catalog.modes, ['default', 'plan']);
    assert.equal(catalog.can_resume, true);
    assert.equal(catalog.models[0].id, 'cursor-model');
  } finally {
    ctx.close();
  }
});

for (const decision of ['accepted', 'rejected']) {
  test(`Cursor requires real option IDs and ${decision} plan approval before completing`, async () => {
    const events = [];
    const ctx = new Context(
      { ...config, args: [...config.args, ...(decision === 'rejected' ? ['--reject-plan'] : [])] },
      (event) => events.push(event),
    );
    try {
      const turn = runAcp(ctx);
      await until(() => ctx.requests.has('acp-cursor-700'));
      const question = events.find((event) => event.type === 'request').request.questions[0];
      assert.equal(question.allow_custom, false);
      assert.deepEqual(
        question.options.map((option) => option.value),
        ['left', 'right'],
      );
      await assert.rejects(
        ctx.answer('acp-cursor-700', { answers: { ...answers, layout: ['Sidebar'] } }),
        /offered option/,
      );
      await assert.rejects(
        ctx.answer('acp-cursor-700', { answers: { ...answers, layout: ['left', 'right'] } }),
        /offered option/,
      );
      await assert.rejects(
        ctx.answer('acp-cursor-700', { answers: { ...answers, features: ['search', 'search'] } }),
        /offered option/,
      );
      await ctx.answer('acp-cursor-700', { answers });
      await until(() => ctx.requests.has('acp-cursor-701'));
      await assert.rejects(
        ctx.answer('acp-cursor-701', { decision: 'allow' }),
        /approve or reject/,
      );
      assert(
        events.some(
          (event) => event.item?.kind === 'plan' && event.item.title === 'Improve navigation',
        ),
      );
      await ctx.answer('acp-cursor-701', { decision });
      assert.equal((await turn).status, 'completed');
      assert.equal(ctx.requests.size, 0);
      const todos = [...ctx.items.values()].find((item) => item.title === 'Cursor tasks');
      assert.deepEqual(
        JSON.parse(todos.text).map((todo) => [todo.id, todo.status]),
        [
          ['inspect', 'completed'],
          ['implement', 'completed'],
        ],
      );
      // The provider's own fan-out is reported as structure, not as a generic tool blob, so the
      // transcript can show which subagent ran and with what.
      const subagent = events.find((event) => event.item?.title === 'Explore routing')?.item;
      assert(subagent, 'the subagent notification reaches the transcript');
      assert.equal(subagent.kind, 'subagent');
      assert.deepEqual(JSON.parse(subagent.text), {
        prompt: 'Find route handlers',
        agentId: 'explorer-1',
        subagentType: 'explore',
        durationMs: 123,
      });
      assert(events.some((event) => event.item?.text.includes('/tmp/navigation.png')));
    } finally {
      ctx.close();
    }
  });
}

for (const stage of ['question', 'plan']) {
  test(`Cancelling Cursor resolves the pending ${stage} without accepting it`, async () => {
    const ctx = new Context(config, () => {});
    try {
      const turn = runAcp(ctx);
      await until(() => ctx.requests.has('acp-cursor-700'));
      if (stage === 'plan') {
        await ctx.answer('acp-cursor-700', { answers });
        await until(() => ctx.requests.has('acp-cursor-701'));
      }
      await ctx.interrupt();
      assert.equal((await turn).status, 'cancelled');
      assert.equal(ctx.requests.size, 0);
    } finally {
      ctx.close();
    }
  });
}

for (const mode of ['agent', 'plan', 'ask']) {
  test(`Cursor resumes the saved conversation in ${mode} mode and suppresses replayed requests`, async () => {
    const events = [];
    const ctx = new Context(
      {
        ...config,
        native_id: 'cursor-saved',
        mode: mode === 'plan' ? 'plan' : 'default',
        agent: mode === 'ask' ? 'ask' : '',
        prompt: mode,
        args: [...config.args, '--modes-only'],
      },
      (event) => events.push(event),
    );
    try {
      assert.equal((await runAcp(ctx)).status, 'completed');
      assert(
        !events.some(
          (event) =>
            event.type === 'request' ||
            event.item?.title === 'Old plan' ||
            event.item?.text.includes('Old replay'),
        ),
      );
      assert(
        events.some((event) => event.type === 'state' && event.state.modes.currentModeId === mode),
      );
    } finally {
      ctx.close();
    }
  });
}

test('Cursor authentication errors point to local login without forwarding provider diagnostics', async () => {
  const ctx = new Context({ ...config, args: [...config.args, '--auth-failure'] }, () => {});
  try {
    await assert.rejects(runAcp(ctx), /Run agent login/);
  } finally {
    ctx.close();
  }
});
