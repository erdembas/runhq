import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pretty, questionsFrom, requireAnswers } from './protocol.mjs';
import { validateAttachments } from './attachments.mjs';
import { openCodeApproval } from './permissions.mjs';

export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replaceAll('\r\n', '\n');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('OpenCode event exceeds 8 MiB');
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data);
    }
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function runOpenCode(ctx, catalog = false) {
  const cfg = ctx.config;
  if (!catalog) validateAttachments(cfg.attachments, 'opencode');
  const port = await availablePort();
  const password = randomUUID();
  const headers = {
    Authorization: `Basic ${Buffer.from(`runhq:${password}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  const base = `http://127.0.0.1:${port}`;
  const child = ctx.child(
    cfg.executable,
    ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: 'runhq',
        OPENCODE_SERVER_PASSWORD: password,
      },
    },
  );
  child.stdout.resume();
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const api = async (path, method = 'GET', body, signal = AbortSignal.timeout(45000)) => {
    const res = await fetch(`${base}${path}?directory=${encodeURIComponent(cfg.cwd)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!res.ok)
      throw new Error(
        `OpenCode ${method} ${path}: ${res.status} ${String(await res.text()).slice(0, 1500)}`,
      );
    return res.status === 204 ? null : res.json();
  };
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('OpenCode server exited before becoming ready');
    if (ctx.cancelled) return { status: 'cancelled' };
    try {
      const response = await fetch(`${base}/global/health`, {
        headers,
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* server is still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('OpenCode did not start within 30 seconds');
  if (catalog) {
    const [providers, agents, commands] = await Promise.all([
      api('/provider'),
      api('/agent'),
      api('/command'),
    ]);
    const connected = new Set(providers.connected ?? []);
    const models = (providers.all ?? [])
      .filter((p) => connected.has(p.id))
      .flatMap((p) =>
        Object.values(p.models ?? {}).map((m) => ({
          id: `${p.id}/${m.id}`,
          name: `${p.name} · ${m.name}`,
          efforts: Object.keys(m.variants ?? {}),
        })),
      );
    return {
      models,
      agents: agents.filter((a) => a.mode !== 'subagent' && !a.hidden).map((a) => a.name),
      commands: commands.map((c) => c.name),
      modes: ['default', 'plan'],
      can_steer: false,
    };
  }
  const session = cfg.native_id
    ? await api(`/session/${encodeURIComponent(cfg.native_id)}`)
    : await api('/session', 'POST', { title: cfg.title });
  const id = session.id;
  ctx.emit({ type: 'native', id });
  const streamAbort = new AbortController();
  const response = await fetch(`${base}/event?directory=${encodeURIComponent(cfg.cwd)}`, {
    headers,
    signal: streamAbort.signal,
  });
  if (!response.ok) throw new Error(`OpenCode event stream: ${response.status}`);
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  let active = false;
  let busy = false;
  const messageRoles = new Map();
  ctx.interrupt = async () => {
    ctx.cancelled = true;
    await api(`/session/${id}/abort`, 'POST');
    // Abort endpoint acknowledges completion; terminate this owned server afterwards.
    resolveDone({ status: 'cancelled' });
  };
  const stream = (async () => {
    for await (const event of sseEvents(response.body)) {
      const e = event.payload ?? event;
      const p = e.properties ?? {};
      const sid = p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID;
      if (sid && sid !== id) continue;
      if (e.type === 'message.updated' && p.info) messageRoles.set(p.info.id, p.info.role);
      if (e.type === 'session.status' && active) {
        if (p.status?.type === 'busy' || p.status?.type === 'retry') {
          busy = true;
          ctx.emit({ type: 'status', status: 'running' });
        }
        if (busy && p.status?.type === 'idle')
          resolveDone({ status: ctx.cancelled ? 'cancelled' : 'completed' });
      }
      if (e.type === 'session.idle' && active && busy)
        resolveDone({ status: ctx.cancelled ? 'cancelled' : 'completed' });
      if (e.type === 'session.error')
        resolveDone({ status: 'failed', error: p.error?.data?.message ?? pretty(p.error) });
      if (e.type === 'message.part.updated') {
        const part = p.part;
        if (messageRoles.get(part.messageID) === 'user') continue;
        if (part.type === 'text' || part.type === 'reasoning') {
          ctx.item(
            part.id,
            part.type === 'text' ? 'assistant' : 'reasoning',
            part.type === 'text' ? 'OpenCode' : 'Reasoning',
            part.text,
            part.time?.end ? 'completed' : 'running',
          );
        } else if (part.type === 'tool') {
          const state = part.state ?? {};
          // A tool part arrives before its title is resolved, so an empty title must fall back to
          // the tool name rather than leaving a nameless row in the transcript.
          ctx.item(
            part.id,
            'tool',
            state.title || part.tool || 'Tool',
            pretty({ input: state.input, output: state.output, error: state.error }),
            state.status ?? 'running',
          );
        }
      }
      if (e.type === 'message.part.delta' && messageRoles.get(p.messageID) !== 'user')
        ctx.delta(p.partID, ctx.items.get(p.partID)?.kind ?? 'assistant', p.delta);
      if (e.type === 'message.updated' && p.info?.role === 'assistant')
        ctx.emit({
          type: 'usage',
          usage: { tokens: p.info.tokens, cost: p.info.cost, model: p.info.modelID },
        });
      if (e.type === 'permission.asked' || e.type === 'permission.updated') {
        const requestId = p.id;
        await ctx.ask(
          {
            id: requestId,
            kind: 'approval',
            title: `Allow ${p.permission ?? p.type ?? 'tool execution'}?`,
            details: pretty(p),
            choices: [
              { label: 'Allow once', value: 'once' },
              { label: 'Always allow this rule', value: 'always' },
              { label: 'Deny', value: 'reject' },
            ],
          },
          async (value) => {
            if (!['once', 'always', 'reject'].includes(value.decision))
              throw new Error('Invalid decision');
            if (e.type === 'permission.asked')
              await api(`/permission/${encodeURIComponent(requestId)}/reply`, 'POST', {
                reply: value.decision,
              });
            else
              await api(`/session/${id}/permissions/${encodeURIComponent(requestId)}`, 'POST', {
                response: value.decision,
              });
          },
          openCodeApproval(p.permission ?? p.type),
        );
      }
      if (e.type === 'question.asked') {
        const questions = questionsFrom(p.questions).map((q, i) => ({ ...q, id: String(i) }));
        await ctx.ask(
          {
            id: p.id,
            kind: 'question',
            title: 'OpenCode needs your input',
            questions,
            details: '',
          },
          async (value) => {
            if (value.reject) {
              await api(`/question/${encodeURIComponent(p.id)}/reject`, 'POST');
              return;
            }
            const answers = requireAnswers(questions, value);
            await api(`/question/${encodeURIComponent(p.id)}/reply`, 'POST', {
              answers: questions.map((q) => answers[q.id]),
            });
          },
        );
      }
      if (['permission.replied', 'question.replied', 'question.rejected'].includes(e.type))
        ctx.resolve(p.requestID);
    }
    throw new Error('OpenCode event stream disconnected');
  })();
  stream.catch(() => {});
  if (ctx.cancelled) {
    streamAbort.abort();
    return { status: 'cancelled' };
  }
  active = true;
  const slash = cfg.prompt.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  const [providerID, ...modelParts] = (cfg.model ?? '').split('/');
  const model = modelParts.length ? { providerID, modelID: modelParts.join('/') } : undefined;
  const agent = cfg.agent || (cfg.mode === 'plan' ? 'plan' : 'build');
  try {
    if (slash) {
      // Command endpoint is synchronous; the event consumer remains active during execution.
      const command = api(
        `/session/${id}/command`,
        'POST',
        { command: slash[1], arguments: slash[2] ?? '', model: cfg.model || undefined, agent },
        streamAbort.signal,
      );
      command.catch(() => {});
      return await Promise.race([command.then(() => ({ status: 'completed' })), done, stream]);
    }
    await api(`/session/${id}/prompt_async`, 'POST', {
      parts: [{ type: 'text', text: cfg.prompt }],
      model,
      variant: cfg.effort || undefined,
      agent,
    });
    return await Promise.race([done, stream]);
  } finally {
    streamAbort.abort();
  }
}
