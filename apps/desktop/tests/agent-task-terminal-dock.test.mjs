import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { i18n, runInNewContext } from './helpers/i18n-vm.mjs';

const compiled = ts.transpileModule(
  readFileSync(
    new URL('../src/components/agents/AgentTaskTerminalDock.tsx', import.meta.url),
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

let nextViewId = 0;

// Persistent hook slots and panel handles exercise the visibility transitions. Element paths
// record React's reconciliation positions so a moved terminal or conversation fails the test.
function mount(initial = {}) {
  const slots = [];
  let cursor = 0;
  let pending = [];
  let dirty = false;
  let nodes = [];
  let panelSize;
  let hides = 0;
  let props = {
    children: { type: 'conversation', props: { children: 'draft' } },
    sessionId: 'task-1',
    cwd: '/tmp/task-worktree',
    terminalOpen: false,
    onHideTerminal: () => hides++,
    ...initial,
  };
  const react = {
    useId() {
      return (slots[cursor++] ??= `view-${nextViewId++}`);
    },
    useRef(value) {
      return (slots[cursor++] ??= { current: value });
    },
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initialValue;
      return [
        slots[index],
        (value) => {
          if (!Object.is(slots[index], value)) dirty = true;
          slots[index] = value;
        },
      ];
    },
    useLayoutEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        pending.push(effect);
        slots[index] = deps;
      }
    },
  };
  const element = (type, elementProps) => ({ type, props: elementProps });
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'lucide-react') return { Terminal: 'icon', X: 'icon' };
      if (name === 'react-resizable-panels')
        return { Panel: 'panel', PanelGroup: 'group', PanelResizeHandle: 'handle' };
      if (name === '@/components/TerminalPane') return { TerminalPane: 'terminal' };
      if (name === '@/lib/cn') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const walk = (node, path = 'root') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}/${i}`));
      return;
    }
    nodes.push({ ...node, path });
    if (node.type === 'panel' && node.props.ref) {
      panelSize ??= node.props.defaultSize;
      node.props.ref.current = {
        resize(size) {
          panelSize = size;
          node.props.onResize?.(size);
        },
        collapse() {
          if (panelSize === 0) return;
          panelSize = 0;
          node.props.onResize?.(0);
          node.props.onCollapse?.();
        },
      };
    }
    walk(node.props.children, `${path}/${node.type}`);
  };
  const render = () => {
    do {
      dirty = false;
      cursor = 0;
      nodes = [];
      pending = [];
      walk(exports.AgentTaskTerminalDock(props));
      pending.forEach((effect) => effect());
    } while (dirty);
  };
  render();
  return {
    find(type) {
      return nodes.find((node) => node.type === type);
    },
    update(next) {
      props = { ...props, ...next };
      render();
    },
    resize(size) {
      const panel = nodes.find((node) => node.type === 'panel' && node.props.ref);
      panel.props.ref.current.resize(size);
      if (size === 0) panel.props.onCollapse();
    },
    get size() {
      return panelSize;
    },
    get hides() {
      return hides;
    },
  };
}

test('opening is lazy; hiding, changing content, and switching language preserve the shell', () => {
  const dock = mount();
  const conversationPath = dock.find('conversation').path;
  assert.equal(dock.find('terminal'), undefined);

  dock.update({ terminalOpen: true });
  const terminal = dock.find('terminal');
  assert.equal(terminal.props.cwd, '/tmp/task-worktree');
  assert.equal(dock.find('conversation').path, conversationPath);

  dock.update({ terminalOpen: false });
  assert.equal(dock.size, 0);
  assert.equal(dock.hides, 0, 'controlled hiding must not trigger a visibility callback loop');
  assert.equal(dock.find('terminal').props.id, terminal.props.id);
  assert.equal(dock.find('terminal').path, terminal.path);
  assert.equal(dock.find('conversation').path, conversationPath);

  try {
    i18n.setLocale('tr');
    dock.update({ children: { type: 'changes', props: {} }, terminalOpen: true });
    assert.equal(dock.find('terminal').props.id, terminal.props.id);
    assert.equal(dock.find('terminal').path, terminal.path);
    assert.equal(dock.find('handle').props['aria-label'], 'Görev terminalini yeniden boyutlandır');
  } finally {
    i18n.setLocale('en');
  }
});

test('reopening restores the resized height and dragging closed updates the parent', () => {
  const dock = mount({ terminalOpen: true });
  dock.resize(48);
  dock.update({ terminalOpen: false });
  dock.update({ terminalOpen: true });
  assert.equal(dock.size, 48);
  assert.equal(dock.hides, 0);

  dock.resize(0);
  assert.equal(dock.hides, 1);
  dock.update({ terminalOpen: false });
  dock.update({ terminalOpen: true });
  assert.equal(dock.size, 48);
});

test('two hosts for the same task have distinct PTY identities', () => {
  const first = mount({ terminalOpen: true });
  const second = mount({ terminalOpen: true });
  assert.notEqual(first.find('terminal').props.id, second.find('terminal').props.id);
});
