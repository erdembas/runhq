import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(
    new URL('../src/components/activity-timeline/useActivityTimelineData.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Run the hook's actual effects and cleanup order. There is no DOM or renderer
// dependency; store patches do not need a render unless a selected filter changes.
function setup({ delayedSubscriptions = false } = {}) {
  const slots = [];
  let cursor = 0;
  let changedEffects = [];
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, i) => Object.is(value, right[i]));
  const react = {
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) changedEffects.push({ index, effect, deps });
    },
  };
  const requests = [];
  const request = (method, args) => {
    const pending = deferred();
    requests.push({ method, args, ...pending });
    return pending.promise;
  };
  const subscriptions = [];
  const subscribe = (event, callback) => {
    const pending = deferred();
    const subscription = { event, callback, pending, unsubscribeCount: 0 };
    subscription.unsubscribe = () => subscription.unsubscribeCount++;
    subscriptions.push(subscription);
    if (!delayedSubscriptions) pending.resolve(subscription.unsubscribe);
    return pending.promise;
  };
  const timers = new Map();
  let nextTimer = 0;
  const schedule = (kind, callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { kind, callback, delay });
    return id;
  };
  const patches = [];
  let state = {
    filterProject: null,
    filterType: null,
    timeRange: 'today',
    loading: false,
    events: [],
    summary: null,
    weeklySummary: null,
    patch(patch) {
      patches.push(patch);
      state = { ...state, ...patch };
    },
  };
  const store = { getState: () => state };
  const errors = [];
  const exports = {};
  runInNewContext(compiled, {
    exports,
    console: { error: (...args) => errors.push(args) },
    window: {
      setInterval: (callback, delay) => schedule('interval', callback, delay),
      clearInterval: (id) => timers.delete(id),
      setTimeout: (callback, delay) => schedule('timeout', callback, delay),
      clearTimeout: (id) => timers.delete(id),
    },
    require(name) {
      if (name === 'react') return react;
      if (name === '@/lib/ipc')
        return {
          ipc: {
            getTimeline: (...args) => request('timeline', args),
            getDailySummary: (...args) => request('daily', args),
            getWeeklySummary: (...args) => request('weekly', args),
          },
          events: {
            onStatus: (callback) => subscribe('status', callback),
            onLog: (callback) => subscribe('log', callback),
          },
        };
      if (name === './model')
        return { getTimeSince: (range) => range, REFRESH_INTERVAL_MS: 30_000, TIME_TICK_MS: 1000 };
      if (name === './useActivityTimelineStore')
        return { useActivityTimelineStore: (target, selector) => selector(target.getState()) };
      throw new Error(name);
    },
  });
  const render = (options = {}) => {
    cursor = 0;
    changedEffects = [];
    const refresh = exports.useActivityTimelineData(store, {
      visible: true,
      isInline: false,
      collapsed: false,
      hoverOpen: false,
      ...options,
    });
    for (const { index } of changedEffects) slots[index]?.cleanup?.();
    for (const { index, effect, deps } of changedEffects)
      slots[index] = { deps, cleanup: effect() };
    return refresh;
  };
  const unmount = () => slots.forEach((slot) => slot?.cleanup?.());
  const resolveBatch = (offset, label) => {
    requests[offset].resolve([{ id: label }]);
    requests[offset + 1].resolve({ label });
    requests[offset + 2].resolve([{ label }]);
  };
  const runTimer = (kind, delay) => {
    const [id, timer] = [...timers].find(
      ([, value]) => value.kind === kind && value.delay === delay,
    );
    if (kind === 'timeout') timers.delete(id);
    timer.callback();
  };
  return {
    render,
    unmount,
    requests,
    subscriptions,
    timers,
    patches,
    errors,
    store,
    resolveBatch,
    runTimer,
  };
}

test('hidden and collapsed inline timelines create no IPC, timers or listeners', async () => {
  const hook = setup();
  await hook.render({ visible: false })();
  await hook.render({ isInline: true, collapsed: true })();
  assert.equal(hook.requests.length, 0);
  assert.equal(hook.timers.size, 0);
  assert.equal(hook.subscriptions.length, 0);
  assert.equal(hook.patches.length, 0);
  hook.render({ isInline: true, collapsed: true, hoverOpen: true });
  assert.equal(hook.requests.length, 3, 'hovering open an inline timeline activates data');
  assert.equal(hook.timers.size, 2);
  assert.equal(hook.subscriptions.length, 2);
  hook.unmount();
});

test('manual, polling and debounced events share one pending refresh', async () => {
  const hook = setup();
  const refresh = hook.render();
  const first = refresh();
  assert.equal(refresh({ showLoader: false }), first);
  hook.runTimer('interval', 30_000);
  hook.subscriptions.find((entry) => entry.event === 'status').callback();
  hook.subscriptions.find((entry) => entry.event === 'status').callback();
  hook.subscriptions
    .find((entry) => entry.event === 'log')
    .callback({ line: { stream: 'stderr', text: 'ERROR' } });
  assert.equal([...hook.timers.values()].filter((timer) => timer.kind === 'timeout').length, 1);
  hook.runTimer('timeout', 400);
  assert.equal(hook.requests.length, 3);
  hook.resolveBatch(0, 'first');
  await first;
  assert.equal(hook.store.getState().events[0].id, 'first');
  assert.equal(hook.store.getState().loading, false);
  const next = refresh({ showLoader: false });
  assert.equal(hook.requests.length, 6, 'completed refresh releases the coalesced request');
  hook.resolveBatch(3, 'second');
  await next;
  assert.equal(hook.store.getState().events[0].id, 'second');
  hook.unmount();
});

test('hiding invalidates pending data and clears periodic and debounced work', async () => {
  const hook = setup();
  const refresh = hook.render();
  const pending = refresh();
  await Promise.resolve();
  hook.subscriptions[0].callback();
  assert.equal(hook.timers.size, 3);
  const hiddenRefresh = hook.render({ visible: false });
  const patchCount = hook.patches.length;
  assert.equal(hook.timers.size, 0);
  assert(hook.subscriptions.every((entry) => entry.unsubscribeCount === 1));
  hook.subscriptions[0].callback();
  await hiddenRefresh();
  assert.equal(hook.timers.size, 0);
  assert.equal(hook.requests.length, 3);
  hook.resolveBatch(0, 'stale');
  await pending;
  assert.equal(
    hook.patches.length,
    patchCount,
    'late data and loading updates must both be ignored',
  );
  const reopened = hook.render()();
  hook.resolveBatch(3, 'reopened');
  await reopened;
  assert.equal(hook.store.getState().events[0].id, 'reopened');
  hook.unmount();
});

test('filter changes start fresh requests and old completions cannot overwrite new results', async () => {
  const hook = setup();
  const old = hook.render()();
  hook.store
    .getState()
    .patch({ filterProject: 'project-b', filterType: 'error', timeRange: 'week' });
  const refresh = hook.render();
  const current = refresh();
  assert.equal(hook.requests.length, 6);
  assert.deepEqual(Array.from(hook.requests[3].args), ['project-b', 'error', 'week', 500]);
  hook.resolveBatch(3, 'current');
  await current;
  const patchCount = hook.patches.length;
  hook.resolveBatch(0, 'obsolete');
  await old;
  assert.equal(hook.patches.length, patchCount);
  assert.equal(hook.store.getState().events[0].id, 'current');
  hook.unmount();
});

test('event subscriptions that finish after cleanup unregister immediately', async () => {
  const hook = setup({ delayedSubscriptions: true });
  hook.render();
  hook.render({ visible: false });
  assert(hook.subscriptions.every((entry) => entry.unsubscribeCount === 0));
  for (const subscription of hook.subscriptions)
    subscription.pending.resolve(subscription.unsubscribe);
  await Promise.resolve();
  assert(hook.subscriptions.every((entry) => entry.unsubscribeCount === 1));
  hook.subscriptions[0].callback();
  assert.equal(hook.timers.size, 0);
  assert.equal(hook.requests.length, 3);
});

test('an obsolete completion cannot release a newer coalesced request or its loading state', async () => {
  const hook = setup();
  const old = hook.render()();
  hook.store.getState().patch({ filterProject: 'new-project' });
  const refresh = hook.render();
  const current = refresh();
  const patchCount = hook.patches.length;
  hook.resolveBatch(0, 'obsolete');
  await old;
  assert.equal(hook.patches.length, patchCount);
  assert.equal(hook.store.getState().loading, true);
  assert.equal(refresh(), current);
  assert.equal(hook.requests.length, 6);
  hook.resolveBatch(3, 'new-project');
  await current;
  assert.equal(hook.store.getState().events[0].id, 'new-project');
  hook.unmount();
});

test('failed refresh releases loading and allows a fresh retry', async () => {
  const hook = setup();
  const refresh = hook.render();
  const failed = refresh();
  hook.requests[0].reject(new Error('offline'));
  hook.requests[1].resolve(null);
  hook.requests[2].resolve([]);
  await failed;
  assert.equal(hook.store.getState().loading, false);
  assert.equal(hook.errors.length, 1);
  const retry = refresh();
  assert.equal(hook.requests.length, 6);
  hook.resolveBatch(3, 'retried');
  await retry;
  assert.equal(hook.store.getState().events[0].id, 'retried');
  hook.unmount();
});
