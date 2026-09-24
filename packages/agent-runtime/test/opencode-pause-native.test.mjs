import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '../src/protocol.mjs';
import { runOpenCode } from '../src/opencode.mjs';

for (const action of ['resume', 'interrupt'])
  test(
    `native OpenCode drains a tool then pauses before its next model request (${action})`,
    {
      skip: !process.env.RUNHQ_TEST_OPENCODE_EXECUTABLE,
      timeout: 60000,
    },
    async () => {
      const home = await realpath(await mkdtemp(join(tmpdir(), 'runhq-opencode-native-')));
      const file = join(home, 'sample.txt');
      await writeFile(file, 'Preserve this result across pause.');
      let requests = 0;
      let secondBody;
      let paused;
      const reachedPause = new Promise((resolve) => {
        paused = resolve;
      });
      const server = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const title = body.model === 'title';
        if (!title) requests++;
        const first = !title && requests === 1;
        if (first) {
          assert.equal(ctx.pause.state, 'running', 'the real executable must invoke the hook');
          ctx.pause.request();
        } else if (!title) secondBody = body;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const emit = (delta, finish_reason = null) =>
          res.write(
            `data: ${JSON.stringify({
              id: 'fixture',
              object: 'chat.completion.chunk',
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason }],
            })}\n\n`,
          );
        emit({
          role: 'assistant',
          ...(first
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: 'read-fixture',
                    type: 'function',
                    function: { name: 'read', arguments: JSON.stringify({ filePath: file }) },
                  },
                ],
              }
            : { content: 'Done' }),
        });
        emit({}, first ? 'tool_calls' : 'stop');
        res.end('data: [DONE]\n\n');
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      await writeFile(
        join(home, 'opencode.json'),
        JSON.stringify({
          $schema: 'https://opencode.ai/config.json',
          provider: {
            fixture: {
              npm: '@ai-sdk/openai-compatible',
              name: 'Local fixture',
              options: {
                baseURL: `http://127.0.0.1:${server.address().port}/v1`,
                apiKey: 'local-fixture-only',
              },
              models: {
                main: { name: 'Main', limit: { context: 32000, output: 2000 } },
                title: { name: 'Title', limit: { context: 32000, output: 2000 } },
              },
            },
          },
          small_model: 'fixture/title',
          permission: { read: 'allow' },
        }),
      );
      const events = [];
      const ctx = new Context(
        {
          cwd: home,
          title: 'Pause fixture',
          prompt: 'Read sample.txt and summarize it.',
          model: 'fixture/main',
          executable: process.env.RUNHQ_TEST_OPENCODE_EXECUTABLE,
        },
        (event) => {
          events.push(event);
          if (event.type === 'pause' && event.state === 'paused') paused();
        },
      );
      const spawnChild = ctx.child.bind(ctx);
      ctx.child = (exe, args, options) =>
        spawnChild(exe, args, {
          ...options,
          env: {
            ...options.env,
            XDG_CONFIG_HOME: join(home, 'config'),
            XDG_DATA_HOME: join(home, 'data'),
            XDG_CACHE_HOME: join(home, 'cache'),
            XDG_STATE_HOME: join(home, 'state'),
            OPENCODE_CONFIG: join(home, 'opencode.json'),
            OPENCODE_CONFIG_DIR: join(home, 'config'),
            OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
            OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
            OPENCODE_DISABLE_MODELS_FETCH: 'true',
            OPENCODE_DISABLE_AUTOUPDATE: 'true',
          },
        });
      let run;
      let timer;
      try {
        run = runOpenCode(ctx);
        run.catch(() => {});
        await Promise.race([
          reachedPause,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Checkpoint timed out; requests=${requests}; pause=${ctx.pause.state}; pending=${ctx.requests.size}`,
                  ),
                ),
              40000,
            );
          }),
          run.then((result) => {
            throw new Error(`Ended before pause: ${JSON.stringify(result)}`);
          }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(requests, 1);
        assert(
          events.some(
            (e) =>
              e.type === 'item' &&
              e.item.kind === 'tool' &&
              e.item.text.includes('Preserve this result across pause.'),
          ),
        );
        if (action === 'resume') {
          ctx.pause.resume();
          assert.equal((await run).status, 'completed');
          assert.equal(requests, 2);
          assert(JSON.stringify(secondBody).includes('Preserve this result across pause.'));
        } else {
          await ctx.interrupt();
          assert.equal((await run).status, 'cancelled');
          assert.equal(requests, 1, 'interrupt must never release a new model request');
        }
      } finally {
        clearTimeout(timer);
        ctx.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await rm(home, { recursive: true, force: true });
      }
    },
  );
