import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, resolve = () => ({})) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: resolve, Date, Number, Error },
  );
  return exports;
}
/** Values built inside the VM carry that realm's prototypes; compare their plain shape. */
const plain = (value) => JSON.parse(JSON.stringify(value));

// Load the real capability table rather than restating it, so a change there is felt here.
const attachments = load('../../../packages/cockpit-ui/src/lib/agentAttachments.ts');
const {
  parseAccountPool,
  parseAccountCooldowns,
  providerLimitReason,
  startCooldown,
  activeCooldown,
  pruneCooldowns,
  accountCapabilityGap,
  chooseAgentAccount,
  resolveAccountPool,
  poolTarget,
  handoffAccountAfterLimit,
  composerAccountForTarget,
  ACCOUNT_COOLDOWN_MS,
} = load('../src/components/agents/agentAccountRouting.ts', (name) =>
  name === '@runhq/cockpit-ui' ? attachments : {},
);

const account = (id, extra = {}) => ({
  id,
  name: id,
  adapter: 'claude',
  enabled: true,
  available: true,
  ...extra,
});
const pool = { id: 'p', name: 'Claude accounts', accounts: ['a', 'b'] };
const capacity = { global: 8, providers: {} };
const idle = { total: 0, providers: {} };
const now = 1_000_000;

test('a pool is validated before it can be stored', () => {
  assert.throws(() => parseAccountPool({ id: 'p', name: 'x', accounts: [] }), /at least one/);
  assert.throws(() => parseAccountPool({ id: 'p', accounts: ['a'] }), /a name/);
  assert.throws(() => parseAccountPool({ id: 'p', name: 'x', accounts: ['a', 7] }), /Invalid/);
  assert.deepEqual(
    [...parseAccountPool({ id: 'p', name: 'x', accounts: ['a', 'b', 'a'] }).accounts],
    ['a', 'b'],
  );
});

test('only a reported limit failure starts a cool-down', () => {
  for (const limit of [
    'Error: 429 Too Many Requests',
    'You have reached your usage limit for this account',
    'rate_limit_error: please retry later',
    'Insufficient quota for this organization',
  ])
    assert.equal(providerLimitReason(limit), limit, `${limit} is a provider limit`);
  for (const other of [
    'OAuth access token has expired. Re-authenticate to continue.',
    'Waiting for a provider execution slot',
    'Queue paused by reported usage: 120,000 tokens ≥ 100,000',
    'ECONNRESET while reading from the agent',
    '',
    null,
    undefined,
  ])
    assert.equal(
      providerLimitReason(other),
      null,
      `${other} must not withhold an account from routing`,
    );
});

test('a cool-down expires on its own and is dropped from storage', () => {
  const started = startCooldown({}, 'a', 'usage limit reached', now);
  assert.equal(started.a.since, now);
  assert.equal(started.a.until, now + ACCOUNT_COOLDOWN_MS);
  assert.ok(activeCooldown(started, 'a', now + 1));
  assert.equal(activeCooldown(started, 'a', started.a.until + 1), null);
  assert.equal(activeCooldown(started, 'b', now), null);
  assert.deepEqual(plain(pruneCooldowns(started, started.a.until + 1)), {});
  assert.equal(pruneCooldowns(started, now), started, 'an unchanged record is not rewritten');
  assert.deepEqual(plain(parseAccountCooldowns({ a: { since: 'x', until: 1 } })), {});
});

test('capability fit is declared by the adapter, never guessed', () => {
  assert.equal(accountCapabilityGap('claude', { images: true }), null);
  assert.equal(accountCapabilityGap('codex', { images: true, steering: true, plan: true }), null);
  assert.match(accountCapabilityGap('opencode', { images: true }), /image/);
  assert.match(accountCapabilityGap('claude', { steering: true }), /steer/);
  // An ACP connection advertises its modes only once it runs, so plan work is not routed to it.
  assert.match(accountCapabilityGap('acp', { plan: true }), /plan mode/);
  assert.equal(accountCapabilityGap('acp', {}), null);
});

test('the account with the most free slots wins, and the pool order breaks a tie', () => {
  const busy = { total: 1, providers: { a: 1 } };
  const choice = chooseAgentAccount({
    pool,
    accounts: [account('a'), account('b')],
    cooldowns: {},
    capacity,
    occupied: busy,
    now,
  });
  assert.equal(choice.accountId, 'b');
  assert.match(choice.reason, /most free slots/);
  // A pool of one is an ordinary connection: nothing was compared, so nothing is claimed.
  assert.equal(
    chooseAgentAccount({
      pool: { id: 'a', name: 'Claude', accounts: ['a'] },
      accounts: [account('a')],
      cooldowns: {},
      capacity,
      occupied: idle,
      now,
    }).reason,
    '',
  );
  assert.equal(
    chooseAgentAccount({
      pool: { id: 'a', name: 'Claude', accounts: ['a'] },
      accounts: [account('a', { enabled: false })],
      cooldowns: {},
      capacity,
      occupied: idle,
      now,
    }).reason,
    'a is disabled',
  );
  assert.equal(
    chooseAgentAccount({
      pool,
      accounts: [account('a'), account('b')],
      cooldowns: {},
      capacity,
      occupied: idle,
      now,
    }).accountId,
    'a',
  );
});

test('a reported limit moves work to the other account and says which signal ruled it out', () => {
  const cooldowns = startCooldown({}, 'a', '429 Too Many Requests', now);
  const choice = chooseAgentAccount({
    pool,
    accounts: [account('a'), account('b')],
    cooldowns,
    capacity,
    occupied: idle,
    now: now + 1,
  });
  assert.equal(choice.accountId, 'b');
  assert.deepEqual(
    plain(choice.rejected).map(({ id, signal }) => ({ id, signal })),
    [{ id: 'a', signal: 'quota' }],
  );
});

test('each account is ruled out by one named signal', () => {
  const choice = chooseAgentAccount({
    pool: {
      id: 'p',
      name: 'Mixed',
      accounts: ['gone', 'off', 'missing', 'text', 'limited', 'full'],
    },
    accounts: [
      account('off', { enabled: false }),
      account('missing', { available: false }),
      account('text', { adapter: 'opencode' }),
      account('limited'),
      account('full'),
    ],
    need: { images: true },
    cooldowns: startCooldown({}, 'limited', 'usage limit reached', now),
    capacity: { global: 8, providers: { full: 1 } },
    occupied: { total: 1, providers: { full: 1 } },
    now,
  });
  assert.equal(choice.accountId, null);
  assert.deepEqual(
    plain(choice.rejected).map(({ id, signal }) => [id, signal]),
    [
      ['gone', 'availability'],
      ['off', 'availability'],
      ['missing', 'availability'],
      ['text', 'capability'],
      ['limited', 'quota'],
      ['full', 'load'],
    ],
  );
  assert.match(choice.reason, /No account in Mixed is free/);
  assert.match(choice.reason, /and 3 more/, 'the list stays readable');
});

test('a full workspace is reported as a global wait, not as a pool that failed', () => {
  const choice = chooseAgentAccount({
    pool,
    accounts: [account('a'), account('b')],
    cooldowns: {},
    capacity: { global: 2, providers: {} },
    occupied: { total: 2, providers: { a: 1, b: 1 } },
    now,
  });
  assert.equal(choice.accountId, null);
  assert.equal(choice.reason, 'Waiting for a global execution slot');
  assert.deepEqual(plain(choice.rejected), [], 'no account is blamed for a workspace-wide limit');
});

test('a plain connection routes as a pool of one, and a removed pool routes nowhere', () => {
  const stored = { id: 'team', name: 'Claude accounts', accounts: ['a', 'b'] };
  const pools = (id) => (id === 'team' ? stored : null);
  const named = (id) => (id === 'a' ? 'Claude' : id);
  assert.deepEqual(plain(resolveAccountPool('a', pools, named)), {
    id: 'a',
    name: 'Claude',
    accounts: ['a'],
  });
  assert.equal(resolveAccountPool(poolTarget('team'), pools, named).name, 'Claude accounts');
  assert.equal(resolveAccountPool(poolTarget('gone'), pools, named), null);
  assert.equal(resolveAccountPool('', pools, named), null);
});

test('a handoff after a limit starts on another account, and otherwise suggests nothing', () => {
  const pools = [{ id: 'p', name: 'Claude accounts', accounts: ['a', 'b'] }];
  const accounts = [account('a'), account('b')];
  const shared = { pools, accounts, capacity, occupied: idle, now: now + 1 };
  const limited = startCooldown({}, 'a', 'usage limit reached', now);
  assert.equal(
    handoffAccountAfterLimit({ ...shared, sourceAccountId: 'a', cooldowns: limited }),
    'b',
  );
  // No limit, no suggestion: an ordinary handoff is the user's own choice of agent.
  assert.equal(handoffAccountAfterLimit({ ...shared, sourceAccountId: 'a', cooldowns: {} }), '');
  // A limited account nobody grouped has no interchangeable partner to fall back to.
  assert.equal(
    handoffAccountAfterLimit({
      ...shared,
      pools: [],
      sourceAccountId: 'a',
      cooldowns: limited,
    }),
    '',
  );
  // Every account in the pool is limited, so the composer is left for the user to decide.
  assert.equal(
    handoffAccountAfterLimit({
      ...shared,
      sourceAccountId: 'a',
      cooldowns: startCooldown(limited, 'b', 'usage limit reached', now),
    }),
    '',
  );
});

test('a pool target becomes a real connection before it reaches the composer', () => {
  const stored = { id: 'team', name: 'Claude accounts', accounts: ['a', 'b'] };
  const shared = {
    pool: (id) => (id === 'team' ? stored : null),
    accounts: [account('a'), account('b')],
    cooldowns: {},
    capacity,
    occupied: idle,
    now,
  };
  // A plain connection passes through untouched, including "choose at launch".
  assert.equal(composerAccountForTarget({ ...shared, target: 'a' }), 'a');
  assert.equal(composerAccountForTarget({ ...shared, target: '' }), '');
  assert.equal(composerAccountForTarget({ ...shared, target: poolTarget('team') }), 'a');
  assert.equal(
    composerAccountForTarget({
      ...shared,
      target: poolTarget('team'),
      cooldowns: startCooldown({}, 'a', 'usage limit reached', now - 1),
    }),
    'b',
  );
  // Nothing free and nothing to point at: the person picks, rather than the screen guessing.
  assert.equal(composerAccountForTarget({ ...shared, target: poolTarget('gone') }), '');
  assert.equal(
    composerAccountForTarget({
      ...shared,
      target: poolTarget('team'),
      accounts: [account('a', { enabled: false }), account('b', { available: false })],
    }),
    '',
  );
});
