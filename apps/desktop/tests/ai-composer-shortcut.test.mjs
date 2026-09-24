import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const element = (type, props) => ({ type, props });

function load(path, require) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    { exports, require },
  );
  return exports;
}

const shortcuts = load('../../../packages/cockpit-ui/src/lib/messageSendShortcut.ts');

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

function composer(overrides = {}, initialShortcut = 'Enter') {
  let sendShortcut = initialShortcut;
  const sent = [];
  let props = {
    awaitingAutoSend: false,
    contextChips: [],
    input: 'Continue with this message',
    inputRef: { current: null },
    isInline: true,
    isStreaming: false,
    pickerOpen: false,
    pickerRef: { current: null },
    provider: { id: 'provider', name: 'Provider', model: 'model' },
    providers: [],
    selectedService: null,
    tokenCount: 0,
    turnsLength: 0,
    onSend: () => sent.push(props.input),
    ...overrides,
  };
  const { AiChatComposer } = load('../src/components/ai/chat-panel/AiChatComposer.tsx', (name) => {
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (name === 'lucide-react') return {};
    if (name === '@runhq/cockpit-ui') return shortcuts;
    if (name === '@/lib/cn') return { cn: (...classes) => classes.join(' ') };
    if (name === '@/lib/useMessageSendShortcut') {
      return {
        useMessageSendShortcut: () => ({
          sendShortcut,
          title: `Send using ${sendShortcut}`,
          hint: `Shortcut hint: ${sendShortcut}`,
        }),
      };
    }
    if (['../ModelPicker', '../TokenMeter', './aiChatProviders'].includes(name)) return {};
    throw new Error(`Unexpected import ${name}`);
  });
  const nodes = () => descendants(AiChatComposer(props));
  const textarea = () => nodes().find((node) => node.type === 'textarea');
  return {
    sent,
    nodes,
    textarea,
    shortcut(value) {
      sendShortcut = value;
    },
    update(next) {
      props = { ...props, ...next };
    },
    press(overrides = {}) {
      let prevented = false;
      const nativeEvent = {
        key: 'Enter',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        keyCode: 13,
        ...overrides,
      };
      textarea().props.onKeyDown({
        ...nativeEvent,
        nativeEvent,
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test('AI chat follows the configured Enter or Cmd/Ctrl+Enter shortcut', () => {
  for (const shortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    const h = composer({}, shortcut);
    assert.equal(h.press(), shortcut === 'Enter');
    assert.equal(h.press({ metaKey: true }), true);
    assert.equal(h.press({ ctrlKey: true }), true);
    assert.equal(h.sent.length, shortcut === 'Enter' ? 3 : 2);
  }
});

test('AI chat leaves newline, unrelated, and IME composition keys untouched', () => {
  for (const shortcut of ['Enter', 'CmdOrCtrl+Enter']) {
    const h = composer({}, shortcut);
    for (const modifiers of [
      { shiftKey: true },
      { shiftKey: true, metaKey: true },
      { altKey: true, ctrlKey: true },
      { key: 'a', metaKey: true },
      { isComposing: true, metaKey: true },
      { keyCode: 229, metaKey: true },
    ]) {
      assert.equal(h.press(modifiers), false);
    }
    assert.deepEqual(h.sent, []);
  }
});

test('AI chat consumes repeated shortcuts without sending the same draft twice', () => {
  const h = composer();
  assert.equal(h.press(), true);
  assert.equal(h.press({ repeat: true }), true);
  assert.deepEqual(h.sent, ['Continue with this message']);
});

test('AI chat keyboard cannot send while streaming, awaiting auto-send, or without content/provider', () => {
  for (const state of [
    { isStreaming: true },
    { awaitingAutoSend: true },
    { input: '  \n ' },
    { provider: null },
  ]) {
    const h = composer(state);
    assert.equal(h.press(), true);
    assert.equal(h.press({ ctrlKey: true }), true);
    assert.deepEqual(h.sent, []);
    if (!state.isStreaming) {
      assert.equal(
        h
          .nodes()
          .find((node) => node.type === 'button' && node.props['aria-label'] === 'Send message')
          .props.disabled,
        true,
      );
    }
  }
});

test('AI chat updates its shortcut and labels without losing a multiline draft', () => {
  const h = composer({ input: 'A draft\nwith two lines' }, 'CmdOrCtrl+Enter');
  assert.equal(h.press(), false);
  h.shortcut('Enter');
  assert.equal(h.textarea().props.value, 'A draft\nwith two lines');
  assert.equal(h.press(), true);
  assert.deepEqual(h.sent, ['A draft\nwith two lines']);
  assert.equal(
    h.nodes().find((node) => node.type === 'button' && node.props['aria-label'] === 'Send message')
      .props.title,
    'Send using Enter',
  );
  h.update({ input: '' });
  assert.ok(h.nodes().some((node) => node.props?.children === 'Shortcut hint: Enter'));
  h.shortcut('CmdOrCtrl+Enter');
  assert.ok(h.nodes().some((node) => node.props?.children === 'Shortcut hint: CmdOrCtrl+Enter'));
});
