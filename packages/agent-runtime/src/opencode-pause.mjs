import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Serialized into a private, temporary OpenCode plugin. Keep this function standalone.
// OpenCode awaits chat.params in LLMRequestPrep.prepare before invoking the model:
// https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/session/llm/request.ts
function pausePlugin(_input, options) {
  return {
    'chat.params': async ({ sessionID, agent }) => {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.token}` },
        body: JSON.stringify({ sessionID, agent }),
      });
      // Heartbeats keep the awaited response alive during arbitrarily long pauses.
      // A lost bridge or cancelled turn must fail closed, never send the next request.
      if (!response.ok || (await response.text()).trim() !== 'continue')
        throw new Error('RunHQ pause checkpoint was cancelled');
    },
  };
}

export async function openCodePause(ctx, env = process.env) {
  let config;
  try {
    config = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
  } catch {
    // OpenCode also accepts JSONC and config substitutions. Leave such custom
    // content untouched; this optional capability must not break existing config.
    return undefined;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) return undefined;

  const token = randomUUID();
  const folder = mkdtempSync(join(tmpdir(), 'runhq-opencode-pause-'));
  const pluginPath = join(folder, 'pause.mjs');
  let sessionID;
  let agent;
  let closed = false;
  const pending = new Set();
  const server = createServer(async (req, res) => {
    if (
      req.method !== 'POST' ||
      req.url !== '/' ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.writeHead(403).end();
      return;
    }
    let heartbeat;
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    res.once('close', disconnected);
    pending.add(controller);
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new Error('Invalid checkpoint');
      }
      const input = JSON.parse(body);
      if (closed) throw new Error('Closed checkpoint');
      // Background title/summary requests and child agents may overlap the root
      // model call. They cannot acknowledge a pause of the root agent loop.
      if (sessionID && input.sessionID === sessionID && input.agent === agent) {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.write(' ');
        heartbeat = setInterval(() => res.write(' '), 5000);
        heartbeat.unref();
        ctx.pause.enable(); // Advertise only after the executable invokes our hook.
        await ctx.pause.checkpoint(controller.signal);
      }
      res.end('continue');
    } catch {
      if (!res.headersSent) res.writeHead(409);
      res.end('cancelled');
    } finally {
      clearInterval(heartbeat);
      pending.delete(controller);
      res.off('close', disconnected);
    }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    for (const controller of pending) controller.abort();
    server.closeAllConnections();
    server.close();
    rmSync(folder, { recursive: true, force: true });
    ctx.cleanups.delete(close);
  };
  ctx.cleanups.add(close);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const endpoint = `http://127.0.0.1:${server.address().port}/`;
    // Use the longstanding string plugin spec, rather than requiring a CLI version
    // with tuple/options support. Keep the bridge token out of OpenCode's config.
    writeFileSync(
      pluginPath,
      `export default async () => (${pausePlugin.toString()})(undefined, ${JSON.stringify({ endpoint, token })})\n`,
      { mode: 0o600 },
    );
    return {
      endpoint,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...config,
          plugin: [...(config.plugin ?? []), pathToFileURL(pluginPath).href],
        }),
      },
      bind: (id, name) => {
        sessionID = id;
        agent = name;
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
