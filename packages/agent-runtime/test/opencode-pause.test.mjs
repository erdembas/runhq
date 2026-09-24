import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Context } from '../src/protocol.mjs';
import { openCodePause } from '../src/opencode-pause.mjs';

const until = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Checkpoint did not arrive');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('OpenCode awaits the root model checkpoint, preserves config, and resumes the same call', async () => {
  const events = [];
  const ctx = new Context({}, (e) => events.push(e));
  let file;
  try {
    const existing = {
      plugin: ['existing-plugin'],
      permission: { edit: 'ask' },
      model: 'custom/model',
    };
    const bridge = await openCodePause(ctx, { OPENCODE_CONFIG_CONTENT: JSON.stringify(existing) });
    const config = JSON.parse(bridge.env.OPENCODE_CONFIG_CONTENT);
    assert.deepEqual(config.permission, existing.permission);
    assert.equal(config.model, existing.model);
    assert.equal(config.plugin[0], 'existing-plugin');
    const url = config.plugin[1];
    file = new URL(url);
    const plugin = await (await import(url)).default({});
    const checkpoint = plugin['chat.params'];
    bridge.bind('root', 'build');
    await checkpoint({ sessionID: 'root', agent: 'title' });
    assert.equal(ctx.pause.state, null, 'background requests do not advertise root capability');
    await checkpoint({ sessionID: 'root', agent: 'build' });
    ctx.pause.request();
    await checkpoint({ sessionID: 'child', agent: 'build' });
    await checkpoint({ sessionID: 'root', agent: 'title' });
    assert.equal(ctx.pause.state, 'pausing', 'children and titles must drain without deadlock');
    let continued = false;
    const waiting = checkpoint({ sessionID: 'root', agent: 'build' }).then(() => {
      continued = true;
    });
    await until(() => ctx.pause.state === 'paused');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(continued, false);
    ctx.pause.resume();
    await waiting;
    assert.deepEqual(
      events.filter((e) => e.type === 'pause').map((e) => e.state),
      ['running', 'pausing', 'paused', 'running'],
    );
    const unauthorized = await fetch(bridge.endpoint, { method: 'POST', body: '{}' });
    assert.equal(unauthorized.status, 403);
    ctx.pause.request();
    const stopped = checkpoint({ sessionID: 'root', agent: 'build' });
    const rejected = assert.rejects(stopped, /cancelled|fetch|terminated/);
    await until(() => ctx.pause.state === 'paused');
    ctx.close();
    await rejected;
  } finally {
    ctx.close();
  }
  await assert.rejects(access(file), { code: 'ENOENT' });
});

test('OpenCode leaves non-JSON inline settings and invalid plugin shapes untouched', async () => {
  const ctx = new Context({}, () => {});
  try {
    for (const content of ['{// user comment\n}', '[]', '{"plugin":"custom"}']) {
      const env = { OPENCODE_CONFIG_CONTENT: content };
      assert.equal(await openCodePause(ctx, env), undefined);
      assert.equal(env.OPENCODE_CONFIG_CONTENT, content);
      assert.equal(ctx.pause.state, null);
    }
  } finally {
    ctx.close();
  }
});
