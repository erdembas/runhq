import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '../src/protocol.mjs';
import {
  automaticApproval,
  openCodeApproval,
  claudeApproval,
  acpApproval,
} from '../src/permissions.mjs';
import { codexRequest } from '../src/codex.mjs';

const request = {
  id: 'p',
  kind: 'approval',
  title: 'Allow external_directory?',
  details: '/outside/*',
  choices: [{ value: 'once' }, { value: 'always' }, { value: 'reject' }],
};
const approval = openCodeApproval('external_directory');

test('permissions default to asking and read policy excludes writes, commands and unknown tools', () => {
  for (const permission_policy of [undefined, 'ask', 'invalid'])
    assert.equal(automaticApproval({ permission_policy }, request, approval), null);
  for (const permission of ['read', 'glob', 'grep', 'list', 'external_directory'])
    assert.deepEqual(
      automaticApproval({ permission_policy: 'read' }, request, openCodeApproval(permission)),
      { decision: 'once' },
    );
  for (const permission of ['edit', 'bash', 'webfetch', undefined, 'new_permission'])
    assert.equal(
      automaticApproval({ permission_policy: 'read' }, request, openCodeApproval(permission)),
      null,
    );
  assert.deepEqual(
    automaticApproval({ permission_policy: 'all' }, request, openCodeApproval('bash')),
    { decision: 'once' },
  );
});

test('questions, forms, plan mode and independent reviews never receive automatic grants', () => {
  for (const kind of ['question', 'form'])
    assert.equal(
      automaticApproval({ permission_policy: 'all' }, { ...request, kind }, approval),
      null,
    );
  for (const extra of [{ mode: 'plan' }, { agent: 'plan' }, { read_only_review: true }])
    assert.equal(
      automaticApproval({ permission_policy: 'all', ...extra }, request, approval),
      null,
    );
  assert.equal(automaticApproval({ permission_policy: 'all' }, request, null), null);
});

test('adapters select only explicit one-time allow decisions', () => {
  assert.equal(
    automaticApproval(
      { permission_policy: 'all' },
      { ...request, choices: [{ value: undefined }] },
      { category: 'tool' },
    ),
    null,
  );
  assert.equal(claudeApproval('Read').category, 'read');
  assert.equal(claudeApproval('Bash').category, 'tool');
  for (const name of ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])
    assert.equal(claudeApproval(name), null);
  assert.equal(acpApproval({ options: [{ kind: 'allow_always', optionId: 'allow' }] }), null);
  const acp = acpApproval({
    toolCall: { kind: 'read' },
    options: [
      { kind: 'reject_once', optionId: 'allow' },
      { kind: 'allow_once', optionId: 'custom-yes' },
    ],
  });
  assert.deepEqual(acp, { category: 'read', decision: 'custom-yes' });
  const codex = codexRequest('item/commandExecution/requestApproval', {
    availableDecisions: ['decline', 'acceptForSession'],
  });
  assert.equal(automaticApproval({ permission_policy: 'all' }, codex, codex.approval), null);
  const permissions = codexRequest('item/permissions/requestApproval', {
    permissions: { network: { enabled: true } },
  });
  assert.equal(
    automaticApproval({ permission_policy: 'read' }, permissions, permissions.approval),
    null,
  );
  assert.deepEqual(
    automaticApproval({ permission_policy: 'all' }, permissions, permissions.approval),
    { decision: 'accept' },
  );
});

test('automatic grants resolve without a pending UI request and leave an audit entry', async () => {
  const events = [];
  const ctx = new Context({ permission_policy: 'read' }, (event) => events.push(event));
  try {
    const answers = [];
    await ctx.ask(request, async (value) => answers.push(value), approval);
    assert.deepEqual(answers, [{ decision: 'once' }]);
    assert.equal(ctx.requests.size, 0);
    assert(!events.some((event) => event.type === 'request'));
    const item = events.find((event) => event.item?.kind === 'automatic_approval').item;
    assert.equal(item.status, 'completed');
    assert.deepEqual(JSON.parse(item.text), {
      request: '/outside/*',
      response: { decision: 'once' },
      policy: 'read',
    });
  } finally {
    ctx.close();
  }
});

test('failed automatic grants remain manually answerable and cancelled turns do not auto-answer', async () => {
  const events = [];
  const ctx = new Context({ permission_policy: 'all' }, (event) => events.push(event));
  try {
    let calls = 0;
    await ctx.ask(
      request,
      async () => {
        if (++calls === 1) throw new Error('Provider unavailable');
      },
      approval,
    );
    assert(ctx.requests.has('p'));
    assert(events.some((event) => event.type === 'request'));
    assert(events.some((event) => event.item?.status === 'failed'));
    await ctx.answer('p', { decision: 'reject' });
    assert.equal(calls, 2);
    ctx.cancelled = true;
    await ctx.ask(
      { ...request, id: 'cancelled' },
      async () => {
        throw new Error('Must not submit');
      },
      approval,
    );
    assert(!events.some((event) => event.id === 'cancelled' && event.type === 'resolved'));
  } finally {
    ctx.close();
  }
});
