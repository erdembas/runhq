import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../../../packages/cockpit-ui/src/lib/agentDiscovery.ts', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports },
);
const { chooseAgentBackend, enabledAgentBackends, agentConnectionState, agentDetectionStatus } =
  exports;
const tool = (id, properties = {}) => ({
  id,
  name: id,
  adapter: id === 'cursor' ? 'acp' : id,
  enabled: true,
  available: true,
  executable: `/tools/${id}`,
  version: '1.0',
  error: null,
  ...properties,
});
const choose = (backends, properties = {}) =>
  chooseAgentBackend({
    backends,
    current: '',
    ready: true,
    userSelected: false,
    executable: '',
    locked: false,
    ...properties,
  });
const catalog = {
  models: [{ id: 'model-1', name: 'Model 1', efforts: [] }],
  modes: ['default'],
  agents: [],
  commands: [],
  can_steer: false,
};
const connection = (properties = {}) =>
  agentConnectionState({
    tool: tool('codex'),
    discoveryReady: true,
    discoveryError: null,
    executable: '',
    projectId: 'project',
    catalog,
    catalogError: null,
    ...properties,
  });

test('automatic selection prefers installed Codex, otherwise another truly available chat agent', () => {
  const missing = tool('cursor', {
    available: false,
    executable: null,
    detection_status: 'not_found',
  });
  assert.equal(choose([missing, tool('claude'), tool('codex')]), 'codex');
  assert.equal(choose([missing, tool('claude')]), 'claude');
  assert.equal(choose([missing]), '');
  assert.equal(
    choose([tool('codex', { enabled: false }), tool('shell', { adapter: 'terminal' }), missing]),
    '',
  );
  assert.equal(
    choose([tool('codex', { available: false, detection_status: 'blocked' }), tool('claude')]),
    'claude',
  );
  assert.equal(choose([tool('codex')], { ready: false }), '');
});

test('discovery changes preserve user selections, custom paths, launch retries and working defaults', () => {
  const backends = [tool('codex'), tool('claude')];
  assert.equal(choose(backends, { current: 'claude' }), 'claude');
  for (const properties of [
    { userSelected: true },
    { executable: '/custom/agent' },
    { locked: true },
    { ready: false },
  ])
    assert.equal(choose(backends, { current: 'cursor', ...properties }), 'cursor');
  assert.equal(choose(backends, { current: 'cursor' }), 'codex');
  assert.equal(choose([], { current: 'cursor', userSelected: true }), 'cursor');
});

test('provider order separates usable, blocked and missing tools without mutating detection results', () => {
  const tools = [
    tool('cursor', { available: false, executable: null }),
    tool('claude', { available: false }),
    tool('codex'),
    tool('off', { enabled: false }),
  ];
  assert.deepEqual(
    Array.from(enabledAgentBackends(tools), ({ id }) => id),
    ['codex', 'claude', 'cursor'],
  );
  assert.equal(tools[0].id, 'cursor');
  assert.equal(agentDetectionStatus(tools[0]), 'not_found');
  assert.equal(agentDetectionStatus(tools[1]), 'blocked');
});

test('connection state separates initial scan, failed scan, absent CLI and installed-but-blocked CLI', () => {
  const cases = [
    [{ discoveryReady: false, catalog: null }, 'checking'],
    [{ discoveryReady: true, discoveryError: 'Detection failed' }, 'discovery_error'],
    [{ tool: undefined }, 'no_agents'],
    [{ tool: tool('codex', { enabled: false }) }, 'disabled'],
    [
      {
        tool: tool('cursor', {
          available: false,
          executable: null,
          error: 'Install agent first',
          detection_status: 'not_found',
        }),
      },
      'not_found',
    ],
    [
      {
        tool: tool('cursor', {
          available: false,
          error: 'ACP is unsupported',
          detection_status: 'blocked',
        }),
      },
      'blocked',
    ],
    [{ projectId: '' }, 'project_required'],
  ];
  for (const [properties, stage] of cases) {
    const result = connection(properties);
    assert.equal(result.stage, stage);
    assert.equal(result.canStart, false, stage);
  }
  assert.equal(
    connection({ discoveryError: 'Exact detection failure' }).detail,
    'Exact detection failure',
  );
  assert.equal(
    connection({ tool: undefined, availableAgents: 1 }).title,
    'Choose an installed agent',
  );
});

test('catalog errors require connection recovery and authentication remains distinct from missing CLI', () => {
  const auth = connection({
    catalog: null,
    catalogError: 'Cursor authentication failed. Run agent login.',
  });
  assert.equal(auth.stage, 'authentication');
  assert.match(auth.detail, /agent login/);
  assert.equal(auth.canStart, false);
  assert.equal(
    connection({ catalog: null, catalogError: 'Model discovery timed out' }).stage,
    'catalog_error',
  );
  assert.equal(connection({ catalog: null }).stage, 'connecting');
  assert.equal(connection({ catalog: null }).canStart, false);
});

test('custom executable must connect successfully; an honestly empty catalog remains usable with provider default', () => {
  const missing = tool('cursor', {
    available: false,
    executable: null,
    detection_status: 'not_found',
  });
  const properties = { tool: missing, executable: '/custom/agent' };
  assert.equal(connection({ ...properties, catalog: null }).stage, 'connecting');
  assert.equal(connection({ ...properties, catalog: null }).canStart, false);
  assert.equal(
    connection({ ...properties, catalog: null, catalogError: 'No such file' }).canStart,
    false,
  );
  assert.equal(connection(properties).canStart, true);
  const empty = connection({ catalog: { ...catalog, models: [] } });
  assert.equal(empty.stage, 'ready');
  assert.equal(empty.canStart, true);
  assert.match(empty.detail, /configured model/);
});

test('a pinned model discovery failure can recover to default without bypassing CLI detection', () => {
  const failed = connection({
    model: 'unknown-model',
    catalog: null,
    catalogError: 'Model is not advertised',
  });
  assert.equal(failed.canUseDefaultModel, true);
  assert.equal(failed.canStart, false);
  const retryingDefault = connection({ model: '', catalog: null });
  assert.equal(retryingDefault.canUseDefaultModel, false);
  assert.equal(retryingDefault.canStart, false);
  assert.equal(connection({ model: '', catalog: { ...catalog, models: [] } }).canStart, true);
  assert.equal(
    connection({ model: 'known-model', catalogError: 'Authentication required' })
      .canUseDefaultModel,
    true,
  );
  assert.equal(
    connection({ model: '', catalogError: 'Connection refused' }).canUseDefaultModel,
    false,
  );
  assert.equal(
    connection({
      tool: tool('cursor', { available: false, executable: null }),
      model: 'unknown-model',
    }).canUseDefaultModel,
    false,
  );
});
