import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert(name in dependencies, `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}
const lanes = load('../../../packages/cockpit-ui/src/lib/agentMissionControl.ts');
const { buildAgentDashboard } = load('../src/components/dashboard/agentDashboardModel.ts', {
  '@runhq/cockpit-ui': { ...lanes, agentProviderNames: { codex: 'Codex', claude: 'Claude' } },
});
const task = (id, overrides = {}) => ({
  id,
  title: id,
  project_id: 'a',
  project_name: 'Alpha',
  backend: 'codex',
  model: '',
  branch: '',
  status: 'idle',
  pending: [],
  archived: false,
  unread: false,
  updated_at: 1,
  ...overrides,
});
const sessions = (...tasks) => Object.fromEntries(tasks.map((entry) => [entry.id, entry]));
const ids = (view) =>
  Array.from(view.groups).flatMap((group) => Array.from(group.sessions, (s) => s.id));

test('dashboard excludes archives and keeps status totals independent of the selected lane', () => {
  const input = sessions(
    task('running', { status: 'running' }),
    task('blocked', { status: 'running', pending: [{ id: 'approval' }] }),
    task('done', { status: 'completed', unread: true }),
    task('archived', { status: 'failed', archived: true }),
  );
  const result = buildAgentDashboard(input, [], { filter: 'working' });
  assert.deepEqual(ids(result), ['running']);
  assert.equal(result.total, 3);
  assert.equal(result.scopedTotal, 3);
  assert.equal(result.matchedTotal, 1);
  assert.deepEqual({ ...result.counts }, { attention: 1, working: 1, ready: 0, completed: 1 });
});

test('project and normalized search filters intersect and also scope the summary', () => {
  const input = sessions(
    task('api', { title: 'Review API', model: 'gpt-fast', project_name: 'Old name' }),
    task('other', { title: 'Review API', project_id: 'b', model: 'gpt-fast' }),
    task('unrelated', { title: 'Update docs' }),
  );
  const result = buildAgentDashboard(input, [{ id: 'a', name: 'New name' }], {
    projectId: 'a',
    query: '  NEW   CODEX  fast  ',
  });
  assert.deepEqual(ids(result), ['api']);
  assert.equal(result.groups[0].name, 'New name');
  assert.equal(result.counts.ready, 1);
  assert.equal(result.total, 3);
  assert.equal(buildAgentDashboard(input, [], { query: 'missing' }).matchedTotal, 0);
});

test('groups use project IDs and include projects found only in saved tasks', () => {
  const result = buildAgentDashboard(sessions(task('one'), task('two', { project_id: 'b' })), [
    { id: 'empty', name: 'Empty project' },
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.projectOptions.length, 3);
  assert.deepEqual(ids(result), ['one', 'two']);
  const emptyProject = buildAgentDashboard({}, [{ id: 'empty', name: 'Empty project' }]);
  assert.equal(emptyProject.total, 0);
  assert.equal(emptyProject.groups.length, 0);
  assert.equal(emptyProject.projectOptions.length, 1);
});

test('attention comes first, followed by working tasks, with unread and recent work prioritized', () => {
  const input = sessions(
    task('done', { status: 'completed', updated_at: 100 }),
    task('new', { updated_at: 10 }),
    task('old'),
    task('unread', { unread: true }),
    task('working', { status: 'running' }),
    task('failed', { status: 'failed' }),
  );
  const before = JSON.stringify(input);
  assert.deepEqual(ids(buildAgentDashboard(input, [])), [
    'failed',
    'working',
    'unread',
    'new',
    'old',
    'done',
  ]);
  assert.equal(JSON.stringify(input), before);
});
