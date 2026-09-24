import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === '@/lib/ipc')
          return {
            ipc: {
              agentStart: async () => {
                throw new Error('Unexpected real IPC');
              },
            },
          };
        if (name === '@/lib/agentRecoveryPersistence')
          return load('../src/lib/agentRecoveryPersistence.ts');
        if (name === './agentTurnQueue') return load('../src/components/agents/agentTurnQueue.ts');
        if (name === './agentTaskStart') return load('../src/components/agents/agentTaskStart.ts');
        if (name === '@runhq/cockpit-ui')
          return load('../../../packages/cockpit-ui/src/lib/agentAttachments.ts');
        throw new Error(name);
      },
    },
  );
  return exports;
}
const {
  createAgentSendRecordStore,
  createRecoverableAgentSender,
  isInitialAgentTaskRecoveryRecord,
} = load('../src/components/agents/agentSendRecovery.ts');
const turn = {
  session_id: 'session',
  request_id: 'original-request',
  prompt: 'Original prompt',
  model: 'chosen-model',
  effort: 'high',
  mode: 'plan',
  attachments: [{ name: 'screen.png', mime_type: 'image/png', data: 'aW1hZ2U=' }],
};
const session = { id: 'session', status: 'running' };
function persistence() {
  let data = {};
  return {
    load: () => ({ data: JSON.parse(JSON.stringify(data)), error: null }),
    save: (next) => {
      data = JSON.parse(JSON.stringify(next));
      return null;
    },
  };
}

test('direct sends reuse exact saved request ID and image context across reload after an unknown outcome', async () => {
  const disk = persistence();
  const started = [];
  const start = async (input) => {
    started.push(input);
    if (started.length === 1) throw new Error('Connection lost');
    return session;
  };
  const first = createRecoverableAgentSender({ recovery: createAgentSendRecordStore(disk), start });
  await assert.rejects(first.send(turn), /Connection lost/);
  const reopened = createRecoverableAgentSender({
    recovery: createAgentSendRecordStore(disk),
    start,
  });
  assert.equal(reopened.recovered('session').turn.request_id, 'original-request');
  await reopened.send({ ...turn, request_id: 'new-client-id' });
  assert.equal(started[1].request_id, 'original-request');
  assert.deepEqual(JSON.parse(JSON.stringify(started[1].attachments)), turn.attachments);
  assert.equal(reopened.recovered('session').accepted.id, session.id);
  reopened.complete('session');
  assert.equal(reopened.recovered('session'), null);
});

test('changed payload cannot overwrite an unconfirmed direct send until explicitly discarded', async () => {
  const recovery = createAgentSendRecordStore(persistence());
  recovery.save({ turn }, 'session');
  let calls = 0;
  const sender = createRecoverableAgentSender({
    recovery,
    start: async () => {
      calls++;
      return session;
    },
  });
  await assert.rejects(sender.send({ ...turn, prompt: 'Different text' }), /unconfirmed send/);
  assert.equal(calls, 0);
  assert.equal(recovery.load('session').turn.prompt, 'Original prompt');
  sender.discard('session');
  await sender.send({ ...turn, request_id: 'new', prompt: 'Different text' });
  assert.equal(calls, 1);
});

test('accepted direct send does not execute again when saving its acknowledgement or clearing fails', async () => {
  const disk = persistence();
  let writes = 0;
  let failed = true;
  const recovery = createAgentSendRecordStore({
    load: disk.load,
    save: (record) => {
      writes++;
      if (writes > 1 && failed) return 'Disk full';
      return disk.save(record);
    },
  });
  let starts = 0;
  const sender = createRecoverableAgentSender({
    recovery,
    start: async () => {
      starts++;
      return session;
    },
  });
  await assert.rejects(sender.send(turn), /Disk full/);
  assert.equal(recovery.load('session').accepted.id, session.id);
  failed = false;
  await sender.send(turn);
  assert.equal(starts, 1);
  sender.complete('session');
  assert.equal(recovery.load('session'), null);
});

test('successful send remains recoverable until composer cleanup completes, and concurrent different messages are rejected', async () => {
  let finish;
  let calls = 0;
  const recovery = createAgentSendRecordStore(persistence());
  const sender = createRecoverableAgentSender({
    recovery,
    start: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = sender.send(turn);
  await assert.rejects(sender.send({ ...turn, prompt: 'Another message' }), /already being sent/);
  finish(session);
  await first;
  assert.equal(sender.recovered('session').accepted.id, session.id);
  await sender.send(turn);
  assert.equal(calls, 1, 'retrying after context cleanup failure must use the accepted result');
  sender.complete('session');
  assert.equal(sender.recovered('session'), null);
});

test('direct dispatch cannot happen before durable recording and invalid recovered images are rejected', async () => {
  const recovery = createAgentSendRecordStore({
    load: () => ({ data: {}, error: null }),
    save: () => 'Storage blocked',
  });
  let starts = 0;
  const sender = createRecoverableAgentSender({
    recovery,
    start: async () => {
      starts++;
      return session;
    },
  });
  await assert.rejects(sender.send(turn), /Storage blocked/);
  assert.equal(starts, 0);
  assert.equal(
    isInitialAgentTaskRecoveryRecord({
      project: {
        projectId: 'project',
        creationRequestId: 'creation',
        requestId: 'request',
        input: { project_id: 'project' },
        text: 'Hello',
        draftText: 'Hello',
        phase: 'creating',
        session: null,
        turn: null,
        attachments: [{ name: 'bad.png', mime_type: 'image/png', data: 'invalid' }],
      },
    }),
    false,
  );
});
