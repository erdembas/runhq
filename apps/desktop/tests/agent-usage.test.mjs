import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === './agentLibraryModel')
          return load('../src/components/agents/agentLibraryModel.ts');
        throw new Error(name);
      },
    },
  );
  return exports;
}
const { agentUsageSummary } = load('../src/components/agents/agentLibraryModel.ts');
const {
  agentCapacityPreferences,
  agentOccupiedSlots,
  agentCapacityWaitReason,
  agentExecutionState,
} = load('../src/components/agents/agentCapacity.ts');
const { agentUsagePreferences, evaluateAgentUsage, validateAgentUsagePreferences } = load(
  '../src/components/agents/agentUsagePolicy.ts',
);
const { agentComposerContent, agentCanSteer, agentSessionIsHistoryOnly } = load(
  '../src/components/agents/agentComposerPolicy.ts',
);

// Representative payloads emitted by packages/agent-runtime/src/{codex,claude,opencode,acp}.mjs.
test('Codex thread totals keep cached and reasoning subsets separate', () => {
  const usage = agentUsageSummary({
    total: {
      inputTokens: 1000,
      cachedInputTokens: 800,
      outputTokens: 200,
      reasoningOutputTokens: 100,
      totalTokens: 1200,
    },
    last: { totalTokens: 20 },
    modelContextWindow: 128000,
  });
  assert.equal(usage.total, 1200);
  assert.equal(usage.cachedInput, 800);
  assert.equal(usage.reasoning, 100);
  assert.equal(usage.scope, 'thread');
  assert.equal(usage.contextUsed, null);
  assert.equal(usage.contextSize, 128000);
  assert.equal(usage.cost, null);
});

test('Claude result usage includes separately counted cache reads/writes and explicit USD cost', () => {
  const usage = agentUsageSummary({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 200,
    },
    cost_usd: 0.012,
    model_usage: {},
  });
  assert.equal(usage.input, 100);
  assert.equal(usage.total, 1350);
  assert.equal(usage.cost, 0.012);
  assert.equal(usage.currency, 'USD');
  assert.equal(usage.scope, 'turn');
});

test('OpenCode message report does not invent a total or currency for partial token fields', () => {
  const usage = agentUsageSummary({
    tokens: { input: 100, output: 50, reasoning: 20, cache: { read: 1000, write: 200 } },
    cost: 0,
    model: 'chosen',
  });
  assert.equal(usage.input, 100);
  assert.equal(usage.output, 50);
  assert.equal(usage.cachedInput, 1000);
  assert.equal(usage.reasoning, 20);
  assert.equal(usage.total, null);
  assert.equal(usage.cost, 0);
  assert.equal(usage.currency, null);
  assert.equal(usage.scope, 'message');
  assert.equal(agentUsageSummary({ tokens: { input: 1, output: 2, total: 20 } }).total, 20);
});

test('ACP context occupancy remains distinct from consumed token totals', () => {
  const usage = agentUsageSummary({
    sessionUpdate: 'usage_update',
    used: 64000,
    size: 128000,
    cost: { amount: 0.5, currency: 'USD' },
  });
  assert.equal(usage.contextUsed, 64000);
  assert.equal(usage.contextSize, 128000);
  assert.equal(usage.total, null);
  assert.equal(usage.input, null);
  assert.equal(usage.cost, 0.5);
  assert.equal(usage.currency, 'USD');
  assert.equal(usage.scope, 'context');
});

test('absent and invalid usage stays unknown while reported zero remains zero', () => {
  for (const raw of [
    null,
    undefined,
    [],
    { input_tokens: -1, output_tokens: NaN, cost: Infinity },
  ]) {
    const usage = agentUsageSummary(raw);
    assert.equal(usage.total, null);
    assert.equal(usage.cost, null);
  }
  assert.equal(
    agentUsageSummary({ input_tokens: 0, output_tokens: 0, total_cost_usd: 0 }).total,
    0,
  );
  assert.equal(
    agentUsageSummary({ usage: { input_tokens: 5, output_tokens: 6, total_tokens: 30 } }).total,
    30,
  );
});

test('capacity normalization matches default8 and accepts only integer limits from1 through8', () => {
  assert.equal(agentCapacityPreferences(null).global, 8);
  const result = agentCapacityPreferences({
    global: 0,
    providers: { good: 2, zero: 0, huge: 10, fractional: 1.5, string: '2' },
  });
  assert.equal(result.global, 8);
  assert.equal(result.providers.good, 2);
  assert.equal(Object.keys(result.providers).length, 1);
});

test('capacity includes pending decisions and in-flight dispatch once, with global then provider waits', () => {
  const sessions = {
    running: { id: 'running', backend: 'codex', status: 'running' },
    question: { id: 'question', backend: 'claude', status: 'waiting_input' },
    sending: { id: 'sending', backend: 'codex', status: 'completed' },
    idle: { id: 'idle', backend: 'claude', status: 'idle' },
  };
  const occupied = agentOccupiedSlots(sessions, {
    running: [{ state: 'sending' }],
    sending: [{ state: 'sending' }],
  });
  assert.equal(occupied.total, 3);
  assert.equal(occupied.providers.codex, 2);
  assert.equal(occupied.providers.claude, 1);
  assert.match(agentCapacityWaitReason('codex', { global: 3, providers: {} }, occupied), /global/);
  assert.match(
    agentCapacityWaitReason('codex', { global: 8, providers: { codex: 2 } }, occupied),
    /provider/,
  );
  assert.equal(agentCapacityWaitReason('claude', { global: 8, providers: {} }, occupied), null);
});

test('waiting causes prefer outstanding permissions and recovery over available capacity', () => {
  const session = { status: 'running', pending: [{ kind: 'approval' }] };
  assert.equal(agentExecutionState(session, [], null), 'Waiting for permission');
  assert.equal(
    agentExecutionState({ status: 'completed', pending: [] }, [{ state: 'failed' }], null),
    'Queue paused · review and resume',
  );
  assert.equal(
    agentExecutionState(
      { status: 'idle', pending: [] },
      [{ state: 'queued' }],
      'Waiting for a global execution slot',
    ),
    'Waiting for a global execution slot',
  );
});

test('usage warnings and queue pauses compare one report and never aggregate cache subsets', () => {
  const rules = { tokenWarning: 100, tokenPause: 200, usdWarning: 1, usdPause: 2 };
  const warning = evaluateAgentUsage(
    { total: { totalTokens: 150, cachedInputTokens: 1000 } },
    rules,
  );
  assert.equal(warning.alerts.length, 1);
  assert.equal(warning.alerts[0].level, 'warning');
  assert.equal(warning.pauseReason, null);
  const paused = evaluateAgentUsage({ total: { totalTokens: 200 } }, rules);
  assert.match(paused.pauseReason, /200 tokens/);
  assert.equal(paused.alerts[0].level, 'pause');
  assert.equal(evaluateAgentUsage({ total: { totalTokens: 200 } }, {}).pauseReason, null);
});

test('missing token totals and unspecified or non-USD costs stay unsupported rather than blocking work', () => {
  const rules = { tokenPause: 10, usdPause: 1 };
  for (const raw of [
    null,
    { tokens: { input: 1000, output: 1000 }, cost: 100 },
    {
      sessionUpdate: 'usage_update',
      used: 9000,
      size: 10000,
      cost: { amount: 50, currency: 'EUR' },
    },
  ]) {
    const result = evaluateAgentUsage(raw, rules);
    assert.equal(result.pauseReason, null);
    assert.equal(result.unsupported.length, 2);
  }
  assert.match(evaluateAgentUsage({ cost_usd: 2 }, rules).pauseReason, /2 USD/);
});

test('usage rule settings validate positive thresholds and warn no later than pause', () => {
  const preferences = agentUsagePreferences({
    notifications: false,
    providers: { codex: { tokenWarning: 1.5, tokenPause: 100, usdPause: -5 } },
  });
  assert.equal(preferences.notifications, false);
  assert.equal(preferences.providers.codex.tokenWarning, undefined);
  assert.equal(preferences.providers.codex.tokenPause, 100);
  assert.equal(preferences.providers.codex.usdPause, undefined);
  assert.match(
    validateAgentUsagePreferences({
      notifications: true,
      providers: { codex: { tokenWarning: 200, tokenPause: 100 } },
    }),
    /no higher/,
  );
  assert.equal(
    validateAgentUsagePreferences({
      notifications: true,
      providers: { claude: { usdWarning: 0.5, usdPause: 1 } },
    }),
    null,
  );
});

test('context-only messages are available after hydration; steering never silently drops context', () => {
  assert.equal(agentComposerContent('', 1, true), true);
  assert.equal(agentComposerContent('message', 0, false), false);
  assert.equal(agentComposerContent(' ', 0, true), false);
  const running = { backend: 'codex', status: 'running', archived: false };
  assert.equal(agentCanSteer(running, 'Update', 0, true), true);
  assert.equal(agentCanSteer(running, 'Update', 1, true), false);
  assert.equal(agentCanSteer(running, 'Update', 0, false), false);
});

test('imported history remains read-only even after archive restoration', () => {
  const history = {
    backend: 'codex',
    status: 'running',
    archived: false,
    runtime_state: { history_only: true },
  };
  assert.equal(agentSessionIsHistoryOnly(history), true);
  assert.equal(agentCanSteer(history, 'Do something', 0, true), false);
  assert.equal(agentSessionIsHistoryOnly({ runtime_state: null }), false);
});
