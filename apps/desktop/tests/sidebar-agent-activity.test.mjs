import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

const files = {
  activity: '../../../packages/cockpit-ui/src/lib/agentActivity.ts',
  sidebar: '../src/components/sidebar/agentActivityModel.ts',
  badge: '../../../packages/cockpit-ui/src/components/AgentActivityBadge.tsx',
};
const loaded = new Map();
function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(files[name], import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const element = (type, props) => ({ type, props });
  runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === '@runhq/cockpit-ui' || id === '../lib/agentActivity') return load('activity');
      if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
      if (id === 'lucide-react')
        return {
          Bot: 'Bot',
          CheckCheck: 'CheckCheck',
          CircleAlert: 'CircleAlert',
          Square: 'Square',
        };
      if (id === '../lib/cn') return { cn: (...values) => values.filter(Boolean).join(' ') };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  loaded.set(name, exports);
  return exports;
}
const { summarizeAgentActivity, agentActivityLabel } = load('activity');
const { buildSidebarAgentActivity, createAgentActivitySelector } = load('sidebar');
const { AgentActivityBadge } = load('badge');
const session = (id, status = 'running', extra = {}) => ({
  id,
  status,
  project_id: 'project-a',
  cwd: '/repos/a',
  archived: false,
  unread: false,
  pending: [],
  updated_at: 1,
  ...extra,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const record = (...sessions) => Object.fromEntries(sessions.map((entry) => [entry.id, entry]));

test('counts live, waiting, stopping and unread-completed sessions separately', () => {
  const summary = summarizeAgentActivity([
    session('working'),
    session('starting', 'starting'),
    session('approval', 'waiting_permission'),
    session('question', 'waiting_input'),
    session('stopping', 'cancelling'),
    session('done', 'completed', { unread: true }),
    session('read', 'completed'),
    session('draft', 'idle', { unread: true }),
    session('stopped', 'cancelled'),
    session('failed', 'failed'),
    session('interrupted', 'interrupted'),
    session('archived', 'running', { archived: true }),
  ]);
  assert.deepEqual(plain(summary), {
    working: 1,
    starting: 1,
    waiting: 2,
    stopping: 1,
    unread: 1,
    issues: 2,
    targetSessionId: 'approval',
    targetProjectId: 'project-a',
  });
  assert.match(agentActivityLabel(summary), /1 working · 1 starting/);
  assert.match(agentActivityLabel(summary), /2 waiting for your decision/);
  assert.match(agentActivityLabel(summary), /1 unread completed response/);
  assert.match(agentActivityLabel(summary), /1 stopping/);
});

test('pending decisions override running status and duplicate references count only once', () => {
  const waiting = session('pending', 'running', { pending: [{ id: 'request' }] });
  const summary = summarizeAgentActivity([
    waiting,
    waiting,
    session('done', 'completed', { unread: true }),
  ]);
  assert.equal(summary.working, 0);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.unread, 1);
  assert.equal(summary.targetSessionId, 'pending');
});

test('the badge opens the most actionable task and then the most recent within its state', () => {
  const work = session('work', 'running', { updated_at: 100 });
  const done = session('done', 'completed', { unread: true, updated_at: 50 });
  const error = session('error', 'interrupted');
  const approval = session('approval', 'waiting_permission');
  const recentApproval = session('recent-approval', 'waiting_input', {
    updated_at: 2,
    project_id: 'project-b',
  });
  assert.equal(summarizeAgentActivity([work, done]).targetSessionId, 'done');
  assert.equal(summarizeAgentActivity([work, done, error]).targetSessionId, 'error');
  const all = summarizeAgentActivity([work, done, error, approval, recentApproval]);
  assert.equal(all.targetSessionId, 'recent-approval');
  assert.equal(all.targetProjectId, 'project-b');
});

test('services and stack/group members sharing one canonical project never double-count agents', () => {
  const projects = [
    { id: 'project-a', name: 'duplicate name', path: '/repos/a' },
    { id: 'project-b', name: 'duplicate name', path: '/repos/b' },
  ];
  const services = [
    { id: 'api', cwd: '/repos/a/' },
    { id: 'worker', cwd: '/repos/a' },
    { id: 'web', cwd: '/repos/b' },
    { id: 'unrelated', cwd: '/repos/a-copy' },
  ];
  const index = buildSidebarAgentActivity(
    projects,
    services,
    record(
      session('normal'),
      session('worktree', 'running', { cwd: '/worktrees/feature', isolated: true }),
      session('approval', 'waiting_permission', { project_id: 'project-b' }),
    ),
  );
  assert.equal(index.forServices(['api', 'worker', 'api']).working, 2);
  assert.equal(index.forServices(['api', 'worker', 'web']).waiting, 1);
  assert.equal(index.forServices(['api', 'worker', 'web']).working, 2);
  assert.equal(index.forServices(['unrelated']).working, 0);
  assert.equal(index.all.working, 2);
});

test('backend-resolved symlink aliases use the canonical project id, not session cwd or names', () => {
  const index = buildSidebarAgentActivity(
    [{ id: 'project-a', path: '/real/project', name: 'api' }],
    [{ id: 'alias', cwd: '/link/project/' }],
    record(session('isolated', 'running', { cwd: '/worktrees/change' })),
    { '/link/project': 'project-a' },
  );
  assert.equal(index.forServices(['alias']).working, 1);
  assert.equal(index.forServices(['alias']).targetProjectId, 'project-a');
  assert.equal(index.forServices(['missing']).targetSessionId, undefined);
});

test('streamed transcript revisions preserve sidebar snapshot identity; state changes update counts', () => {
  const select = createAgentActivitySelector();
  const initial = record(session('work'));
  assert.equal(select({ sessions: initial }), initial);
  const transcript = record(
    session('work', 'running', { revision: 5, updated_at: 100, usage: { tokens: 100 } }),
  );
  assert.equal(select({ sessions: transcript }), initial);
  const waiting = record(session('work', 'waiting_input'));
  assert.equal(select({ sessions: waiting }), waiting);
  const completed = record(session('work', 'completed', { unread: true }));
  assert.equal(select({ sessions: completed }), completed);
  const read = record(session('work', 'completed'));
  assert.equal(select({ sessions: read }), read);
  const archived = record(session('work', 'completed', { archived: true }));
  assert.equal(select({ sessions: archived }), archived);
  assert.deepEqual(plain(select({ sessions: {} })), {});
});

test('activity badge has accessible status text and isolates click, pointer and drag events from service rows', () => {
  let clicks = 0;
  let stopped = 0;
  let prevented = 0;
  const node = AgentActivityBadge({
    activity: summarizeAgentActivity([session('work'), session('approval', 'waiting_permission')]),
    name: 'API',
    onClick: () => {
      clicks++;
    },
  });
  assert.equal(node.type, 'button');
  assert.equal(node.props.type, 'button');
  assert.match(node.props['aria-label'], /API agents: 1 working · 1 waiting for your decision/);
  const event = {
    stopPropagation: () => {
      stopped++;
    },
    preventDefault: () => {
      prevented++;
    },
  };
  node.props.onClick(event);
  node.props.onPointerDown(event);
  node.props.onDragStart(event);
  assert.equal(clicks, 1);
  assert.equal(stopped, 3);
  assert.equal(prevented, 1);
  assert.match(JSON.stringify(node), /motion-safe:animate-pulse/);
});

test('quiet rows render no badge; compact badge retains complete accessible counts', () => {
  assert.equal(
    AgentActivityBadge({ activity: summarizeAgentActivity([]), name: 'API', onClick() {} }),
    null,
  );
  const node = AgentActivityBadge({
    activity: summarizeAgentActivity([
      session('work'),
      session('done', 'completed', { unread: true }),
    ]),
    name: 'API',
    compact: true,
    onClick() {},
  });
  assert.match(node.props.title, /1 working · 1 unread completed response/);
  assert.match(node.props.className, /h-4/);
});
