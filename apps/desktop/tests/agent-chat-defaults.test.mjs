import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext, i18n } from './helpers/i18n-vm.mjs';

const key = 'preferences:new-agent-chat';
const preferred = {
  backend: 'claude',
  model: 'saved-model',
  effort: 'high',
  mode: 'plan',
  agent: 'reviewer',
  executable: '/custom/claude',
  isolated: true,
};
const plain = (value) => JSON.parse(JSON.stringify(value));
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [
    node,
    ...nodes(node.props?.children),
    ...nodes(node.props?.controls),
    ...nodes(node.props?.action),
  ];
}

function harness(initial = preferred) {
  let hooks;
  let cursor;
  let effects;
  let changed;
  const react = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks[index],
        (value) => {
          const next = typeof value === 'function' ? value(hooks[index]) : value;
          if (!Object.is(next, hooks[index])) changed = true;
          hooks[index] = next;
        },
      ];
    },
    useRef: (current) => {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => !Object.is(dep, hooks[index][i]))) {
        hooks[index] = deps;
        effects.push(effect);
      }
    },
    useMemo: (factory) => factory(),
  };
  const disk = initial ? { [key]: { key, value: initial } } : {};
  const library = {
    records: globalThis.structuredClone(disk),
    ready: true,
    error: null,
    refresh: async () => {
      if (h.loadFails) {
        library.error = 'offline';
        return;
      }
      library.records = globalThis.structuredClone(disk);
      library.ready = true;
      library.error = null;
    },
    save: async (recordKey, value) => {
      if (h.saveFails) throw new Error('disk full');
      disk[recordKey] = { key: recordKey, value: plain(value) };
      library.records = globalThis.structuredClone(disk);
    },
  };
  const project = { id: 'project', name: 'Project', path: '/project' };
  const store = {
    projects: [project],
    projectFilter: '',
    drafts: { 'new-task:project': 'My draft' },
    sessions: {},
    tools: ['codex', 'claude', 'cursor'].map((id) => ({
      id,
      name: id,
      enabled: true,
      available: true,
      adapter: id === 'cursor' ? 'acp' : id,
    })),
    setDraft: (id, text) => {
      store.drafts[id] = text;
    },
    merge: () => {},
    retryDraftPersistence: () => {},
    select: () => {},
  };
  const launcher = {
    recovery: null,
    restore: () => {},
    complete: () => {},
    send: async (input) => {
      h.sent.push(plain(input));
      return { id: 'new', backend: input.backend };
    },
  };
  const context = { ready: true, entries: [], clear: async () => {} };
  const bind = (state) => Object.assign((selector) => selector(state), { getState: () => state });
  const ui = new Proxy({}, { get: (_, name) => name });
  const locals = {
    '@/store/useAgentLibraryStore': { useAgentLibraryStore: bind(library) },
    '@/store/useAgentStore': { useAgentStore: bind(store) },
    '@/store/useAppStore': { useAppStore: { getState: () => ({ openSettings: () => {} }) } },
    '@/lib/useVisibleStore': { useVisibleStore: (store, select) => select(store.getState()) },
    '@/lib/ipc': { ipc: {} },
    './useAgentDiscovery': { useAgentDiscovery: () => ({ ready: true, loading: false }) },
    './useAgentProjectOptions': { useAgentProjectOptions: () => [] },
    './useAgentContext': { useAgentContext: () => context },
    './agentTaskLauncher': { createAgentTaskLauncher: () => launcher },
    './agentLibraryModel': {
      buildAgentContextPrompt: (input) => input,
      agentContextImages: () => [],
    },
    './agentWorkflowLaunch': { workflowLaunchCandidates: () => [] },
    '@/components/ai/chat-panel/useAiCliProject': {
      useAiCliProject: () => ({ catalogProjectId: 'project' }),
    },
    './SettingsView': { SettingsSection: 'SettingsSection' },
  };
  const catalog = {
    models: [{ id: 'saved-model', name: 'Saved model', efforts: ['low', 'high'] }],
    modes: ['default', 'plan'],
    agents: ['reviewer'],
    commands: [],
    connection: 'codex',
  };
  const catalogHook = {
    useAgentCatalog: (...args) => {
      h.catalogCalls.push(args);
      return { catalog, loading: false, error: null, refresh: () => {} };
    },
  };
  locals['./useAgentCatalog'] = catalogHook;
  locals['@/components/agents/useAgentCatalog'] = catalogHook;
  locals['@/components/agents/useAgentDiscovery'] = locals['./useAgentDiscovery'];
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        require: (name) => {
          if (name === '@/components/workspaces/useWorkspaceTaskMembers')
            return load('../src/components/workspaces/useWorkspaceTaskMembers.ts');
          if (name === '@/lib/agentRecoveryPersistence')
            return load('../src/lib/agentRecoveryPersistence.ts');
          if (name === 'react') return react;
          if (name === 'react/jsx-runtime')
            return {
              jsx: (type, props) => ({ type, props }),
              jsxs: (type, props) => ({ type, props }),
            };
          if (name === '@runhq/cockpit-ui')
            return new Proxy(ui, { get: (_, name) => discovery[name] ?? ui[name] });
          if (locals[name]) return locals[name];
          if (name === '@/lib/useMessageSendShortcut')
            return load('../src/lib/useMessageSendShortcut.ts');
          if (name === '@/store/useShellUiStore')
            return { useShellUiStore: (select) => select({ viewShortcuts: null }) };
          if (name.endsWith('/agentChatDefaults'))
            return load('../src/components/agents/agentChatDefaults.ts');
          if (name.endsWith('/aiGenerationSettings'))
            return load('../src/lib/ai/aiGenerationSettings.ts');
          return {};
        },
      },
    );
    return exports;
  }
  const discovery = load('../../../packages/cockpit-ui/src/lib/agentDiscovery.ts');
  function host(component, props = {}) {
    const state = [];
    return {
      render: () => {
        let result;
        let count = 0;
        do {
          hooks = state;
          cursor = 0;
          effects = [];
          changed = false;
          result = component(props);
          for (const effect of effects) effect();
          assert(++count < 15, 'render loop');
        } while (changed);
        return result;
      },
    };
  }
  function composer(props = {}) {
    const wrapper = host(load('../src/components/agents/AgentNewSession.tsx').AgentNewSession, {
      onClose: () => {},
      ...props,
    });
    const child = wrapper.render();
    assert.equal(typeof child.type, 'function');
    const mutableProps = { ...child.props };
    const instance = host(child.type, mutableProps);
    return {
      render: () => {
        Object.assign(mutableProps, wrapper.render().props);
        return instance.render();
      },
    };
  }
  const h = {
    load,
    host,
    composer,
    store,
    library,
    disk,
    launcher,
    catalogCalls: [],
    sent: [],
    saveFails: false,
    loadFails: false,
  };
  return h;
}
const control = (tree, type) => nodes(tree).find((node) => node.type === type)?.props;
const button = (tree, label) =>
  nodes(tree).find((node) => node.type === 'button' && node.props.children === label)?.props;

test('missing or malformed defaults retain automatic selection and strip unbound provider options', () => {
  const { agentChatDefaults: parse } = harness().load(
    '../src/components/agents/agentChatDefaults.ts',
  );
  for (const value of [null, false, [], { backend: 12, isolated: 'yes', mode: 'plan' }]) {
    assert.equal(parse(value).backend, '');
    assert.equal(parse(value).mode, 'default');
    assert.equal(parse(value).isolated, false);
  }
  assert.deepEqual(plain(parse({ ...preferred, backend: '' })), {
    backend: '',
    model: '',
    effort: '',
    mode: 'default',
    agent: '',
    executable: '',
    isolated: true,
  });
});

test('new chats start with saved options and send them to the task launcher', async () => {
  const h = harness();
  const chat = h.composer();
  const tree = chat.render();
  assert.equal(control(tree, 'AgentProviderPicker').value, 'claude');
  const options = control(tree, 'AgentModelControls');
  for (const field of ['model', 'effort', 'mode', 'agent'])
    assert.equal(options[field], preferred[field]);
  control(tree, 'AgentComposer').onSend();
  assert.deepEqual(h.sent[0], { project_id: 'project', ...preferred, title: '' });
});

test('preference updates and language changes preserve an open composer; new chats take new defaults', () => {
  const h = harness();
  const chat = h.composer();
  control(chat.render(), 'AgentModelControls').onModel('draft-model');
  h.library.records[key] = { key, value: { backend: 'codex', model: 'next-model' } };
  i18n.setLocale('tr');
  try {
    const tree = chat.render();
    assert.equal(control(tree, 'AgentProviderPicker').value, 'claude');
    assert.equal(control(tree, 'AgentModelControls').model, 'draft-model');
    assert.equal(control(tree, 'AgentComposer').value, 'My draft');
    const next = h.composer().render();
    assert.equal(control(next, 'AgentProviderPicker').value, 'codex');
    assert.equal(control(next, 'AgentModelControls').model, 'next-model');
  } finally {
    i18n.setLocale('en');
  }
});

test('saved unavailable agents remain selected and cannot send through another provider', () => {
  for (const tools of [[], [{ id: 'claude', enabled: false, available: true }]]) {
    const h = harness();
    h.store.tools = [{ id: 'codex', enabled: true, available: true }, ...tools];
    const tree = h.composer().render();
    assert.equal(control(tree, 'AgentProviderPicker').value, 'claude');
    control(tree, 'AgentComposer').onSend();
    assert.equal(h.sent.length, 0);
  }
});

test('recipes and recovered launches retain their own choices; automatic selection still prefers Codex', () => {
  const h = harness();
  const recipe = {
    name: 'Recipe',
    prompt: 'Recipe prompt',
    backend: 'cursor',
    model: '',
    effort: '',
    mode: 'default',
    agent: 'ask',
    isolated: false,
  };
  const recipeTree = h.composer({ initialRecipe: recipe }).render();
  assert.equal(control(recipeTree, 'AgentProviderPicker').value, 'cursor');
  assert.equal(control(recipeTree, 'AgentModelControls').model, '');
  assert.equal(h.catalogCalls.at(-1)[1], '');
  h.launcher.recovery = {
    creationRequestId: 'saved',
    input: { ...preferred, backend: 'cursor', model: 'recovery-model', mode: 'default' },
    draftText: 'saved draft',
  };
  const recoveryTree = h.composer().render();
  assert.equal(control(recoveryTree, 'AgentProviderPicker').value, 'cursor');
  assert.equal(control(recoveryTree, 'AgentComposer').value, 'saved draft');
  assert.equal(h.catalogCalls.at(-1)[5], 'recovery-model');
  const empty = harness(null);
  assert.equal(control(empty.composer().render(), 'AgentProviderPicker').value, 'codex');
});

test('composer waits for hydration and offers retry on load errors', async () => {
  const h = harness();
  h.library.ready = false;
  h.loadFails = true;
  const wrapper = h.host(
    h.load('../src/components/agents/AgentNewSession.tsx').AgentNewSession,
    {},
  );
  assert.equal(wrapper.render().props.role, 'status');
  const failed = wrapper.render();
  assert.equal(failed.props.role, 'alert');
  assert(button(failed, 'Retry'));
  h.loadFails = false;
  button(failed, 'Retry').onClick();
  assert.equal(typeof wrapper.render().type, 'function');
});

test('settings save all options, survive reload, and compose ACP callbacks without losing the mode', async () => {
  const h = harness();
  const Settings = h.load(
    '../src/components/settings/AgentChatDefaultSettings.tsx',
  ).AgentChatDefaultSettings;
  const settings = h.host(Settings);
  control(settings.render(), 'SearchableSelect').onChange('cursor');
  let controls = control(settings.render(), 'AgentModelControls');
  controls.onModel('cursor-model');
  controls = control(settings.render(), 'AgentModelControls');
  controls.onEffort('high');
  controls.onMode('plan');
  controls.onAgent('plan');
  assert.equal(h.disk[key].value.backend, 'claude');
  await button(settings.render(), 'Save').onClick();
  assert.equal(h.disk[key].value.model, 'cursor-model');
  assert.equal(h.disk[key].value.effort, 'high');
  assert.equal(h.disk[key].value.agent, 'plan');
  assert.equal(h.disk[key].value.mode, 'plan');
  assert.equal(h.disk[key].value.isolated, true);
  assert.equal(h.disk[key].value.executable, '');
  const reopened = h.host(Settings).render();
  assert.equal(control(reopened, 'SearchableSelect').value, 'cursor');
  assert.equal(control(reopened, 'AgentModelControls').model, 'cursor-model');
});

test('failed saves keep old defaults and the editable draft; reset is explicit and persisted', async () => {
  const h = harness();
  const settings = h.host(
    h.load('../src/components/settings/AgentChatDefaultSettings.tsx').AgentChatDefaultSettings,
  );
  control(settings.render(), 'AgentModelControls').onModel('new-model');
  h.saveFails = true;
  await button(settings.render(), 'Save').onClick();
  assert.equal(h.disk[key].value.model, 'saved-model');
  assert.equal(control(settings.render(), 'AgentModelControls').model, 'new-model');
  assert(nodes(settings.render()).some((node) => node.props?.role === 'alert'));
  h.saveFails = false;
  button(settings.render(), 'Use defaults').onClick();
  assert.equal(h.disk[key].value.model, 'saved-model');
  await button(settings.render(), 'Save').onClick();
  assert.equal(h.disk[key].value.backend, '');
  assert.equal(h.disk[key].value.isolated, false);
});
