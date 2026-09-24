import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Context } from '../src/protocol.mjs';
import { runClaude } from '../src/claude.mjs';

// Opt-in integration test of the actual SDK/CLI hook contract. No account or model
// service is used: Anthropic requests go to the local fixture, with a fresh CLI home.
test(
  'native Claude waits after tool results and sends its next request only after resume',
  {
    skip: !process.env.RUNHQ_TEST_CLAUDE_EXECUTABLE,
    timeout: 30000,
  },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'runhq-pause-native-'));
    const file = join(home, 'sample.txt');
    await writeFile(file, 'Preserve this result across pause.');
    let requests = 0;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* consume the bounded fixture request */
      }
      if (req.url.includes('count_tokens')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      if (!req.url.startsWith('/v1/messages')) {
        res.setHeader('content-type', 'application/json');
        res.end('{}');
        return;
      }
      requests++;
      if (requests === 1 && ctx.pause.state === 'running') {
        pauseRequested = true;
        ctx.pause.request();
        assert.equal(ctx.pause.state, 'pausing');
      }
      res.setHeader('content-type', 'text/event-stream');
      const emit = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      emit({
        type: 'message_start',
        message: {
          id: `message-${requests}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      });
      const first = requests === 1;
      emit({
        type: 'content_block_start',
        index: 0,
        content_block: first
          ? { type: 'tool_use', id: 'read-fixture', name: 'Read', input: {} }
          : { type: 'text', text: '' },
      });
      emit({
        type: 'content_block_delta',
        index: 0,
        delta: first
          ? { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: file }) }
          : { type: 'text_delta', text: 'Done' },
      });
      emit({ type: 'content_block_stop', index: 0 });
      emit({
        type: 'message_delta',
        delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      });
      emit({ type: 'message_stop' });
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    let paused;
    let pauseRequested = false;
    const reachedPause = new Promise((resolve) => {
      paused = resolve;
    });
    const ctx = new Context(
      {
        cwd: home,
        executable: process.env.RUNHQ_TEST_CLAUDE_EXECUTABLE,
        prompt: 'Read sample.txt and summarize it.',
        model: 'claude-sonnet-4-6',
      },
      (event) => {
        if (
          event.type === 'pause' &&
          event.state === 'running' &&
          requests === 1 &&
          !pauseRequested
        ) {
          pauseRequested = true;
          ctx.pause.request();
        }
        if (event.type === 'pause' && event.state === 'paused') paused();
      },
    );
    const result = runClaude(ctx, false, (args) =>
      query({
        ...args,
        options: {
          ...args.options,
          settingSources: [],
          tools: ['Read'],
          allowedTools: ['Read'],
          env: {
            ...args.options.env,
            CLAUDE_CONFIG_DIR: home,
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
            ANTHROPIC_API_KEY: 'local-test-only',
            ANTHROPIC_AUTH_TOKEN: 'local-test-only',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        },
      }),
    );
    result.catch(() => {});
    let timer;
    try {
      await Promise.race([
        reachedPause,
        result.then((value) => {
          throw new Error(`Provider finished before checkpoint: ${JSON.stringify(value)}`);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Native checkpoint did not arrive')), 20000);
        }),
      ]);
      // Give the still-live event reader time to deliver results while the provider
      // is blocked. No next request may escape during this interval.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(requests, 1);
      assert.equal(ctx.pause.state, 'paused');
      assert(
        [...ctx.items.values()].some(
          (item) =>
            item.kind === 'tool' && item.text.includes('Preserve this result across pause.'),
        ),
      );
      ctx.pause.resume();
      assert.equal((await result).status, 'completed');
      assert.equal(requests, 2);
    } finally {
      clearTimeout(timer);
      ctx.cancelled = true;
      await ctx.interrupt?.();
      ctx.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(home, { recursive: true, force: true });
    }
  },
);
