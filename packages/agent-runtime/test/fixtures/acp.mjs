import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import process from 'node:process';
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const session = {
  sessionId: 'acp-saved',
  configOptions: [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: 'm1',
      options: [
        { value: 'm1', name: 'Model one' },
        { value: 'm2', name: 'Model two' },
      ],
    },
    {
      id: 'thought',
      category: 'thought_level',
      type: 'select',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      currentValue: process.argv.includes('--saved-plan') ? 'plan' : 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'plan', name: 'Plan' },
      ],
    },
  ],
};
let pending;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  assert.equal(message.jsonrpc, '2.0');
  const { method, id, params: p } = message;
  if (method === 'initialize')
    send({
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: !process.argv.includes('--no-resume') },
      },
    });
  else if (method === 'session/new' || method === 'session/load') {
    if (method === 'session/load') {
      assert.equal(p.sessionId, 'acp-saved');
      send({
        method: 'session/update',
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Old history should not repeat' },
          },
        },
      });
    }
    send({
      id,
      result: method === 'session/load' && process.argv.includes('--empty-load') ? null : session,
    });
  } else if (method === 'session/set_config_option') {
    const option = session.configOptions.find((o) => o.id === p.configId);
    assert(option.options.some((o) => o.value === p.value));
    option.currentValue = p.value;
    send({ id, result: { configOptions: session.configOptions } });
  } else if (method === 'session/prompt') {
    pending = id;
    send({
      method: 'session/update',
      params: {
        sessionId: 'acp-saved',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Working' },
        },
      },
    });
    send({
      id: 999,
      method: 'session/request_permission',
      params: {
        sessionId: 'acp-saved',
        toolCall: { toolCallId: 't1', title: 'Allow fixture tool?' },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
    });
  } else if (method === 'session/cancel') {
    send({ id: pending, result: { stopReason: 'cancelled' } });
    pending = undefined;
  } else if (id === 999) {
    if (message.result.outcome.outcome === 'selected') {
      assert.equal(message.result.outcome.optionId, 'deny');
      send({ id: pending, result: { stopReason: 'end_turn' } });
      pending = undefined;
    }
  } else throw new Error(`Unexpected method ${method}`);
}
