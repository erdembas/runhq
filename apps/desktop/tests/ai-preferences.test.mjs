import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import { TextEncoder } from 'node:util';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

function harness() {
  const storage = new Map();
  const cache = new Map();
  const events = [];
  const listeners = new Map();
  const locals = {};
  const react = {
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (current) => ({ current }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        TextEncoder,
        crypto: { randomUUID },
        AbortController: globalThis.AbortController,
        localStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        },
        Event: class {
          constructor(type) {
            this.type = type;
          }
        },
        window: {
          dispatchEvent: (event) => {
            events.push(event.type);
            for (const listener of listeners.get(event.type) ?? []) listener(event);
          },
          addEventListener: (type, listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
          },
          removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
          setTimeout: () => {},
        },
        require: (name) => {
          if (name === 'react') return react;
          if (name === 'react/jsx-runtime')
            return {
              jsx: (type, props) => ({ type, props }),
              jsxs: (type, props) => ({ type, props }),
            };
          if (name === '@runhq/cockpit-ui')
            return { AgentRequestCard: () => {}, AgentModelControls: 'AgentModelControls' };
          if (locals[name]) return locals[name];
          if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
          if (name.startsWith('.'))
            return load(`${path.slice(0, path.lastIndexOf('/'))}/${name}.ts`);
          throw new Error(name);
        },
      },
    );
    return exports;
  }
  return { load, storage, events, locals, react };
}
const api = { id: 'api', name: 'Local API', model: 'base-model', default: true };
const cli = {
  id: 'cli:codex',
  name: 'Codex',
  model: '',
  cli: { id: 'codex', adapter: 'codex', available: true, executable: '/bin/codex' },
};
const providers = [api, cli];

test('saved routes survive reload, inherit a default, and keep API and CLI models independent', () => {
  const h = harness();
  const p = h.load('lib/ai/aiPreferences.ts');
  p.saveAiSelection('default', { providerId: api.id, model: 'shared' });
  p.saveAiSelection('commit', { providerId: cli.id, model: 'commit-model' });
  p.saveAiSelection('diff', { providerId: api.id, model: 'diff-model' });
  const persisted = p.readAiPreferences();
  assert.equal(p.configuredAiProvider(providers, 'commit', persisted).model, 'commit-model');
  assert.equal(p.configuredAiProvider(providers, 'diff', persisted).model, 'diff-model');
  assert.equal(p.configuredAiProvider(providers, 'free', persisted).model, 'shared');
  assert.equal(p.configuredAiProvider(providers, 'standup', persisted).id, api.id);
  assert.equal(api.model, 'base-model');
  assert.equal(cli.model, '');
  assert.equal(h.events.length, 3);
  p.saveAiSelection('commit', null);
  assert.equal(p.configuredAiProvider(providers, 'commit').model, 'shared');
  p.saveAiSelection('diff', { providerId: api.id, model: '' });
  assert.equal(p.configuredAiProvider(providers, 'diff').model, 'base-model');
});

test('all use cases resolve their own selection; missing or unavailable explicit choices never fall back', () => {
  const h = harness();
  const p = h.load('lib/ai/aiPreferences.ts');
  for (const origin of p.aiUseCases.filter((entry) => entry !== 'default')) {
    assert.equal(
      p.configuredAiProvider(providers, origin, { [origin]: { providerId: api.id, model: origin } })
        .model,
      origin,
    );
    assert.throws(
      () =>
        p.configuredAiProvider(providers, origin, {
          default: { providerId: api.id },
          [origin]: { providerId: 'deleted' },
        }),
      /unavailable/,
    );
  }
  assert.throws(
    () =>
      p.configuredAiProvider([{ ...cli, cli: { ...cli.cli, available: false } }, api], 'commit', {
        commit: { providerId: cli.id },
      }),
    /unavailable/,
  );
  assert.equal(p.configuredAiProvider(providers, 'free', {}), null);
});

test('corrupt preferences are ignored and clearing a route restores inheritance', () => {
  const h = harness();
  const p = h.load('lib/ai/aiPreferences.ts');
  h.storage.set(p.aiPreferencesKey, 'broken');
  assert.deepEqual(Object.keys(p.readAiPreferences()), []);
  h.storage.set(
    p.aiPreferencesKey,
    JSON.stringify({
      default: { providerId: api.id, model: 12 },
      commit: { providerId: 4 },
      unknown: { providerId: api.id },
    }),
  );
  assert.equal(p.readAiPreferences().default.model, '');
  assert.equal(p.readAiPreferences().commit, undefined);
  p.saveAiSelection('default', null);
  assert.equal(p.configuredAiProvider(providers, 'free'), null);
});

test('commit extraction drops reasoning and wrappers and rejects unfinished tagged answers', () => {
  const { extractCommitMessage } = harness().load('lib/ai/commitMessage.ts');
  assert.equal(
    extractCommitMessage('Thinking\n<commit>feat: add routes\n\nKeep models independent.</commit>'),
    'feat: add routes\n\nKeep models independent.',
  );
  assert.equal(
    extractCommitMessage('<think>reasoning</think>\n```text\nfix: route models\n```'),
    'fix: route models',
  );
  assert.equal(extractCommitMessage('<commit>unfinished'), '');
});

function commitHarness(provider) {
  const h = harness();
  const calls = [];
  const session = { id: 'session', status: 'completed', pending: [] };
  const panel = { message: 'focus on routing', generating: false };
  const ipc = {
    aiGenerateCommitMessage: async (input) => {
      calls.push(['api', input]);
      return { message: 'feat: route models', model: input.model };
    },
    aiCommitChatContext: async (input) => {
      calls.push(['context', input]);
      return { diff: '+routing', messages: [{ role: 'user', content: 'Staged diff: +routing' }] };
    },
    agentAddProject: async () => ({ id: 'project' }),
    agentCreate: async (input) => {
      calls.push(['create', input]);
      return session;
    },
    agentStart: async (input) => {
      calls.push(['start', input]);
      return session;
    },
    agentSnapshot: async () => ({
      session,
      items: [{ id: 'a', kind: 'assistant', text: '<commit>feat: route models</commit>' }],
      before: null,
    }),
    agentInterrupt: async () => {},
    agentUpdate: async () => session,
  };
  h.locals['@/lib/ipc'] = { ipc };
  h.locals['@/store/useAppStore'] = {
    useAppStore: {
      getState: () => ({ services: [{ id: 'service', name: 'Example', cwd: '/tmp/example' }] }),
    },
  };
  h.locals['@/lib/ai/loadAiProviders'] = { loadAiProviders: async () => providers };
  const hook = h.load('components/git/commit-panel/useCommitMessageGenerator.tsx');
  const args = {
    serviceId: 'service',
    panel,
    patch: (patch) => Object.assign(panel, typeof patch === 'function' ? patch(panel) : patch),
    stagedCount: 1,
    messageRef: { current: null },
  };
  return {
    ...h,
    calls,
    ipc,
    panel,
    run: () => hook.useCommitMessageGenerator(args).runGenerate(provider),
    generate: () => hook.useCommitMessageGenerator(args).generateMessage(),
  };
}

test('commit API generation passes the use-case model without updating provider configuration', async () => {
  const h = commitHarness({ ...api, model: 'commit-api-model' });
  await h.run();
  assert.equal(h.calls[0][1].model, 'commit-api-model');
  assert.equal(h.calls[0][1].hint, 'focus on routing');
  assert.equal(h.panel.message, 'feat: route models');
  assert.equal(h.panel.generating, false);
});

test('commit CLI generation uses the selected model at creation and start, preserving the staged context', async () => {
  const h = commitHarness({
    ...cli,
    model: 'commit-cli-model',
    effort: 'high',
    mode: 'plan',
    agent: 'reviewer',
  });
  await h.run();
  assert.equal(h.calls.find(([kind]) => kind === 'create')[1].model, 'commit-cli-model');
  const start = h.calls.find(([kind]) => kind === 'start')[1];
  assert.equal(start.model, 'commit-cli-model');
  assert.equal(start.effort, 'high');
  assert.equal(start.agent, 'reviewer');
  const create = h.calls.find(([kind]) => kind === 'create')[1];
  assert.equal(create.effort, 'high');
  assert.equal(create.agent, 'reviewer');
  assert.equal(start.mode, 'plan');
  assert.match(start.prompt, /Staged diff/);
  assert.equal(h.panel.message, 'feat: route models');
  assert.equal(h.panel.error, null);
});

test('commit generation preserves a draft edited while the response is in flight', async () => {
  const h = commitHarness(api);
  let finish;
  h.ipc.aiGenerateCommitMessage = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = h.run();
  h.panel.message = 'my revised draft';
  finish({ message: 'generated answer' });
  await pending;
  assert.equal(h.panel.message, 'my revised draft');
});

test('commit generation reports an unavailable configured provider without making a request', async () => {
  const h = commitHarness(api);
  const preferences = h.load('lib/ai/aiPreferences.ts');
  preferences.saveAiSelection('commit', { providerId: 'missing', model: '' });
  await h.generate();
  assert.match(h.panel.error, /unavailable/);
  assert.equal(h.calls.length, 0);
});

test('switching chats keeps each use case provider/model and the free chat choice independent', () => {
  const h = harness();
  let cursor = 0;
  const states = [];
  h.react.useState = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      states[index],
      (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      },
    ];
  };
  const appState = { activeConversationId: null, selectedServiceId: null };
  h.locals['@/store/useAppStore'] = { useAppStore: (select) => select(appState) };
  const { useAiChatState } = h.load('components/ai/chat-panel/useAiChatState.ts');
  const render = () => {
    cursor = 0;
    return useAiChatState();
  };
  let state = render();
  state.setProvider({ ...api, model: 'free-model' });
  appState.activeConversationId = 'diff-chat';
  state = render();
  assert.equal(state.provider, null);
  state.setProvider({ ...cli, model: 'diff-model' });
  appState.activeConversationId = 'log-chat';
  state = render();
  state.setProvider({ ...api, model: 'log-model' });
  appState.activeConversationId = 'diff-chat';
  assert.equal(render().provider.model, 'diff-model');
  appState.activeConversationId = null;
  assert.equal(render().provider.model, 'free-model');
});

test('automatic stream recovery retains the request provider/model after a tab or provider switch', () => {
  const h = harness();
  const { handleStreamError } = h.load('components/ai/chat-panel/streamHandlers.ts');
  const chosen = { ...api, model: 'diff-model' };
  const retries = [];
  handleStreamError({
    appendOnly: false,
    chunkMessage: 'timeout',
    history: [],
    inFlightConvsRef: { current: new Set(['conversation']) },
    persistAssistantTurnRef: { current: null },
    retryAttempt: 0,
    runStreamRef: { current: (request) => retries.push(request) },
    providerOverride: chosen,
    setTurnsForConv: (_id, update) =>
      update([
        {
          id: 'answer',
          content: 'Partial response with enough content to trigger a continuation.',
        },
      ]),
    targetConvId: 'conversation',
    targetTurnId: 'answer',
  });
  assert.equal(retries.length, 1);
  assert.equal(retries[0].providerOverride, chosen);
});

test('surface triggers hand off the configured use-case model without replacing the global default', async () => {
  const h = harness();
  const sent = [];
  h.locals['@/store/useAppStore'] = {
    useAppStore: (select) => select({ openAiChat: async (payload) => sent.push(payload) }),
  };
  h.locals['@/lib/ai/loadAiProviders'] = { loadAiProviders: async () => providers };
  h.locals['./ModelChooserPopover'] = { ModelChooserPopover: () => {} };
  const preferences = h.load('lib/ai/aiPreferences.ts');
  preferences.saveAiSelection('default', { providerId: api.id, model: 'shared' });
  preferences.saveAiSelection('diff', {
    providerId: cli.id,
    model: 'review-model',
    effort: 'xhigh',
    mode: 'plan',
    agent: 'reviewer',
  });
  const { useAiSurfaceTrigger } = h.load('components/ai/useAiSurfaceTrigger.tsx');
  let builds = 0;
  const trigger = useAiSurfaceTrigger({
    buildPayload: () => {
      builds++;
      return { origin: 'diff', title: 'Review changes', draftPrompt: 'Explain these changes' };
    },
  });
  await trigger.onClick();
  assert.equal(builds, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].forcedProviderId, cli.id);
  assert.equal(sent[0].forcedModel, 'review-model');
  assert.equal(sent[0].forcedSettings.effort, 'xhigh');
  assert.equal(sent[0].forcedSettings.mode, 'plan');
  assert.equal(sent[0].forcedSettings.agent, 'reviewer');
  assert.equal(sent[0].autoSend, true);
  assert.equal(preferences.readAiPreferences().default.model, 'shared');
});

test('use-case options persist independently, inherit together, and migrate old model-only preferences', () => {
  const h = harness();
  const p = h.load('lib/ai/aiPreferences.ts');
  h.storage.set(
    p.aiPreferencesKey,
    JSON.stringify({ commit: { providerId: cli.id, model: 'legacy' } }),
  );
  assert.equal(p.configuredAiProvider(providers, 'commit').model, 'legacy');
  assert.equal(p.configuredAiProvider(providers, 'commit').mode, undefined);
  p.saveAiSelection('default', {
    providerId: cli.id,
    model: 'base',
    effort: 'high',
    mode: 'plan',
    agent: 'reviewer',
  });
  p.saveAiSelection('commit', {
    providerId: cli.id,
    model: 'fast',
    effort: 'low',
    mode: 'default',
    agent: 'build',
  });
  const inherited = p.configuredAiProvider(providers, 'log');
  assert.equal(inherited.effort, 'high');
  assert.equal(inherited.mode, 'plan');
  assert.equal(inherited.agent, 'reviewer');
  const commit = p.configuredAiProvider(providers, 'commit');
  assert.equal(commit.effort, 'low');
  assert.equal(commit.mode, 'default');
  assert.equal(commit.agent, 'build');
  p.saveAiSelection('commit', null);
  assert.equal(p.configuredAiProvider(providers, 'commit').effort, 'high');
});

test('automatic drafts keep their captured options when preferences change before the chat opens', () => {
  const h = harness();
  h.react.useEffect = (effect) => effect();
  h.locals['@/lib/ipc'] = { ipc: {} };
  h.locals['@/store/useAppStore'] = { useAppStore: {} };
  const { useAiConversationEffects } = h.load(
    'components/ai/chat-panel/useAiConversationEffects.ts',
  );
  const p = h.load('lib/ai/aiPreferences.ts');
  p.saveAiSelection('diff', { providerId: api.id, model: 'changed-default' });
  const forcedSettings = { model: 'review-model', effort: 'high', mode: 'plan', agent: 'reviewer' };
  let selected;
  let sent;
  let cleared = false;
  useAiConversationEffects({
    activeConversationId: 'diff-chat',
    loadedConversationIdRef: { current: 'diff-chat' },
    aiDraft: {
      conversationId: 'diff-chat',
      origin: 'diff',
      draftPrompt: 'Explain these changes',
      autoSend: true,
      forcedProviderId: cli.id,
      forcedSettings,
    },
    consumedDraftIdRef: { current: null },
    providers,
    providersLoaded: true,
    actionHookByConvRef: { current: new Map() },
    surfaceContextByConvRef: { current: new Map() },
    clearAiDraft: () => {
      cleared = true;
    },
    setInput: () => {},
    setProvider: (value) => {
      selected = value;
    },
    setProviderError: (error) => assert.fail(error),
    sendRef: {
      current: (prompt, provider) => {
        sent = { prompt, provider };
      },
    },
  });
  assert.equal(cleared, true);
  assert.equal(selected.id, cli.id);
  for (const [key, value] of Object.entries(forcedSettings)) assert.equal(selected[key], value);
  assert.equal(sent.provider, selected);
  assert.equal(sent.prompt, 'Explain these changes');
});

test('changing another use case preserves the unsent Chat selection and all its options', async () => {
  const h = harness();
  const effects = [];
  h.react.useEffect = (effect) => effects.push(effect);
  const store = { tools: [cli.cli], refreshTools: async () => {} };
  h.locals['@/store/useAgentStore'] = {
    useAgentStore: Object.assign((select) => select(store), { getState: () => store }),
  };
  h.locals['@/lib/ipc'] = { ipc: { listAiProviders: async () => [api] } };
  const p = h.load('lib/ai/aiPreferences.ts');
  p.saveAiSelection('free', { providerId: api.id, model: 'chat-default' });
  let selected = null;
  const { useAiProviderPicker } = h.load('components/ai/chat-panel/useAiProviderPicker.ts');
  useAiProviderPicker({
    isOpen: true,
    activeConversationId: null,
    pickerOpen: false,
    setProviders: () => {},
    setProvidersLoaded: () => {},
    setProviderError: (error) => {
      if (error) assert.fail(error);
    },
    setProvider: (value) => {
      selected = typeof value === 'function' ? value(selected) : value;
    },
  });
  for (const effect of effects) effect();
  await new Promise(setImmediate);
  assert.equal(selected.model, 'chat-default');
  selected = { ...cli, model: 'my-model', effort: 'high', mode: 'plan', agent: 'reviewer' };
  p.saveAiSelection('commit', { providerId: cli.id, model: 'fast-commit-model' });
  await new Promise(setImmediate);
  assert.equal(selected.id, cli.id);
  assert.equal(selected.model, 'my-model');
  assert.equal(selected.effort, 'high');
  assert.equal(selected.mode, 'plan');
  assert.equal(selected.agent, 'reviewer');
  p.saveAiSelection('free', { providerId: api.id, model: 'new-chat-default' });
  await new Promise(setImmediate);
  assert.equal(selected.id, api.id);
  assert.equal(selected.model, 'new-chat-default');
});

test('model changes reset effort while mode/profile changes follow New conversation semantics', () => {
  const { changeAiGenerationSettings: change } = harness().load('lib/ai/aiGenerationSettings.ts');
  let current = {
    providerId: cli.id,
    model: 'reasoner',
    effort: 'xhigh',
    mode: 'plan',
    agent: 'reviewer',
  };
  current = change(current, { kind: 'model', value: 'fast' }, 'codex');
  assert.equal(current.effort, '');
  assert.equal(current.mode, 'plan');
  assert.equal(current.agent, 'reviewer');
  // ACP controls issue onMode and then onAgent; the second update must retain the first.
  current = change(current, { kind: 'mode', value: 'default' }, 'acp');
  current = change(current, { kind: 'agent', value: 'ask' }, 'acp');
  assert.equal(current.mode, 'default');
  assert.equal(current.agent, 'ask');
  current = change(current, { kind: 'agent', value: 'plan' }, 'opencode');
  assert.equal(current.mode, 'plan');
  current = change(current, { kind: 'reset' }, 'opencode');
  assert.equal(current.providerId, cli.id);
  assert.equal(current.model, '');
  assert.equal(current.effort, '');
  assert.equal(current.mode, undefined);
  assert.equal(current.agent, '');
});

function expand(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return [node, ...expand(node.props?.children)];
}

test('shared Chat and Settings controls use the live catalog and forward model, effort, mode and profile', () => {
  const h = harness();
  const requests = [];
  const catalog = {
    connection: 'codex',
    models: [{ id: 'reasoner', efforts: ['low', 'high'] }],
    agents: ['reviewer'],
    modes: ['default', 'plan'],
  };
  h.locals['@/components/agents/useAgentCatalog'] = {
    useAgentCatalog: (...args) => {
      requests.push(args);
      return { catalog, loading: false, error: null, refresh: () => {} };
    },
  };
  const { AiProviderControls } = h.load('components/ai/AiProviderControls.tsx');
  const changes = [];
  const nodes = expand(
    AiProviderControls({
      provider: { ...cli, model: 'reasoner', effort: 'high', mode: 'plan', agent: 'reviewer' },
      projectId: 'project',
      onChange: (change) => changes.push(change),
    }),
  );
  const controls = nodes.find((node) => node.type === 'AgentModelControls').props;
  assert.equal(controls.catalog, catalog);
  assert.equal(controls.effort, 'high');
  assert.equal(controls.mode, 'plan');
  assert.equal(controls.agent, 'reviewer');
  assert.equal(requests[0][2], 'project');
  assert.equal(requests[0][5], 'reasoner');
  controls.onModel('fast');
  controls.onEffort('low');
  controls.onMode('default');
  controls.onAgent('build');
  assert.deepEqual(
    changes.map((change) => change.kind),
    ['model', 'effort', 'mode', 'agent'],
  );
  assert.deepEqual(
    changes.map((change) => change.value),
    ['fast', 'low', 'default', 'build'],
  );
});

test('unconnected provider options do not fabricate a model catalog or drop saved settings', () => {
  const h = harness();
  h.locals['@/components/agents/useAgentCatalog'] = {
    useAgentCatalog: () => ({ catalog: null, loading: false, error: null, refresh: () => {} }),
  };
  const { AiProviderControls } = h.load('components/ai/AiProviderControls.tsx');
  const changes = [];
  const nodes = expand(
    AiProviderControls({
      provider: { ...cli, model: 'saved', effort: 'custom-variant' },
      projectId: '',
      onChange: (change) => changes.push(change),
    }),
  );
  const controls = nodes.find((node) => node.type === 'AgentModelControls').props;
  assert.equal(controls.catalog, null);
  assert.equal(controls.disabled, true);
  assert.equal(controls.model, 'saved');
  assert.equal(controls.effort, 'custom-variant');
  assert.equal(changes.length, 0);
});
