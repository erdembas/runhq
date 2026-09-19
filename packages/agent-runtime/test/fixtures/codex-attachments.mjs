import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import process from 'node:process';

const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: {} });
  else if (method === 'initialized') continue;
  else if (method === 'thread/start') {
    assert.equal(params.sandbox, 'read-only');
    send({ id, result: { thread: { id: 'image-thread' }, model: 'fixture-model' } });
  } else if (method === 'turn/start') {
    assert.deepEqual(params.input, [
      { type: 'text', text: 'Inspect the screenshot' },
      { type: 'image', url: 'data:image/png;base64,aGVsbG8=' },
    ]);
    send({ id, result: { turn: { id: 'image-turn' } } });
    send({
      method: 'item/completed',
      params: { item: { id: 'echo', type: 'userMessage', content: params.input } },
    });
    send({
      method: 'item/completed',
      params: { item: { id: 'result', type: 'agentMessage', text: 'Native image received' } },
    });
    send({ method: 'turn/completed', params: { turn: { id: 'image-turn', status: 'completed' } } });
  } else throw new Error(`Unexpected method ${method}`);
}
