import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Context, jsonLines, requireAnswers } from '../src/protocol.mjs';
import { codexRequest } from '../src/codex.mjs';
import { sseEvents } from '../src/opencode.mjs';

test('JSONL preserves split UTF-8 and multiple frames', async () => {
  const bytes = Buffer.from('{"text":"İstanbul"}\n{"done":true}\n');
  const values = [];
  for await (const value of jsonLines(Readable.from([bytes.subarray(0, 10), bytes.subarray(10)])))
    values.push(value);
  assert.deepEqual(values, [{ text: 'İstanbul' }, { done: true }]);
});
test('SSE consumes comments, chunked frames and data events', async () => {
  const chunks = [': heartbeat\n\ndata: {"type":', '"one"}\n\ndata: {"type":"two"}\n\n'].map((v) =>
    Buffer.from(v),
  );
  const events = [];
  for await (const event of sseEvents(Readable.from(chunks))) events.push(event);
  assert.deepEqual(events, [{ type: 'one' }, { type: 'two' }]);
});
test('Codex user-input answers preserve question IDs and multiple values', () => {
  const request = codexRequest('item/tool/requestUserInput', {
    questions: [{ id: 'db', question: 'Database?', options: [{ label: 'SQLite' }] }],
  });
  assert.throws(() => request.response({ answers: {} }), /Please answer/);
  assert.deepEqual(request.response({ answers: { db: ['SQLite', 'Local only'] } }), {
    answers: { db: { answers: ['SQLite', 'Local only'] } },
  });
});
test('Approvals only accept provider-advertised decisions', () => {
  const request = codexRequest('item/commandExecution/requestApproval', {
    availableDecisions: ['accept', 'decline'],
  });
  assert.throws(() => request.response({ decision: 'acceptForSession' }), /Invalid/);
  assert.deepEqual(request.response({ decision: 'decline' }), { decision: 'decline' });
  assert.equal(codexRequest('unknown/newMethod', {}), null);
});
test('Extra permissions are scoped to this turn and denial grants nothing', () => {
  const request = codexRequest('item/permissions/requestApproval', {
    permissions: { network: { enabled: true } },
  });
  assert.deepEqual(request.response({ decision: 'decline' }), { permissions: {}, scope: 'turn' });
  assert.equal(request.response({ decision: 'accept' }).scope, 'turn');
});
test('Invalid and duplicate answers cannot resolve a pending request', async () => {
  const events = [];
  const ctx = new Context({}, (event) => events.push(event));
  let release;
  let calls = 0;
  await ctx.ask({ id: 'r', kind: 'question' }, async (value) => {
    requireAnswers([{ id: 'a', question: 'A?' }], value);
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  await assert.rejects(ctx.answer('r', { answers: {} }), /Please answer/);
  assert(ctx.requests.has('r'));
  const accepted = ctx.answer('r', { answers: { a: ['yes'] } });
  await assert.rejects(ctx.answer('r', { answers: { a: ['no'] } }), /already/);
  release();
  await accepted;
  await assert.rejects(ctx.answer('r', {}), /no longer/);
  assert.equal(calls, 1);
  assert.equal(events.filter((e) => e.type === 'resolved').length, 1);
  ctx.close();
});
test('Streaming text is bounded and coalesces to authoritative items', () => {
  const events = [];
  const ctx = new Context({}, (event) => events.push(event));
  ctx.delta('a', 'assistant', 'first');
  ctx.delta('a', 'assistant', ' second');
  ctx.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].item.text, 'first second');
  ctx.item('a', 'assistant', 'Final', 'authoritative', 'completed');
  assert.equal(events.at(-1).item.text, 'authoritative');
  ctx.close();
});
