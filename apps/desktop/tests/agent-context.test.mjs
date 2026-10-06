import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { TextEncoder } from 'node:util';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';

function load(path, modules = {}) {
  const exports = {};
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
      TextEncoder,
      require: (name) => {
        if (Object.hasOwn(modules, name)) return modules[name];
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return exports;
}
const model = load('../src/components/agents/agentContextModel.ts');
const { buildAgentContextPrompt, agentContextImages } = model;

test('context preserves provenance, separates native images and never embeds binary in text', () => {
  const attachment = { name: 'screen.png', mime_type: 'image/png', data: 'aW1hZ2U=' };
  const entry = {
    id: 'context',
    name: 'Screenshot',
    source: '/project/screen.png',
    projectId: 'project',
    capturedAt: 123,
    content: 'Screenshot supplied',
    attachment,
  };
  const prompt = buildAgentContextPrompt('', [entry]);
  assert.match(prompt, /Please inspect/);
  assert.match(prompt, /reference material/);
  assert.match(prompt, /project\/screen.png/);
  assert.ok(!prompt.includes(attachment.data));
  assert.equal(agentContextImages([entry])[0], attachment);
});

test('context byte budget counts multibyte content before sending', () => {
  assert.throws(
    () => buildAgentContextPrompt('Inspect', [{ content: '🧪'.repeat(70000) }]),
    /256 KiB/,
  );
  assert.equal(buildAgentContextPrompt('plain', []), 'plain');
});

test('the Context tray offers files, images, diffs and notes but no saved project decisions', () => {
  const hooks = [];
  let cursor = 0;
  const react = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => (hooks[index] = value)];
    },
    useRef: (current) => {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
  };
  // Records an older version saved as project decisions are still returned by the store.
  const records = {
    'memory:qa': {
      key: 'memory:qa',
      value: { id: 'qa', projectId: 'project', title: 'Keep navigation stable', content: 'x' },
    },
  };
  const bind = (state) => Object.assign((select) => select(state), { getState: () => state });
  const { AgentContextTray } = load('../src/components/agents/AgentContextTray.tsx', {
    react,
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@runhq/cockpit-ui': {
      agentSupportsImages: () => true,
      validateAgentAttachments: () => null,
      MAX_AGENT_IMAGE_BYTES: 1,
      AGENT_IMAGE_MIME_TYPES: ['image/png'],
      SearchableSelect: 'SearchableSelect',
    },
    '@/store/useAgentLibraryStore': {
      useAgentLibraryStore: bind({ records, error: null, refresh: async () => {} }),
    },
    '@/store/useAgentStore': {
      useAgentStore: bind({ projects: [{ id: 'project', name: 'Project', path: '/p' }] }),
    },
    '@/lib/ipc/agentWorkspaceIpc': { agentWorkspaceIpc: {} },
    '@/lib/ipc': { ipc: {} },
    './useAgentContext': {
      useAgentContext: () => ({ entries: [], ready: true, set: async () => {}, make: () => ({}) }),
    },
    './agentContextModel': model,
  });
  const render = () => {
    cursor = 0;
    return AgentContextTray({ draftKey: 'draft', projectId: 'project', sessionId: 'task' });
  };
  const nodes = (node) =>
    !node || typeof node !== 'object'
      ? []
      : Array.isArray(node)
        ? node.flatMap(nodes)
        : [node, ...nodes(node.props?.children)];
  nodes(render())
    .find((node) => node.type === 'button' && node.props['aria-expanded'] === false)
    .props.onClick();
  const tree = nodes(render());
  const text = JSON.stringify(tree.map((node) => (typeof node === 'string' ? node : '')));
  const labels = tree.map((node) => node.props?.label ?? node.props?.['aria-label']);
  assert(labels.includes('Context source project'));
  assert(labels.includes('Attach image context'));
  assert(labels.includes('Workspace file path'));
  assert(labels.includes('Context excerpt'));
  assert(!labels.includes('Attach a project decision'));
  assert(
    !tree.some(
      (node) =>
        node.type === 'SearchableSelect' &&
        node.props.options.some((option) => option.label === 'Keep navigation stable'),
    ),
    'saved project decisions are not offered',
  );
  assert(!text.includes('Keep navigation stable'));
});
