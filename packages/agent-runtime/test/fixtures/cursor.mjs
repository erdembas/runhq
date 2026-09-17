import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import process from 'node:process';

const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const flag = (name) => process.argv.includes(name);
if (flag('--help')) {
  process.stdout.write(
    flag('--old-cli')
      ? 'Usage: agent [prompt...]\nCommands:\n  login\n  update\n'
      : 'Usage: agent acp [options]\n',
  );
  process.exit(0);
}
assert(!flag('--old-cli'), 'An old Cursor CLI must never receive a model prompt');
let authenticated = false;
let mode = 'agent';
let promptId;
const plan = {
  toolCallId: 'plan-1',
  name: 'Improve navigation',
  overview: 'Simplify the navigation.',
  plan: '## Navigation\n\n1. Inspect the routes.\n2. Update the sidebar.',
  todos: [{ id: 'inspect', content: 'Inspect routes', status: 'pending' }],
};
const question = {
  toolCallId: 'question-1',
  title: 'Choose navigation',
  questions: [
    {
      id: 'layout',
      prompt: 'Which layout?',
      options: [
        { id: 'left', label: 'Sidebar' },
        { id: 'right', label: 'Sidebar' },
      ],
    },
    {
      id: 'features',
      prompt: 'Which features?',
      allowMultiple: true,
      options: [
        { id: 'search', label: 'Search' },
        { id: 'tabs', label: 'Tabs' },
      ],
    },
  ],
};
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const { method, id, params: p } = message;
  assert.equal(message.jsonrpc, '2.0');
  if (method === 'initialize') {
    send({
      id,
      result: {
        protocolVersion: 1,
        authMethods: [{ id: 'cursor_login', name: 'Cursor login' }],
        agentCapabilities: { loadSession: true },
      },
    });
  } else if (method === 'authenticate') {
    assert.equal(p.methodId, 'cursor_login');
    authenticated = true;
    send(
      flag('--auth-failure')
        ? { id, error: { code: -32000, message: 'No token' } }
        : { id, result: {} },
    );
  } else if (method === 'session/new' || method === 'session/load') {
    assert(authenticated);
    if (method === 'session/load') {
      assert.equal(p.sessionId, 'cursor-saved');
      mode = 'plan';
      send({ id: 900, method: 'cursor/create_plan', params: { ...plan, name: 'Old plan' } });
      send({
        method: 'cursor/update_todos',
        params: {
          toolCallId: 'old',
          todos: [{ id: 'old', content: 'Old replay', status: 'completed' }],
          merge: false,
        },
      });
    }
    send({
      id,
      result: {
        sessionId: 'cursor-saved',
        modes: {
          currentModeId: mode,
          availableModes: ['agent', 'plan', 'ask'].map((id) => ({ id, name: id })),
        },
        models: {
          currentModelId: 'cursor-model',
          availableModels: [{ modelId: 'cursor-model', name: 'Cursor model' }],
        },
      },
    });
  } else if (method === 'session/set_mode') {
    assert(['agent', 'plan', 'ask'].includes(p.modeId));
    mode = p.modeId;
    send({ id, result: {} });
  } else if (method === 'session/set_model') {
    assert.equal(p.modelId, 'cursor-model');
    send({ id, result: {} });
  } else if (method === 'session/prompt') {
    promptId = id;
    if (flag('--modes-only')) {
      assert.equal(mode, p.prompt[0].text);
      send({ id, result: { stopReason: 'end_turn' } });
    } else {
      assert.equal(mode, 'plan');
      send({ id: 700, method: 'cursor/ask_question', params: question });
    }
  } else if (method === 'session/cancel') {
    send({ id: promptId, result: { stopReason: 'cancelled' } });
  } else if (id === 900) {
    assert.equal(message.result.outcome.outcome, 'cancelled');
  } else if (id === 700) {
    if (message.result.outcome.outcome === 'cancelled') continue;
    assert.deepEqual(message.result.outcome, {
      outcome: 'answered',
      answers: [
        { questionId: 'layout', selectedOptionIds: ['right'] },
        { questionId: 'features', selectedOptionIds: ['search', 'tabs'] },
      ],
    });
    send({ id: 701, method: 'cursor/create_plan', params: plan });
  } else if (id === 701) {
    if (message.result.outcome.outcome === 'cancelled') continue;
    assert.equal(message.result.outcome.outcome, flag('--reject-plan') ? 'rejected' : 'accepted');
    send({
      method: 'cursor/update_todos',
      params: {
        toolCallId: 'todos-1',
        merge: true,
        todos: [
          { id: 'inspect', content: 'Inspect routes', status: 'completed' },
          { id: 'implement', content: 'Update sidebar', status: 'in_progress' },
        ],
      },
    });
    send({
      method: 'cursor/update_todos',
      params: {
        toolCallId: 'todos-2',
        merge: true,
        todos: [{ id: 'implement', content: 'Update sidebar', status: 'completed' }],
      },
    });
    send({
      method: 'cursor/task',
      params: {
        toolCallId: 'subagent-1',
        description: 'Explore routing',
        prompt: 'Find route handlers',
        subagentType: 'explore',
        agentId: 'explorer-1',
        durationMs: 123,
      },
    });
    send({
      method: 'cursor/generate_image',
      params: {
        toolCallId: 'image-1',
        description: 'Navigation illustration',
        filePath: '/tmp/navigation.png',
      },
    });
    send({ id: promptId, result: { stopReason: 'end_turn' } });
  } else throw new Error(`Unexpected method: ${method}`);
}
