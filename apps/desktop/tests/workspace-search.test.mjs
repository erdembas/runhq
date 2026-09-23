import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function load(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports,
    require: (name) => {
      assert.equal(name, '@/lib/sectionColors');
      return load('apps/desktop/src/lib/sectionColors.ts');
    },
  });
  return exports;
}
const { filterSelectOptions } = load('packages/cockpit-ui/src/lib/selectSearch.ts');
const { agentProjectOptions } = load('apps/desktop/src/components/agents/agentProjectOptions.ts');
const { matchesWorkspaceSearch, serviceSearchText, stackMatchesSearch } = load(
  'apps/desktop/src/components/sidebar/sidebarSearch.ts',
);
const sections = [
  { id: 'b', name: 'Belgehub', color: 'green' },
  { id: 'f', name: 'Finsel', color: 'blue' },
];
const service = (id, name, cwd) => ({
  id,
  name,
  cwd,
  cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
  tags: ['node'],
});
const services = [
  service('a', 'backend', '/repos/api'),
  service('b', 'frontend', '/repos/web'),
  service('c', 'api-copy', '/repos/api-copy'),
];

test('project picker reflects section order and stack ownership while preserving duplicate names and unassigned projects', () => {
  const options = agentProjectOptions(
    [
      { id: 'p1', name: 'backend', path: '/repos/api/' },
      { id: 'p2', name: 'backend', path: '/repos/web' },
      { id: 'p3', name: 'independent', path: '/repos/api-copy' },
    ],
    services,
    [{ id: 'stack', service_ids: ['b'] }],
    sections,
    { a: 'f', c: 'deleted-section' },
    { stack: 'b' },
  );
  assert.deepEqual(
    Array.from(options, (option) => option.value),
    ['p2', 'p1', 'p3'],
  );
  assert.equal(options[0].group, 'Belgehub');
  assert.equal(options[1].color, '#3b82f6');
  assert.equal(options[2].group, 'Other projects');
  assert.equal(options[0].description, '/repos/web');
});

test('picker searches name, group and path together without changing source order', () => {
  const options = [
    { value: '1', label: 'Backend', group: 'Belgehub', description: '/repos/api' },
    { value: '2', label: 'Backend', group: 'Finsel', description: '/repos/web' },
  ];
  assert.equal(filterSelectOptions(options, ' BELGEHUB api ')[0].value, '1');
  assert.equal(filterSelectOptions(options, 'web')[0].value, '2');
  assert.equal(filterSelectOptions(options, 'missing').length, 0);
  assert.equal(filterSelectOptions(options, '').length, 2);
  assert.equal(options.length, 2);
});

test('workspace search finds services by group, directory, tags and command', () => {
  const text = serviceSearchText(services[0], sections, 'b');
  assert(matchesWorkspaceSearch('belgehub node', text));
  assert(matchesWorkspaceSearch('/repos/api pnpm', text));
  assert(!matchesWorkspaceSearch('finsel', text));
  assert(matchesWorkspaceSearch(' ', text));
});

test('stack search includes member services and group but excludes unrelated services', () => {
  const stack = { id: 'stack', name: 'Web stack', service_ids: ['b'] };
  assert(stackMatchesSearch(stack, 'web stack', services, sections, 'b'));
  assert(stackMatchesSearch(stack, 'belgehub frontend', services, sections, 'b'));
  assert(!stackMatchesSearch(stack, 'backend', services, sections, 'b'));
});

const { agentModelOptions } = load('packages/cockpit-ui/src/lib/agentModelOptions.ts');
test('large model catalogs group provider labels without changing runtime IDs or hiding models', () => {
  const models = Array.from({ length: 360 }, (_, index) => ({
    id: `${index % 2 ? 'bedrock' : 'zai'}/model-${index}`,
    name: `${index % 2 ? 'Amazon Bedrock' : 'Z.AI Coding Plan'} · Model ${index}`,
    efforts: [],
  }));
  const options = agentModelOptions(models, 'bedrock/model-359');
  assert.equal(options.length, 361);
  assert.equal(new Set(options.map((option) => option.value)).size, 361);
  assert.equal(options[1].group, 'Z.AI Coding Plan');
  assert.equal(options[1].label, 'Model 0');
  assert.equal(options[181].group, 'Amazon Bedrock');
  const result = filterSelectOptions(options, 'bedrock model-359');
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 'bedrock/model-359');
});

test('standalone and custom models remain selectable and repeated catalog IDs are deduplicated', () => {
  const model = { id: 'native-model', name: 'Native model', efforts: [] };
  const options = agentModelOptions([model, model], 'custom-provider/model-x');
  assert.equal(options.length, 3);
  assert.equal(options[1].value, 'custom-provider/model-x');
  assert.equal(options[2].label, 'Native model');
  assert.equal(options[2].group, undefined);
});

test('model versions use provider metadata and retain the matching effort capabilities', () => {
  const { agentModelEfforts, customModelOption } = load(
    'packages/cockpit-ui/src/lib/agentModelOptions.ts',
  );
  const models = [
    {
      id: 'opus',
      name: 'Opus',
      description: 'Opus version from provider',
      resolved_model: 'claude-opus-test',
      is_alias: true,
      efforts: ['high'],
    },
  ];
  const options = agentModelOptions(models, '');
  assert.equal(options.find((o) => o.value === 'opus').badge, 'Auto');
  assert.equal(options.find((o) => o.value === 'claude-opus-test').badge, 'Version');
  assert.equal(filterSelectOptions(options, 'version provider').length, 2);
  assert.equal(agentModelEfforts(models, 'claude-opus-test')[0], 'high');
  assert.equal(
    agentModelOptions(models, 'claude-opus-test').filter((o) => o.value === 'claude-opus-test')
      .length,
    1,
  );
  assert.equal(
    customModelOption('  arn:provider/model-version  ').value,
    'arn:provider/model-version',
  );
  assert.equal(customModelOption(''), null);
  assert.equal(customModelOption('opus version'), null);
  const legacy = agentModelOptions(
    [{ id: 'opus', name: 'Opus', description: 'Opus 4.7', efforts: [], is_alias: true }],
    '',
  );
  assert.equal(legacy.length, 2, 'Do not invent exact IDs from a human-readable description');
  assert.equal(filterSelectOptions(legacy, '4.7')[0].value, 'opus');
});

test('reasoning bars order only supported effort levels and keep provider variant IDs intact', () => {
  const { agentEffortLevels, effortLabel } = load('packages/cockpit-ui/src/lib/agentEffort.ts');
  const input = ['high', 'low', 'xhigh', 'high'];
  const result = agentEffortLevels(input);
  assert.equal(result.ordered, true);
  assert.equal(Array.from(result.levels).join(','), 'low,high,xhigh');
  assert.deepEqual(input, ['high', 'low', 'xhigh', 'high']);
  assert.equal(result.levels.includes('medium'), false);
  const variants = agentEffortLevels(['thinking', 'fast', 'high']);
  assert.equal(variants.ordered, false);
  assert.equal(Array.from(variants.levels).join(','), 'thinking,fast,high');
  assert.equal(agentEffortLevels([]).ordered, false);
  assert.equal(effortLabel('xhigh'), 'Extra high');
  assert.equal(effortLabel(''), 'Auto');
  assert.equal(effortLabel('provider-value'), 'provider-value');
});
