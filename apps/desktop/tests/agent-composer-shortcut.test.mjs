import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const exports = {};
const element = (type, props) => ({ type, props });
function compile(file) {
  return ts.transpileModule(
    readFileSync(new URL(`../../../packages/cockpit-ui/src/${file}`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
}
const shortcut = {};
runInNewContext(compile('lib/messageSendShortcut.ts'), { exports: shortcut });
runInNewContext(compile('components/AgentComposer.tsx'), {
  exports,
  require: (name) => {
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (name === 'react') return { useRef: (current) => ({ current }), useLayoutEffect: () => {} };
    if (name === '../lib/messageSendShortcut') return shortcut;
    throw new Error(`Unexpected import ${name}`);
  },
});

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

// Invoke the actual textarea callback so assertions cover the component's send gates and
// preventDefault behavior, rather than a copy of its shortcut matcher.
function composer(overrides = {}) {
  const sent = [];
  let props = {
    value: 'Keep the conversation going',
    placeholder: 'Message',
    onChange: () => {},
    onSend: () => sent.push(props.value),
    controls: null,
    action: null,
    ...overrides,
  };
  const textarea = () =>
    descendants(exports.AgentComposer(props)).find((node) => node.type === 'textarea');
  return {
    sent,
    textarea,
    update(next) {
      props = { ...props, ...next };
    },
    press(overrides = {}) {
      let prevented = false;
      const { nativeEvent: nativeOverrides, ...keyOverrides } = overrides;
      const nativeEvent = {
        key: 'Enter',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        keyCode: 13,
        ...keyOverrides,
        ...nativeOverrides,
      };
      const event = {
        ...nativeEvent,
        nativeEvent,
        preventDefault() {
          prevented = true;
        },
      };
      textarea().props.onKeyDown(event);
      return prevented;
    },
  };
}

test('Enter sends by default and Cmd/Ctrl+Enter remain usable', () => {
  for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
    const h = composer();
    assert.equal(h.press(modifiers), true);
    assert.deepEqual(h.sent, ['Keep the conversation going']);
  }
});

test('Shift+Enter remains a newline in either send mode', () => {
  for (const sendShortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
      const h = composer({ sendShortcut });
      assert.equal(h.press({ ...modifiers, shiftKey: true }), false);
      assert.deepEqual(h.sent, []);
    }
  }
});

test('Cmd/Ctrl+Enter mode leaves plain Enter available for a newline', () => {
  const h = composer({ sendShortcut: 'CmdOrCtrl+Enter' });
  assert.equal(h.press(), false);
  assert.deepEqual(h.sent, []);
  assert.equal(h.press({ metaKey: true }), true);
  assert.equal(h.press({ ctrlKey: true }), true);
  assert.equal(h.sent.length, 2);
});

test('Alt+Enter and unrelated keys never send', () => {
  for (const sendShortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    const h = composer({ sendShortcut });
    for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
      assert.equal(h.press({ ...modifiers, altKey: true }), false);
      assert.equal(h.press({ ...modifiers, key: 'a' }), false);
    }
    assert.deepEqual(h.sent, []);
  }
});

test('Enter used to confirm IME composition is neither consumed nor sent', () => {
  for (const sendShortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    for (const nativeEvent of [
      { isComposing: true, keyCode: 13 },
      // Some browsers report composition completion with keyCode 229 after isComposing clears.
      { isComposing: false, keyCode: 229 },
    ]) {
      const h = composer({ sendShortcut });
      assert.equal(h.press({ metaKey: true, nativeEvent }), false);
      assert.deepEqual(h.sent, []);
    }
  }
});

test('holding the send shortcut consumes repeats without sending the draft twice', () => {
  for (const sendShortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    const h = composer({ sendShortcut });
    const modifiers = sendShortcut === 'Enter' ? {} : { ctrlKey: true };
    assert.equal(h.press(modifiers), true);
    assert.equal(h.press({ ...modifiers, repeat: true }), true);
    assert.equal(h.press({ ...modifiers, repeat: true }), true);
    assert.deepEqual(h.sent, ['Keep the conversation going']);
  }
});

test('busy and disabled composers cannot submit through the keyboard', () => {
  for (const state of [{ busy: true }, { disabled: true }]) {
    for (const sendShortcut of ['Enter', 'CmdOrCtrl+Enter']) {
      const h = composer({ ...state, sendShortcut });
      assert.equal(h.textarea().props.disabled, true);
      h.press();
      h.press({ metaKey: true });
      h.press({ ctrlKey: true });
      assert.deepEqual(h.sent, []);
    }
  }
});

test('changing the shortcut applies to the existing draft', () => {
  const h = composer({ sendShortcut: 'CmdOrCtrl+Enter', value: 'A draft\nwith two lines' });
  assert.equal(h.press(), false);
  h.update({ sendShortcut: 'Enter' });
  assert.equal(h.textarea().props.value, 'A draft\nwith two lines');
  assert.equal(h.press(), true);
  assert.deepEqual(h.sent, ['A draft\nwith two lines']);
});
