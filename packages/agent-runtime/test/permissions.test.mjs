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

test('requests resolved during the policy check are not re-emitted as pending', async () => {
  const events = [];
  const ctx = new Context({ cwd: '/workspace' }, (e) => events.push(e));
  try {
    const asking = ctx.ask(request, async () => {}, approval);
    ctx.resolve(request.id);
    await asking;
    assert(!events.some((e) => e.type === 'request'));
  } finally {
    ctx.close();
  }
});

test('workspace grants unblock pending tools and subsequent requests but keep questions manual', async () => {
  const events = [];
  const answers = [];
  const ctx = new Context({ cwd: '/workspace', permission_policy: 'ask' }, (e) => events.push(e));
  try {
    for (const id of ['first', 'parallel'])
      await ctx.ask({ ...request, id }, async (value) => answers.push([id, value]), approval);
    await ctx.ask(
      { ...request, id: 'question', kind: 'question' },
      async () => assert.fail(),
      approval,
    );
    assert.deepEqual(events.find((e) => e.request?.id === 'first').request.workspace_approval, {
      path: '/workspace',
      decision: 'once',
    });
    assert.equal(
      events.find((e) => e.request?.id === 'question').request.workspace_approval,
      undefined,
    );
    await assert.rejects(
      ctx.answer('first', { decision: 'reject', permission_scope: 'workspace' }),
    );
    assert.equal(ctx.config.permission_policy, 'ask');
    await ctx.answer('first', { decision: 'once', permission_scope: 'workspace' });
    await ctx.ask(
      { ...request, id: 'next' },
      async (value) => answers.push(['next', value]),
      approval,
    );
    assert.deepEqual(
      answers,
      ['first', 'parallel', 'next'].map((id) => [id, { decision: 'once' }]),
    );
    assert.deepEqual([...ctx.requests.keys()], ['question']);
    assert.equal(ctx.config.permission_policy, 'all');
    assert(!events.some((e) => e.request?.id === 'next'));
    assert.equal(events.filter((e) => e.item?.kind === 'automatic_approval').length, 2);
  } finally {
    ctx.close();
  }
});

test('workspace grants are not offered or accepted for plan transitions, forms or reviews', async () => {
  for (const extra of [
    { mode: 'plan' },
    { agent: 'plan' },
    { read_only_review: true },
    { cwd: '' },
  ]) {
    const events = [];
    const ctx = new Context({ cwd: '/workspace', ...extra }, (e) => events.push(e));
    try {
      await ctx.ask(request, async () => assert.fail(), approval);
      assert.equal(events.find((e) => e.request).request.workspace_approval, undefined);
      await assert.rejects(ctx.answer('p', { decision: 'once', permission_scope: 'workspace' }));
      assert.notEqual(ctx.config.permission_policy, 'all');
    } finally {
      ctx.close();
    }
  }
  for (const [kind, metadata] of [
    ['form', approval],
    ['question', approval],
    ['approval', claudeApproval('ExitPlanMode')],
  ]) {
    const events = [];
    const ctx = new Context({ cwd: '/workspace' }, (e) => events.push(e));
    try {
      await ctx.ask({ ...request, kind }, async () => assert.fail(), metadata);
      assert.equal(events.find((e) => e.request).request.workspace_approval, undefined);
      await assert.rejects(ctx.answer('p', { decision: 'once', permission_scope: 'workspace' }));
    } finally {
      ctx.close();
    }
  }
});

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
