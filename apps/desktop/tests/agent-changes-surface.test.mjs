import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const compiled = ts.transpileModule(
  readFileSync(
    new URL('../src/components/agents/AgentChangesSurface.tsx', import.meta.url),
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

function mount(initial = {}) {
  const slots = [];
  const calls = [];
  let cursor = 0;
  let pending;
  let tree;
  let props = {
    expanded: false,
    onCollapse: () => calls.push('collapse'),
    children: { type: 'diff', props: { selected: 'src/index.ts' } },
    label: 'Changes',
    ...initial,
  };
  const element = {
    open: true,
    close() {
      element.open = false;
      calls.push('close');
    },
    showModal() {
      assert.equal(element.open, false, 'A nonmodal dialog must close before showModal');
      element.open = true;
      calls.push('showModal');
    },
    querySelector(selector) {
      assert.equal(selector, '[data-changes-expand-toggle]');
      return {
        focus(options) {
          assert.equal(options.preventScroll, true);
          calls.push('focus');
        },
      };
    },
  };
  const react = {
    useRef(value) {
      return (slots[cursor++] ??= { current: value });
    },
    useLayoutEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
      ) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === '@/lib/cn') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => {
    cursor = 0;
    pending = [];
    tree = exports.AgentChangesSurface(props);
    tree.props.ref.current = element;
    pending.forEach((effect) => effect());
  };
  render();
  return {
    calls,
    element,
    get tree() {
      return tree;
    },
    update(next) {
      props = { ...props, ...next };
      render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

test('expansion promotes the existing subtree to the top layer and restores inline focus', () => {
  const view = mount();
  const original = view.tree;
  assert.equal(original.props.role, 'region');
  assert.equal(original.props['aria-modal'], undefined);
  assert.deepEqual(view.calls, [], 'Initial inline rendering must not steal focus');

  view.update({ expanded: true });
  assert.equal(view.tree.type, original.type);
  assert.equal(view.tree.props.children, original.props.children);
  assert.equal(view.tree.props.role, 'dialog');
  assert.equal(view.tree.props['aria-modal'], true);
  assert.deepEqual(view.calls.slice(-2), ['showModal', 'focus']);

  const transitions = view.calls.length;
  view.update({ label: 'Değişiklikler', onCollapse: () => {} });
  assert.equal(view.calls.length, transitions, 'Label/callback updates must not reopen the modal');

  view.update({ expanded: false });
  assert.equal(view.tree.props.children, original.props.children);
  assert.equal(view.element.open, true);
  assert.equal(view.tree.props.role, 'region');
  assert.deepEqual(view.calls.slice(-2), ['close', 'focus']);
});

test('Escape and native cancellation collapse once and cannot reach app shortcuts', () => {
  const view = mount({ expanded: true });
  const event = {
    key: 'Escape',
    preventDefault() {
      view.calls.push('preventDefault');
    },
    stopPropagation() {
      view.calls.push('stopPropagation');
    },
  };
  view.tree.props.onKeyDown(event);
  assert.deepEqual(view.calls.slice(-3), ['preventDefault', 'stopPropagation', 'collapse']);
  view.tree.props.onCancel(event);
  assert.deepEqual(view.calls.slice(-3), ['preventDefault', 'stopPropagation', 'collapse']);

  view.update({ expanded: false });
  const before = view.calls.length;
  view.tree.props.onKeyDown(event);
  assert.equal(view.calls.length, before, 'Inline Changes must not consume Escape');
});

test('unmounting an expanded surface releases the native modal', () => {
  const view = mount({ expanded: true });
  assert.equal(view.element.open, true);
  view.unmount();
  assert.equal(view.element.open, false);
  assert.equal(view.calls.at(-1), 'close');
});
