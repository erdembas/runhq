import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const compiled = ts.transpileModule(
  readFileSync(
    new URL('../src/components/workbench/ProjectReadmePreview.tsx', import.meta.url),
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

// Execute the real loader with deferred IPC so races resolve in deliberately adversarial order.
// ReadmeCard stays a leaf: these tests concern file loading, not Markdown/layout presentation.
function mount(initial = {}) {
  const slots = [];
  const requests = [];
  const focusListeners = new Set();
  let props = { serviceId: 'project', cwd: '/project', visible: true, ...initial };
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let tree;
  const react = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initialValue;
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          dirty ||= !Object.is(next, slots[index]);
          slots[index] = next;
        },
      ];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
      ) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  const ipc = Object.fromEntries(
    ['discoverProjectDocs', 'readProjectDoc'].map((name) => [
      name,
      (...args) => new Promise((resolve, reject) => requests.push({ name, args, resolve, reject })),
    ]),
  );
  const exports = {};
  runInNewContext(compiled, {
    exports,
    window: {
      addEventListener(name, listener) {
        assert.equal(name, 'focus');
        focusListeners.add(listener);
      },
      removeEventListener(name, listener) {
        assert.equal(name, 'focus');
        focusListeners.delete(listener);
      },
    },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') {
        const jsx = (type, props, key) => ({ type, props, key });
        return { jsx, jsxs: jsx };
      }
      if (name === 'lucide-react') return {};
      if (name === '@/lib/ipc') return { ipc };
      if (name === '@/lib/workbenchNavigation') return {};
      if (name === './ProjectReadmeMarkdown') return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => {
    let commits = 0;
    do {
      assert(commits++ < 20, 'README loader effects must settle');
      cursor = 0;
      effects = [];
      dirty = false;
      tree = exports.ProjectReadmePreview(props);
      effects.forEach((effect) => effect());
    } while (dirty);
  };
  const settle = async () => {
    await setImmediate();
    render();
  };
  render();
  return {
    requests,
    card: () => tree?.props ?? null,
    latest: (name) => requests.filter((request) => request.name === name).at(-1),
    update(next) {
      props = { ...props, ...next };
      render();
    },
    focus() {
      [...focusListeners].forEach((listener) => listener());
      render();
    },
    refresh() {
      assert(tree, 'Refresh requires an existing README or error card');
      tree.props.onRefresh();
      render();
    },
    async resolve(request, value) {
      request.resolve(value);
      await settle();
    },
    async reject(request, error) {
      request.reject(error);
      await settle();
    },
  };
}

const docs = [{ kind: 'readme', relative_path: 'README.MD' }];
const content = (markdown) => ({ relative_path: 'README.MD', base_dir: '', markdown });
const discover = (view) => view.latest('discoverProjectDocs');
const read = (view) => view.latest('readProjectDoc');

test('missing and whitespace-only READMEs leave no card or empty placeholder', async () => {
  const missing = mount();
  assert.equal(missing.card(), null, 'Discovery must not block Overview with a loading card');
  await missing.resolve(discover(missing), [{ kind: 'doc', relative_path: 'docs/guide.md' }]);
  assert.equal(missing.card(), null);
  assert.equal(read(missing), undefined, 'Other project docs must not be substituted for README');

  const empty = mount();
  await empty.resolve(discover(empty), docs);
  assert.deepEqual(read(empty).args, ['project', 'README.MD']);
  await empty.resolve(read(empty), content(' \n\t '));
  assert.equal(empty.card(), null);
});

test('hidden previews do not fetch, listen for focus, or accept a pending read', async () => {
  const view = mount({ visible: false });
  view.focus();
  assert.equal(view.requests.length, 0);
  view.update({ visible: true });
  await view.resolve(discover(view), docs);
  const pendingRead = read(view);
  view.update({ visible: false });
  view.focus();
  assert.equal(view.requests.length, 2);
  await view.resolve(pendingRead, content('Stale hidden result'));
  assert.equal(view.card(), null);
  view.update({ visible: true });
  assert.equal(view.requests.length, 3, 'Returning to Overview must start a fresh discovery');
});

test('changing cwd immediately hides old content and rejects responses from the prior scope', async () => {
  const view = mount();
  await view.resolve(discover(view), docs);
  await view.resolve(read(view), content('Old project'));
  view.refresh();
  await view.resolve(discover(view), docs);
  const staleRead = read(view);
  view.update({ cwd: '/different-project' });
  assert.equal(view.card(), null);
  await view.resolve(discover(view), docs);
  await view.resolve(read(view), content('Current project'));
  await view.resolve(staleRead, content('Late old project'));
  assert.equal(view.card().content.markdown, 'Current project');

  const pendingDiscovery = mount();
  const staleDiscovery = discover(pendingDiscovery);
  pendingDiscovery.update({ cwd: '/empty-project' });
  await pendingDiscovery.resolve(discover(pendingDiscovery), []);
  await pendingDiscovery.resolve(staleDiscovery, docs);
  assert.equal(read(pendingDiscovery), undefined, 'A stale discovery must never start a file read');
  assert.equal(pendingDiscovery.card(), null);
});

test('the latest focus reload wins when earlier file reads resolve out of order', async () => {
  const view = mount();
  await view.resolve(discover(view), docs);
  await view.resolve(read(view), content('Initial'));
  view.focus();
  assert.equal(
    view.card().content.markdown,
    'Initial',
    'Refresh preserves current readable content',
  );
  assert.equal(view.card().loading, true);
  await view.resolve(discover(view), docs);
  const olderRead = read(view);
  view.focus();
  await view.resolve(discover(view), docs);
  await view.resolve(read(view), content('Newest'));
  await view.reject(olderRead, new Error('Stale read failed'));
  assert.equal(view.card().content.markdown, 'Newest');
  assert.equal(view.card().error, null);
  assert.equal(view.card().loading, false);
});

test('read errors expose retry and a successful refresh can replace or remove the card', async () => {
  const view = mount();
  await view.resolve(discover(view), docs);
  await view.reject(read(view), new Error('Permission denied'));
  assert.equal(view.card().error, 'Error: Permission denied');
  assert.equal(view.card().loading, false);
  view.refresh();
  await view.resolve(discover(view), docs);
  await view.resolve(read(view), content('Recovered README'));
  assert.equal(view.card().content.markdown, 'Recovered README');
  assert.equal(view.card().error, null);
  view.refresh();
  assert.equal(view.card().loading, true);
  await view.resolve(discover(view), []);
  assert.equal(view.card(), null, 'Deleting README is reflected on refresh');
});
