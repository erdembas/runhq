import { URL } from 'node:url';
import console from 'node:console';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/components/docs/ProjectDocsTab.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

function mount(request) {
  const slots = [];
  const requests = [];
  const workbench = { projectDocRequests: request ? { project: request } : {} };
  let cursor = 0;
  let effects = [];
  let dirty = true;
  let nodes = [];
  let props = { serviceId: 'project', cwd: '/project', onRunCommand() {} };
  const element = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          dirty ||= !Object.is(next, slots[index]);
          slots[index] = next;
        },
      ];
    },
    useCallback: (callback) => callback,
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
  const store = (selector) => selector(workbench);
  store.getState = () => workbench;
  const ipc = Object.fromEntries(
    ['discoverProjectDocs', 'readProjectDoc'].map((name) => [
      name,
      (...args) => new Promise((resolve, reject) => requests.push({ name, args, resolve, reject })),
    ]),
  );
  const exports = {};
  runInNewContext(compiled, {
    exports,
    console,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/components/ui/ResizeHandle') return { ResizeHandle: 'resize' };
      if (name === '@/lib/ipc') return { ipc };
      if (name === '@/lib/useResizableWidth') return { useResizableWidth: () => ({ width: 260 }) };
      if (name === '@/store/useWorkbenchStore') return { useWorkbenchStore: store };
      if (name === './project-docs/DocBody') return { DocBody: 'body' };
      if (name === './project-docs/DocsEmptyState') return { DocsEmptyState: 'empty' };
      if (name === './project-docs/DocsSubNav') return { DocsSubNav: 'nav' };
      if (name === './project-docs/docKindMeta') return { sortDocs: (docs) => docs };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    nodes.push(node);
    walk(node.props.children);
  };
  const render = () => {
    do {
      dirty = false;
      cursor = 0;
      nodes = [];
      effects = [];
      walk(exports.ProjectDocsTab(props));
      effects.forEach((effect) => effect());
    } while (dirty);
  };
  render();
  return {
    requests,
    find: (type) => nodes.find((node) => node.type === type)?.props,
    render,
    update(next) {
      props = { ...props, ...next };
      render();
    },
    request(next) {
      workbench.projectDocRequests.project = next;
      render();
    },
    async resolve(request, result) {
      request.resolve(result);
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
  };
}

const docs = [{ relative_path: 'docs/guide.md' }, { relative_path: 'README.MD' }];
const readmeRequest = { cwd: '/project', relativePath: 'README.MD', revision: 1 };
const content = (relative_path, raw_content = relative_path) => ({ relative_path, raw_content });
const latestRead = (view) =>
  view.requests.filter((request) => request.name === 'readProjectDoc').at(-1);

test('a README shortcut selects the exact file before and after Docs has been mounted', async () => {
  const view = mount(readmeRequest);
  await view.resolve(view.requests[0], docs);
  assert.deepEqual(latestRead(view).args, ['project', 'README.MD']);
  await view.resolve(latestRead(view), content('README.MD'));
  assert.equal(view.find('body').content.relative_path, 'README.MD');
  view.find('body').onSelectDoc('docs/guide.md');
  view.render();
  await view.resolve(latestRead(view), content('docs/guide.md'));
  view.request({ ...readmeRequest, revision: 2 });
  assert.deepEqual(latestRead(view).args, ['project', 'README.MD']);
  await view.resolve(latestRead(view), content('README.MD'));
  assert.equal(view.find('body').content.relative_path, 'README.MD');
});

test('a shortcut arriving during discovery wins over the first discovered document', async () => {
  const view = mount();
  view.request(readmeRequest);
  await view.resolve(latestRead(view), content('README.MD'));
  await view.resolve(view.requests[0], docs);
  assert.equal(view.find('nav').activePath, 'README.MD');
  assert.equal(view.find('body').content.relative_path, 'README.MD');
});

test('changing project directory invalidates old shortcuts, discovery and refreshed content', async () => {
  const view = mount(readmeRequest);
  await view.resolve(view.requests[0], docs);
  await view.resolve(latestRead(view), content('README.MD'));
  view.find('body').onRefresh();
  view.render();
  const staleRefresh = latestRead(view);
  view.update({ cwd: '/new-project' });
  const discovery = view.requests
    .filter((request) => request.name === 'discoverProjectDocs')
    .at(-1);
  await view.resolve(discovery, [{ relative_path: 'readme.md' }]);
  assert.deepEqual(latestRead(view).args, ['project', 'readme.md']);
  await view.resolve(latestRead(view), content('readme.md', 'New project'));
  await view.resolve(staleRefresh, content('README.MD', 'Old project'));
  assert.equal(view.find('body').content.raw_content, 'New project');

  const pending = mount(readmeRequest);
  const staleDiscovery = pending.requests[0];
  pending.update({ cwd: '/empty-project' });
  await pending.resolve(
    pending.requests.filter((request) => request.name === 'discoverProjectDocs').at(-1),
    [],
  );
  await pending.resolve(staleDiscovery, docs);
  assert.equal(pending.find('empty').cwd, '/empty-project');
});
