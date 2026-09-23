import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { SessionTitle } from './titles.mjs';
import { automaticApproval } from './permissions.mjs';

export const MAX_TEXT = 128 * 1024;
export const clip = (value) => String(value ?? '').slice(-MAX_TEXT);
export const pretty = (value) =>
  clip(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

// Bound frames before parsing: tool output must never grow an unbounded line buffer.
export async function* jsonLines(stream) {
  let buffer = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Agent protocol frame exceeds 8 MiB');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

export class Context {
  constructor(config, emit) {
    this.sessionTitle = new SessionTitle(config, emit);
    this.config = { ...config, prompt: this.sessionTitle.prompt(config) };
    this.emit = emit;
    this.children = new Set();
    this.requests = new Map();
    this.answering = new Set();
    this.items = new Map();
    this.dirty = new Set();
    this.cancelled = false;
    this.flushTimer = setInterval(() => this.flush(), 60);
    this.flushTimer.unref();
  }
  item(id, kind, title, text, status = 'completed', extra = {}) {
    const item = { id: String(id), kind, title: clip(title), text: clip(text), status, ...extra };
    this.items.set(item.id, item);
    this.dirty.add(item.id);
    if (status !== 'running') this.flush();
  }
  delta(id, kind, text, title = '') {
    const item = this.items.get(String(id));
    this.item(id, kind, title || item?.title || kind, (item?.text ?? '') + text, 'running');
  }
  flush() {
    for (const id of this.dirty) {
      const item = this.items.get(id);
      if (item.kind === 'assistant' && this.sessionTitle.enabled) {
        const text = this.sessionTitle.visible(item.text, item.status);
        if (text) this.emit({ type: 'item', item: { ...item, text } });
      } else this.emit({ type: 'item', item });
    }
    this.dirty.clear();
  }
  async ask(request, respond, approval) {
    const id = String(request.id ?? randomUUID());
    if (this.requests.has(id)) return;
    this.requests.set(id, respond);
    this.flush();
    const value = !this.cancelled && automaticApproval(this.config, request, approval);
    if (value) {
      try {
        await this.answer(id, value);
        this.item(
          `automatic-approval:${id}`,
          'automatic_approval',
          request.title,
          pretty({
            request: request.details,
            response: value,
            policy: this.config.permission_policy,
          }),
        );
        return;
      } catch (error) {
        this.item(
          `automatic-approval:${id}`,
          'automatic_approval',
          request.title,
          pretty({ request: request.details, error: error.message }),
          'failed',
        );
        // Keep failed submissions answerable through the ordinary request card.
        if (this.cancelled || !this.requests.has(id)) return;
      }
    }
    this.emit({ type: 'request', request: { ...request, id } });
  }
  async answer(id, value) {
    const respond = this.requests.get(id);
    if (!respond) throw new Error('This request is no longer pending');
    if (this.answering.has(id)) throw new Error('This response is already being submitted');
    this.answering.add(id);
    try {
      await respond(value);
      this.resolve(id);
    } finally {
      this.answering.delete(id);
    }
  }
  resolve(id) {
    this.requests.delete(String(id));
    this.emit({ type: 'resolved', id: String(id) });
  }
  child(executable, args, options = {}) {
    const child = spawn(executable, args, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    // Never forward arbitrary stderr into the protocol or include credentials in diagnostics.
    let tail = '';
    child.stderr?.on('data', (chunk) => {
      tail = clip(tail + chunk);
    });
    child.diagnostic = () => tail.slice(-4000);
    return child;
  }
  close() {
    clearInterval(this.flushTimer);
    this.flush();
    for (const child of this.children) child.kill();
    this.requests.clear();
  }
}

export class Rpc {
  constructor(child, onMessage) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.done = this.read(onMessage);
    // The owner awaits requests; observe the reader failure as well.
    this.done.catch(() => {});
    child.on('error', (error) => this.fail(error));
    child.stdin.on('error', (error) => this.fail(error));
  }
  fail(error) {
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
  async read(onMessage) {
    try {
      for await (const message of jsonLines(this.child.stdout)) {
        if (message.id != null && !message.method) {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
          }
        } else await onMessage(message);
      }
      throw new Error('Agent connection closed unexpectedly');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  send(message) {
    if (this.closed) throw new Error('Agent connection is closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method, params = {}, timeoutMs = 45000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`${method} did not acknowledge within 45 seconds`));
          }, timeoutMs)
        : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

export function questionsFrom(input) {
  return (input ?? []).map((q, index) => ({
    id: q.id ?? q.question ?? String(index),
    question: q.question ?? q.header ?? 'Your answer',
    options: (q.options ?? []).map((o) => (typeof o === 'string' ? { label: o } : o)),
    multiple: Boolean(q.multiSelect ?? q.multiple),
    secret: Boolean(q.isSecret),
  }));
}

export function requireAnswers(questions, response) {
  const answers = response?.answers;
  if (!answers || typeof answers !== 'object') throw new Error('Answers are required');
  for (const q of questions) {
    if (
      !Array.isArray(answers[q.id]) ||
      !answers[q.id].length ||
      !answers[q.id].every((v) => typeof v === 'string' && v.trim())
    ) {
      throw new Error(`Please answer: ${q.question}`);
    }
  }
  return Object.fromEntries(questions.map((q) => [q.id, answers[q.id]]));
}

export function elicitationView(request) {
  const url = request.url;
  return {
    kind: 'form',
    title: request.title ?? request.message ?? 'An MCP server needs your input',
    schema: request.requestedSchema,
    ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
    details: pretty({
      server: request.serverName ?? request.server_name,
      message: request.message,
      url,
    }),
  };
}

export function elicitationResponse(value) {
  if (!['accept', 'decline', 'cancel'].includes(value.action))
    throw new Error('Invalid form action');
  if (
    value.action === 'accept' &&
    value.content != null &&
    (typeof value.content !== 'object' || Array.isArray(value.content))
  )
    throw new Error('Form response must be a JSON object');
  return {
    action: value.action,
    ...(value.action === 'accept' && value.content != null ? { content: value.content } : {}),
  };
}
