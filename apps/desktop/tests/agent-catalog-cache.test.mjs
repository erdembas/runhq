import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL('../src/components/agents/agentCatalogCache.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports },
);
const { agentCatalogKey, createAgentCatalogCache } = exports;

test('simultaneous views and refreshes share an in-flight probe even beyond the TTL', async () => {
  let now = 0;
  let finish;
  let calls = 0;
  const cache = createAgentCatalogCache(100, () => now);
  const loader = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = cache.load('cursor', loader);
  await Promise.resolve();
  now = 500;
  cache.invalidate('cursor');
  assert.equal(cache.hasPending('cursor'), true);
  assert.equal(cache.load('cursor', loader), first);
  assert.equal(calls, 1);
  const catalog = { models: [], connection: 'acp' };
  finish(catalog);
  await first;
  assert.equal(cache.peek('cursor'), catalog);
  now = 599;
  assert.equal(cache.peek('cursor'), catalog, 'TTL must start after probe completion');
  now = 600;
  assert.equal(cache.peek('cursor'), undefined);
});

test('failed authentication is not cached and a later retry can recover', async () => {
  const cache = createAgentCatalogCache();
  await assert.rejects(
    cache.load('cursor', async () => {
      throw new Error('Please log in');
    }),
    /log in/,
  );
  assert.equal(cache.hasPending('cursor'), false);
  assert.equal(cache.peek('cursor'), undefined);
  const catalog = { models: [{ id: 'connected-model' }] };
  assert.equal(await cache.load('cursor', async () => catalog), catalog);
  assert.equal(cache.peek('cursor'), catalog);
});

test('manual refresh replaces successful model discovery', async () => {
  const cache = createAgentCatalogCache();
  const first = { models: [] };
  const second = { models: [{ id: 'new-model' }] };
  await cache.load('cursor', async () => first);
  assert.equal(await cache.load('cursor', async () => second), first);
  cache.invalidate('cursor');
  assert.equal(cache.peek('cursor'), undefined);
  assert.equal(await cache.load('cursor', async () => second), second);
});

test('discovery identity changes for repaired or upgraded executables without reacting to display labels', () => {
  const tool = {
    id: 'cursor',
    adapter: 'acp',
    command: 'agent',
    args: ['acp'],
    executable: '/old/agent',
    available: true,
    enabled: true,
    version: '1',
    detection_status: 'available',
  };
  const key = (value = tool, executable = '') =>
    agentCatalogKey('cursor', executable, 'project', undefined, undefined, value);
  const initial = key();
  for (const change of [
    { executable: '/new/agent' },
    { version: '2' },
    { available: false },
    { enabled: false },
    { command: 'cursor-agent' },
    { args: ['--acp'] },
    { detection_status: 'blocked' },
  ])
    assert.notEqual(key({ ...tool, ...change }), initial);
  assert.equal(key({ ...tool, name: 'New label', detection_source: 'known_location' }), initial);
  assert.equal(key(tool, ' /custom/agent '), key(tool, '/custom/agent'));
  assert.notEqual(key(tool, '/custom/agent'), initial);
});

test('refresh propagates empty, pending and replacement snapshots to every consumer of the same key', async () => {
  const cache = createAgentCatalogCache();
  const first = { models: [{ id: 'old-model' }] };
  const second = { models: [{ id: 'new-model' }] };
  await cache.load('shared', async () => first);
  const globalView = [];
  const projectView = [];
  let unrelatedUpdates = 0;
  const unsubscribeGlobal = cache.subscribe('shared', () =>
    globalView.push(cache.getSnapshot('shared')),
  );
  const unsubscribeProject = cache.subscribe('shared', () =>
    projectView.push(cache.getSnapshot('shared')),
  );
  const unsubscribeOther = cache.subscribe('other', () => unrelatedUpdates++);

  cache.invalidate('shared');
  assert.equal(
    globalView.at(-1).catalog,
    null,
    'old models disappear synchronously from all consumers',
  );
  assert.equal(projectView.at(-1).catalog, null);
  let finish;
  const probe = cache.load(
    'shared',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  assert.equal(globalView.at(-1).status, 'loading');
  assert.equal(
    projectView.at(-1).catalog,
    null,
    'refresh must never expose the previous successful catalog',
  );
  assert.equal(
    cache.load('shared', async () => first),
    probe,
  );
  finish(second);
  await probe;
  assert.equal(globalView.at(-1).catalog, second);
  assert.equal(projectView.at(-1).catalog, second);
  assert.deepEqual(
    globalView.map((snapshot) => snapshot.status),
    ['idle', 'loading', 'ready'],
  );
  assert.deepEqual(
    projectView.map((snapshot) => snapshot.status),
    ['idle', 'loading', 'ready'],
  );
  assert.equal(unrelatedUpdates, 0);
  unsubscribeGlobal();
  unsubscribeProject();
  unsubscribeOther();
  cache.invalidate('shared');
  assert.equal(globalView.length, 3, 'unmounted consumers stop receiving updates');
});

test('failed discovery is a stable shared error until retry, rather than idle that would trigger a retry loop', async () => {
  const cache = createAgentCatalogCache();
  let calls = 0;
  const updates = [];
  const unsubscribe = cache.subscribe('auth', () => updates.push(cache.getSnapshot('auth').status));
  await assert.rejects(
    cache.load('auth', async () => {
      calls++;
      throw new Error('Sign in required');
    }),
    /Sign in required/,
  );
  const failed = cache.getSnapshot('auth');
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /Sign in required/);
  assert.equal(failed.catalog, null);
  assert.equal(cache.hasPending('auth'), false);
  for (let i = 0; i < 10; i++) assert.equal(cache.getSnapshot('auth'), failed);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(updates, ['loading', 'error']);
  cache.invalidate('auth');
  assert.equal(cache.getSnapshot('auth').status, 'idle');
  const repaired = { models: [] };
  await cache.load('auth', async () => repaired);
  assert.equal(cache.getSnapshot('auth').catalog, repaired);
  assert.deepEqual(updates, ['loading', 'error', 'idle', 'loading', 'ready']);
  unsubscribe();
});

test('external-store snapshot identity remains stable until a real transition or TTL expiry', async () => {
  let now = 0;
  const cache = createAgentCatalogCache(100, () => now);
  const idle = cache.getSnapshot('key');
  assert.equal(cache.getSnapshot('key'), idle);
  const probe = cache.load('key', async () => ({ models: [] }));
  const pending = cache.getSnapshot('key');
  assert.equal(pending.status, 'loading');
  assert.equal(cache.getSnapshot('key'), pending);
  cache.invalidate('key');
  assert.equal(cache.getSnapshot('key'), pending, 'refresh joins a running probe');
  await probe;
  const complete = cache.getSnapshot('key');
  assert.equal(cache.getSnapshot('key'), complete);
  now = 100;
  assert.equal(cache.getSnapshot('key'), idle);
  assert.equal(cache.getSnapshot('key'), idle);
});

test('cache capacity never evicts mounted catalogs into repeated reloads', async () => {
  const cache = createAgentCatalogCache();
  const active = { models: [{ id: 'active' }] };
  const unsubscribe = cache.subscribe('mounted', () => {});
  await cache.load('mounted', async () => active);
  for (let i = 0; i < 80; i++) await cache.load(`background-${i}`, async () => ({ models: [] }));
  assert.equal(cache.peek('mounted'), active);
  assert.equal(cache.getSnapshot('mounted').status, 'ready');
  unsubscribe();
});
