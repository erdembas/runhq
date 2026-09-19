import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Context } from '../src/protocol.mjs';
import {
  validateAttachments,
  MAX_IMAGE_BASE64_LENGTH,
  codexImageInput,
} from '../src/attachments.mjs';
import { runCodex } from '../src/codex.mjs';
import { runClaude } from '../src/claude.mjs';
import { runOpenCode } from '../src/opencode.mjs';
import { runAcp } from '../src/acp.mjs';

const image = { name: 'screenshot.png', mime_type: 'image/png', data: 'aGVsbG8=' };
const { AbortController } = globalThis;

test('images are bounded and invalid data, names and MIME types fail without losing the prompt', () => {
  assert.deepEqual(validateAttachments(undefined, 'acp'), []);
  assert.deepEqual(validateAttachments([], 'opencode'), []);
  assert.deepEqual(validateAttachments([image], 'codex'), [image]);
  assert.throws(() => validateAttachments([image], 'acp'), /Codex and Claude/);
  assert.throws(() => validateAttachments(Array(6).fill(image), 'codex'), /5 images/);
  assert.throws(
    () => validateAttachments([{ ...image, mime_type: 'text/html' }], 'claude'),
    /PNG, JPEG/,
  );
  assert.throws(() => validateAttachments([{ ...image, name: 'bad\nname' }], 'claude'), /filename/);
  for (const data of [
    '',
    'no base64',
    'aGVsbG8',
    'AB==',
    'AAB=',
    `data:image/png;base64,${image.data}`,
  ])
    assert.throws(
      () => validateAttachments([{ ...image, data }], 'codex'),
      /Image data is invalid/,
    );
  assert.throws(
    () =>
      validateAttachments(
        [{ ...image, data: 'A'.repeat(MAX_IMAGE_BASE64_LENGTH) }, image],
        'codex',
      ),
    /2.25 MiB/,
  );
  assert.deepEqual(codexImageInput('Plain text', []), [{ type: 'text', text: 'Plain text' }]);
});

test(
  'Codex sends native image blocks under read-only review and never echoes image bytes into items',
  { timeout: 5000 },
  async () => {
    const events = [];
    const ctx = new Context(
      {
        cwd: process.cwd(),
        prompt: 'Inspect the screenshot',
        mode: 'default',
        read_only_review: true,
        attachments: [image],
      },
      (event) => events.push(event),
    );
    const spawn = ctx.child.bind(ctx);
    ctx.child = () =>
      spawn(process.execPath, [
        fileURLToPath(new URL('./fixtures/codex-attachments.mjs', import.meta.url)),
      ]);
    try {
      assert.equal((await runCodex(ctx)).status, 'completed');
      assert.equal(ctx.items.get('result').text, 'Native image received');
      assert(!ctx.items.has('echo'));
      assert(!JSON.stringify(events).includes(image.data));
    } finally {
      ctx.close();
    }
  },
);

test('Claude sends SDKUserMessage native image source blocks and keeps images out of transcript', async () => {
  const events = [];
  const ctx = new Context(
    { cwd: process.cwd(), prompt: 'Inspect the screenshot', attachments: [image] },
    (event) => events.push(event),
  );
  let received;
  try {
    const result = await runClaude(ctx, false, ({ prompt }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        received = [];
        for await (const message of prompt) received.push(message);
        yield { type: 'user', message: received[0].message };
        yield { type: 'result', is_error: false };
      },
    }));
    assert.equal(result.status, 'completed');
    assert.deepEqual(received, [
      {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect the screenshot' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: image.data },
            },
          ],
        },
      },
    ]);
    assert(!JSON.stringify(events).includes(image.data));
  } finally {
    ctx.close();
  }
});

test('unsupported providers reject images before launching processes or submitting a partial text turn', async () => {
  for (const run of [runOpenCode, runAcp]) {
    const ctx = new Context(
      { cwd: process.cwd(), prompt: 'Keep my image', attachments: [image] },
      () => {},
    );
    let spawned = false;
    ctx.child = () => {
      spawned = true;
      throw new Error('Provider must not start');
    };
    try {
      await assert.rejects(run(ctx), /Codex and Claude/);
      assert.equal(spawned, false);
    } finally {
      ctx.close();
    }
  }
});

test('Claude read-only reviewers reject write, shell and delegation tools without requesting permission', async () => {
  const events = [];
  const ctx = new Context(
    { cwd: process.cwd(), prompt: 'Review', read_only_review: true, mode: 'default' },
    (event) => events.push(event),
  );
  try {
    await runClaude(ctx, false, ({ prompt, options }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        assert.equal(prompt, 'Review', 'plain text keeps the existing SDK call shape');
        assert.equal(options.permissionMode, 'plan');
        for (const tool of ['Write', 'Edit', 'Bash', 'Agent', 'Task', 'mcp__custom__mutate']) {
          const result = await options.canUseTool(
            tool,
            {},
            { toolUseID: tool, signal: new AbortController().signal },
          );
          assert.equal(result.behavior, 'deny');
        }
        assert(options.disallowedTools.includes('Bash'));
        yield { type: 'result', is_error: false };
      },
    }));
    assert.equal(
      events.some((event) => event.type === 'request'),
      false,
    );
  } finally {
    ctx.close();
  }
});
