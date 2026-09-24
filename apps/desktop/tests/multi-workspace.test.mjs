import { URL } from 'node:url';
import { TextEncoder, TextDecoder } from 'node:util';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

function load(file, imports = {}, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      TextEncoder,
      TextDecoder,
      ...globals,
      require: (name) => {
        if (name in imports) return imports[name];
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return exports;
}
const changes = load('../src/components/agents/agentChanges.ts');
const model = load('../src/components/workspaces/workspaceModel.ts', {
  '@/components/agents/agentChanges': changes,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test('run groups reject stale membership and commands without widening their selection', () => {
  const project = {
    id: 'workspace',
    workspace: {
      members: [
        { service_id: 'a', path: '/a' },
        { service_id: 'b', path: '/b' },
      ],
    },
  };
  const services = [
    { id: 'a', cwd: '/a', cmds: [{ name: 'dev' }, { name: 'test' }] },
    { id: 'b', cwd: '/b', cmds: [{ name: 'serve' }] },
  ];
  const stack = {
    id: model.workspaceStackId(project.id),
    service_ids: ['a'],
    command_names: { a: ['dev'] },
  };
  assert.equal(model.workspaceRunPlanValid(project, stack, services), true);
  assert.equal(
    model.workspaceRunPlanValid(project, { ...stack, command_names: { a: ['removed'] } }, services),
    false,
  );
  assert.equal(
    model.workspaceRunPlanValid(project, { ...stack, service_ids: ['outside'] }, services),
    false,
  );
  assert.equal(
    model.workspaceRunPlanValid(project, { ...stack, command_names: { a: [] } }, services),
    false,
  );
  // Canonical path validation belongs to the backend: symlink aliases are legitimate here.
  assert.equal(
    model.workspaceRunPlanValid(project, stack, [{ ...services[0], cwd: '/alias' }]),
    true,
  );
  assert.deepEqual(stack.command_names.a, ['dev']);
});

test('summary counts actual diff files and leaves unknown test outcomes as provider evidence', () => {
  const diff =
    'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+added\n';
  assert.deepEqual(plain(model.workspaceChangeTotals(diff)), {
    files: 1,
    additions: 2,
    deletions: 1,
  });
  const evidence = model.workspaceCheckEvidence([
    { id: 'request', kind: 'user', text: 'Run tests' },
    { id: 'claim', kind: 'assistant', text: 'All tests pass' },
    { id: 'command', kind: 'tool', title: 'pnpm test', text: 'One failed test', status: 'failed' },
  ]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].status, 'failed');
});

test('task project choices survive remount, stay scoped to each workspace and never re-add removed projects', () => {
  const saved = new Map();
  let state = [],
    cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (value) => (state[index] = typeof value === 'function' ? value(state[index]) : value),
      ];
    },
  };
  const window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
  const persistence = load('../src/lib/agentRecoveryPersistence.ts', {}, { window });
  const { useWorkspaceTaskMembers } = load(
    '../src/components/workspaces/useWorkspaceTaskMembers.ts',
    { react, '@/lib/agentRecoveryPersistence': persistence },
    { window },
  );
  const workspace = { id: 'w', workspace: { members: [{ service_id: 'a' }, { service_id: 'b' }] } };
  const render = (project) => {
    cursor = 0;
    return useWorkspaceTaskMembers(project);
  };
  assert.deepEqual(plain(render(workspace).selected), ['a', 'b']);
  render(workspace).toggle('b');
  assert.deepEqual(plain(render(workspace).selected), ['a']);
  state = [];
  assert.deepEqual(plain(render(workspace).selected), ['a']);
  assert.deepEqual(plain(render({ ...workspace, id: 'other' }).selected), ['a', 'b']);
  assert.deepEqual(
    plain(render({ ...workspace, workspace: { members: [{ service_id: 'b' }] } }).selected),
    [],
  );
  window.localStorage.setItem = () => {
    throw new Error('disk full');
  };
  render(workspace).toggle('b');
  assert(render(workspace).error);
});
