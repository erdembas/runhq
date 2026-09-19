import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/components/agents/agentTaskLauncher.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const exports = {};
runInNewContext(compiled, { exports, crypto: { randomUUID } });
const { createAgentTaskLauncher } = exports;
const input = {
  project_id: 'project-a',
  backend: 'claude',
  isolated: true,
  model: 'opus',
  effort: 'high',
  mode: 'plan',
  agent: 'reviewer',
};
const session = { ...input, id: 'session-a' };

test('one send creates the chosen project workspace and starts its first turn with the selected settings', async () => {
  const order = [];
  const launcher = createAgentTaskLauncher({
    create: async (actual) => {
      assert.equal(actual, input);
      order.push('create');
      return session;
    },
    created: (actual, text) => {
      assert.equal(actual.id, session.id);
      assert.equal(text, 'Review this change');
      order.push('save draft');
    },
    start: async (turn) => {
      assert.equal(turn.session_id, session.id);
      assert.equal(turn.prompt, 'Review this change');
      for (const key of ['model', 'effort', 'mode', 'agent']) assert.equal(turn[key], input[key]);
      assert(turn.request_id);
      order.push('send');
      return { ...session, status: 'running' };
    },
  });
  assert.equal((await launcher.send(input, 'Review this change')).status, 'running');
  assert.deepEqual(order, ['create', 'save draft', 'send']);
});

test('double submission shares one creation and one first turn', async () => {
  let release;
  let creations = 0;
  let starts = 0;
  const launcher = createAgentTaskLauncher({
    create: () => {
      creations++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    created: () => {},
    start: async () => {
      starts++;
      return session;
    },
  });
  const first = launcher.send(input, 'Build it');
  const second = launcher.send(input, 'Build it');
  assert.equal(first, second);
  release(session);
  await Promise.all([first, second]);
  assert.equal(creations, 1);
  assert.equal(starts, 1);
});

test('failed first turn retains its workspace, message and idempotency key for retry', async () => {
  let creations = 0;
  const turns = [];
  const launcher = createAgentTaskLauncher({
    create: async () => {
      creations++;
      return session;
    },
    created: () => {},
    start: async (turn) => {
      turns.push(turn);
      if (turns.length === 1) throw new Error('Connection lost');
      return session;
    },
  });
  await assert.rejects(launcher.send(input, 'Original message'), /Connection lost/);
  assert.equal(launcher.session.id, session.id);
  await launcher.send({ ...input, backend: 'codex' }, 'Changed message');
  assert.equal(creations, 1);
  assert.equal(turns[0], turns[1]);
  assert.equal(turns[1].prompt, 'Original message');
});

test('a creation error permits retry and an empty message never creates a workspace', async () => {
  let creations = 0;
  let starts = 0;
  const launcher = createAgentTaskLauncher({
    create: async () => {
      if (++creations === 1) throw new Error('Invalid workspace');
      return session;
    },
    created: () => {},
    start: async () => {
      starts++;
      return session;
    },
  });
  await assert.rejects(launcher.send(input, '   '), /Write a message/);
  assert.equal(creations, 0);
  await assert.rejects(launcher.send(input, 'Fix it'), /Invalid workspace/);
  assert.equal(launcher.session, null);
  assert.equal(starts, 0);
  await launcher.send(input, 'Fix it');
  assert.equal(creations, 2);
  assert.equal(starts, 1);
});

const persistedRecovery = () => {
  const records = new Map();
  return {
    records,
    load: (projectId) => (records.has(projectId) ? JSON.parse(records.get(projectId)) : null),
    save: (record, projectId) => {
      if (record) records.set(projectId, JSON.stringify(record));
      else records.delete(projectId);
    },
  };
};

test('first-send recovery survives reload with exact message, options, images, session and request ID', async () => {
  const recovery = persistedRecovery();
  const attachments = [{ name: 'screen.png', mime_type: 'image/png', data: 'aW1hZ2U=' }];
  let creations = 0;
  const turns = [];
  const deps = {
    recovery,
    create: async (actual) => {
      creations++;
      assert.equal(actual.creation_request_id, recovery.load(input.project_id).creationRequestId);
      return session;
    },
    created: () => {},
    start: async (turn) => {
      turns.push(turn);
      if (turns.length === 1) throw new Error('Lost acknowledgement');
      return session;
    },
  };
  await assert.rejects(
    createAgentTaskLauncher(deps).send(input, 'Original', attachments, {
      draftText: 'Original draft',
    }),
    /Lost acknowledgement/,
  );
  const reopened = createAgentTaskLauncher(deps);
  assert.equal(reopened.restore(input.project_id).draftText, 'Original draft');
  assert.equal(reopened.session.id, session.id);
  await reopened.send({ ...input, backend: 'different' }, 'Changed text', []);
  assert.equal(creations, 1);
  assert.equal(turns[0].request_id, turns[1].request_id);
  assert.equal(turns[1].prompt, 'Original');
  assert.equal(turns[1].model, input.model);
  assert.deepEqual(JSON.parse(JSON.stringify(turns[1].attachments)), attachments);
  assert.equal(recovery.load(input.project_id).phase, 'accepted');
  const afterLinkFailure = createAgentTaskLauncher(deps);
  await afterLinkFailure.send(input, 'Original');
  assert.equal(
    turns.length,
    2,
    'an accepted first message must not be sent again after a post-launch save failure',
  );
  afterLinkFailure.complete();
  assert.equal(recovery.load(input.project_id), null);
});

test('lost creation acknowledgement reuses backend creation identity and original handoff source', async () => {
  const recovery = persistedRecovery();
  const identities = [];
  const sources = [];
  const deps = {
    recovery,
    created: () => {},
    start: async () => session,
    create: async (actual, source) => {
      identities.push(actual.creation_request_id);
      sources.push(source);
      if (identities.length === 1) throw new Error('Connection lost after create');
      return session;
    },
  };
  await assert.rejects(
    createAgentTaskLauncher(deps).send(input, 'Build it', undefined, {
      sourceSessionId: 'source-task',
    }),
    /Connection lost/,
  );
  const reopened = createAgentTaskLauncher(deps);
  await reopened.send({ ...input, model: 'changed' }, 'Different prompt');
  assert.equal(identities[0], identities[1]);
  assert.deepEqual(sources, ['source-task', 'source-task']);
});

test('persistence failures block initial creation and preserve accepted launch until completion can save', async () => {
  const recovery = persistedRecovery();
  let failed = true;
  let creates = 0;
  let starts = 0;
  const durable = {
    load: recovery.load,
    save: (record, id) => {
      if (failed) throw new Error('Disk full');
      recovery.save(record, id);
    },
  };
  const launcher = createAgentTaskLauncher({
    recovery: durable,
    create: async () => {
      creates++;
      return session;
    },
    created: () => {},
    start: async () => {
      starts++;
      return session;
    },
  });
  await assert.rejects(launcher.send(input, 'Build it'), /Disk full/);
  assert.equal(creates, 0);
  failed = false;
  await launcher.send(input, 'Build it');
  failed = true;
  assert.throws(() => launcher.complete(), /Disk full/);
  assert.equal(launcher.recovery.phase, 'accepted');
  failed = false;
  await launcher.send(input, 'Build it');
  assert.equal(creates, 1);
  assert.equal(starts, 1);
  launcher.complete();
  assert.equal(recovery.load(input.project_id), null);
});
