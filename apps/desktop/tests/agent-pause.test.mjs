import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { i18nCore, i18nView } from './helpers/i18n.mjs';

const element = (type, props) => ({ type, props });
const descendants = (node) =>
  Array.isArray(node)
    ? node.flatMap(descendants)
    : node && typeof node === 'object'
      ? [node, ...descendants(node.props?.children)]
      : [];
function render(pause_state, overrides = {}, command = async () => {}) {
  const exports = {};
  const calls = [];
  const errors = [];
  const source = ts.transpileModule(
    readFileSync(
      new URL('../src/components/agents/AgentPauseControl.tsx', import.meta.url),
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
  new Function('exports', 'require', source)(exports, (name) => {
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (name === 'react')
      return { useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }) };
    if (name === 'lucide-react')
      return { Loader2: 'Loader2', Pause: 'Pause', Play: 'Play', X: 'X' };
    if (name === '@runhq/cockpit-ui/i18n') return i18nView;
    if (name === '@runhq/cockpit-ui')
      return {
        agentIsActive: (status) => ['running', 'waiting_input', 'cancelling'].includes(status),
      };
    if (name === '@/lib/ipc')
      return {
        ipc: {
          agentPause: (id, resume) => {
            calls.push({ id, resume });
            return command();
          },
        },
      };
    throw new Error(`Unexpected import: ${name}`);
  });
  const tree = exports.AgentPauseControl({
    session: { id: 'same-task', status: 'running', pause_state, ...overrides },
    onError: (error) => errors.push(error),
  });
  return { tree, button: descendants(tree).find((node) => node.type === 'button'), calls, errors };
}

test('pause is unavailable without provider support and absent after stop/completion', () => {
  const view = render(null);
  assert.equal(view.button.props.disabled, true);
  view.button.props.onClick();
  assert.deepEqual(view.calls, []);
  assert.equal(render('paused', { status: 'cancelling' }).tree, null);
  assert.equal(render(null, { status: 'completed' }).tree, null);
});

test('pause, cancel pending pause and resume all address the existing task without starting a turn', async () => {
  for (const [state, resume] of [
    ['running', false],
    ['pausing', true],
    ['paused', true],
  ]) {
    const view = render(state);
    view.button.props.onClick();
    view.button.props.onClick();
    assert.deepEqual(view.calls, [{ id: 'same-task', resume }]);
    await Promise.resolve();
    await Promise.resolve();
  }
});

test('pause errors remain visible and controls translate when the interface language changes', async () => {
  try {
    i18nCore.setLocale('tr');
    assert.equal(render('running').button.props['aria-label'], 'Agentı duraklat');
    assert.equal(render('pausing').button.props['aria-label'], 'Duraklatmaktan vazgeç');
    const paused = render('paused', {}, async () => {
      throw new Error('Disconnected');
    });
    assert.equal(paused.button.props['aria-label'], 'Agentı devam ettir');
    paused.button.props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    assert.match(paused.errors[0], /Duraklatma durumu değiştirilemedi/);
    i18nCore.setLocale('en');
    assert.equal(render('paused').button.props['aria-label'], 'Resume agent');
  } finally {
    i18nCore.setLocale('en');
  }
});
