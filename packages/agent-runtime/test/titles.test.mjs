import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '../src/protocol.mjs';
import { runClaude } from '../src/claude.mjs';

function fixture(config = {}) {
  const events = [];
  const ctx = new Context(
    {
      prompt: 'Depo: /Users/erdem/repo\nSohbet başlıklarını iyileştir',
      title_prompt: 'Sohbet başlıklarını iyileştir',
      ...config,
    },
    (event) => events.push(event),
  );
  return { ctx, events };
}

test('title metadata stays out of streamed chat at every chunk boundary and emits once', () => {
  const { ctx, events } = fixture();
  try {
    const { open, close } = ctx.sessionTitle;
    const header = `${open}Sohbet başlıklarını iyileştir${close}`;
    for (const char of header) {
      ctx.delta('message', 'assistant', char);
      ctx.flush();
      assert.equal(events.filter((event) => event.type === 'item').length, 0);
    }
    ctx.delta('message', 'assistant', '\n\nBaşlık akışını inceliyorum.');
    ctx.flush();
    ctx.item('message', 'assistant', 'Agent', `${header}\nBaşlık akışını düzelttim.`);
    assert.deepEqual(
      events.filter((event) => event.type === 'title'),
      [{ type: 'title', title: 'Sohbet başlıklarını iyileştir' }],
    );
    assert.deepEqual(
      events.filter((event) => event.type === 'item').map((event) => event.item.text),
      ['Başlık akışını inceliyorum.', 'Başlık akışını düzelttim.'],
    );
  } finally {
    ctx.close();
  }
});

test('a separate metadata message creates no empty chat bubble and tools remain intact', () => {
  const { ctx, events } = fixture();
  try {
    const header = `${ctx.sessionTitle.open}Fix checkout redirects${ctx.sessionTitle.close}`;
    ctx.item('title', 'assistant', 'Agent', header);
    ctx.item('tool', 'tool', 'Read', header);
    ctx.item('answer', 'assistant', 'Agent', 'The checkout redirect is fixed.');
    assert.deepEqual(
      events.filter((event) => event.type === 'item').map((event) => event.item.id),
      ['tool', 'answer'],
    );
    assert.equal(events.find((event) => event.item?.id === 'tool').item.text, header);
  } finally {
    ctx.close();
  }
});

test('missing, invalid and interrupted metadata keep the ordinary response usable', () => {
  const { ctx, events } = fixture();
  try {
    ctx.item('plain', 'assistant', 'Agent', 'A normal response without a title.');
    ctx.item(
      'invalid',
      'assistant',
      'Agent',
      `${ctx.sessionTitle.open}Bad\nTitle${ctx.sessionTitle.close}\nValid answer.`,
    );
    ctx.item(
      'incomplete',
      'assistant',
      'Agent',
      `${ctx.sessionTitle.open}No closing marker\nStill readable.`,
    );
    ctx.item('interrupted', 'assistant', 'Agent', ctx.sessionTitle.open.slice(0, 15));
    assert.deepEqual(
      events.map((event) => event.item.text),
      ['A normal response without a title.', 'Valid answer.', 'Still readable.'],
    );
  } finally {
    ctx.close();
  }
});

test('manual titles, catalog discovery and slash commands do not alter provider input', () => {
  for (const config of [
    { title_prompt: null },
    { operation: 'catalog' },
    { prompt: '/review staged changes' },
  ]) {
    const { ctx, events } = fixture(config);
    try {
      assert.equal(ctx.sessionTitle.enabled, false);
      assert.equal(
        ctx.config.prompt,
        config.prompt ?? 'Depo: /Users/erdem/repo\nSohbet başlıklarını iyileştir',
      );
      ctx.item('message', 'assistant', 'Agent', '<runhq-title>Ordinary text</runhq-title>');
      assert.equal(events[0].item.text, '<runhq-title>Ordinary text</runhq-title>');
    } finally {
      ctx.close();
    }
  }
});

test('the provider names the task during its normal turn with unchanged model and permissions', async () => {
  const { ctx, events } = fixture({ model: 'chosen-model', mode: 'plan' });
  let calls = 0;
  try {
    const result = await runClaude(ctx, false, ({ prompt, options }) => {
      calls++;
      assert(prompt.startsWith('Depo: /Users/erdem/repo\nSohbet başlıklarını iyileştir'));
      assert(prompt.includes("in the user's language"));
      assert.equal(options.model, 'chosen-model');
      assert.equal(options.permissionMode, 'plan');
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              id: 'result',
              content: [
                {
                  type: 'text',
                  text: `${ctx.sessionTitle.open}Anlamlı sohbet başlıkları üret${ctx.sessionTitle.close}\nBaşlık üretimini ekledim.`,
                },
              ],
            },
          };
          yield { type: 'result', is_error: false };
        },
      };
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'completed');
    assert.equal(
      events.find((event) => event.type === 'title').title,
      'Anlamlı sohbet başlıkları üret',
    );
    assert.equal(
      events.find((event) => event.type === 'item').item.text,
      'Başlık üretimini ekledim.',
    );
  } finally {
    ctx.close();
  }
});
