import { i18nView } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the actual component callbacks and capability gates with a minimal JSX host.
const exports = {};
const element = (type, props) => ({ type, props });
const compiled = ts.transpileModule(
  readFileSync(
    new URL('../../../packages/cockpit-ui/src/components/AgentModelControls.tsx', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
runInNewContext(compiled, {
  exports,
  require: (name) => {
    if (name === '../i18n') return i18nView;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react') return { useMemo: (create) => create() };
    if (name === '../lib/agentModelOptions')
      return {
        agentModelEfforts: () => [],
        agentModelOptions: () => [],
        customModelOption: () => null,
      };
    if (name === './SearchableSelect') return { SearchableSelect: 'SearchableSelect' };
    if (name === './AgentEffortPicker') return { AgentEffortPicker: 'AgentEffortPicker' };
    if (name === 'lucide-react') return {};
    throw new Error(`Unexpected import ${name}`);
  },
});
function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}
function controls(agents, state = { mode: 'default', agent: '' }, overrides = {}) {
  const tree = exports.AgentModelControls({
    catalog: {
      connection: 'acp',
      models: [],
      agents,
      modes: ['default', ...(agents.includes('plan') ? ['plan'] : [])],
    },
    loading: false,
    refresh: () => {},
    model: '',
    effort: '',
    ...state,
    onModel: () => {},
    onEffort: () => {},
    onMode: (mode) => {
      state.mode = mode;
      state.agent = '';
    },
    onAgent: (agent) => {
      state.agent = agent;
    },
    ...overrides,
  });
  return descendants(tree);
}

test('unconnected agents do not show a fabricated model picker or plan capability', () => {
  for (const loading of [false, true]) {
    const nodes = controls([], undefined, { catalog: null, loading });
    assert(!nodes.some((node) => node.type === 'SearchableSelect'));
    assert(!nodes.some((node) => node.props['aria-label'] === 'Plan mode'));
    assert(nodes.some((node) => node.props.role === 'status'));
  }
});

test('non-ACP agents expose Plan only after the catalog advertises it', () => {
  const nodes = controls([], undefined, {
    catalog: { connection: 'codex', models: [], agents: [], modes: ['default'] },
  });
  assert(nodes.some((node) => node.props['aria-label'] === 'Agent mode'));
  assert(!nodes.some((node) => node.props['aria-label'] === 'Plan mode'));
});

test('ACP only exposes Agent, Plan and Ask buttons actually advertised by the provider', () => {
  const labels = controls(['ask', 'review'])
    .filter((node) => node.type === 'button')
    .map((node) => node.props['aria-label']);
  assert(labels.includes('Ask mode'));
  assert(!labels.includes('Plan mode'));
  assert(!labels.includes('Agent mode'));
});

test('workflows reuse model controls without exposing a mode that could override the step role', () => {
  const nodes = controls(['agent', 'plan', 'ask'], undefined, {
    catalog: { connection: 'codex', models: [], agents: [], modes: ['default', 'plan'] },
    onMode: undefined,
    onAgent: undefined,
  });
  assert(nodes.some((node) => node.type === 'SearchableSelect' && node.props.label === 'Model'));
  assert(!nodes.some((node) => node.props['aria-label'] === 'Work mode'));
});

test('selecting a custom ACP mode survives the mode callback clearing the previous profile', () => {
  const state = { mode: 'plan', agent: 'plan' };
  const menu = controls(['agent', 'plan', 'review'], state).find(
    (node) => node.type === 'SearchableSelect' && node.props.label === 'Agent mode',
  );
  menu.props.onChange('review');
  assert.deepEqual(state, { mode: 'default', agent: 'review' });
});

test('native ACP mode controls keep plan semantics and the precise provider mode together', () => {
  for (const nativeMode of ['agent', 'plan', 'ask']) {
    const state = { mode: 'default', agent: 'review' };
    const label = `${nativeMode[0].toUpperCase()}${nativeMode.slice(1)} mode`;
    controls(['agent', 'plan', 'ask'], state)
      .find((node) => node.type === 'button' && node.props['aria-label'] === label)
      .props.onClick();
    assert.deepEqual(state, {
      mode: nativeMode === 'plan' ? 'plan' : 'default',
      agent: nativeMode,
    });
  }
});
