import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { i18n, runInNewContext } from './helpers/i18n-vm.mjs';

const exports = {};
const element = (type, props) => ({ type, props });
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../../../packages/cockpit-ui/src/components/AgentMessageQueue.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
  {
    exports,
    require: (name) => {
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'lucide-react')
        return Object.fromEntries(
          ['ArrowDown', 'ArrowUp', 'ListOrdered', 'Loader2', 'Play', 'X'].map((icon) => [
            icon,
            icon,
          ]),
        );
      throw new Error(`Unexpected import ${name}`);
    },
  },
);

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'object') return text(node.props?.children);
  return String(node);
}

const queued = (requestId, extra = {}) => ({
  request_id: requestId,
  prompt: `User message ${requestId}`,
  state: 'queued',
  ...extra,
});

function render(overrides = {}) {
  return descendants(
    exports.AgentMessageQueue({
      entries: [queued('first'), queued('second')],
      paused: false,
      onRemove: () => {},
      onMove: () => {},
      onResume: () => {},
      onSendNow: () => {},
      ...overrides,
    }),
  );
}

const sendButtons = (nodes) =>
  nodes.filter((node) => node.type === 'button' && text(node) === i18n.t('Send now'));
const namedButton = (nodes, label) => {
  const node = nodes.find(
    (entry) => entry.type === 'button' && entry.props['aria-label'] === label,
  );
  assert(node, `Expected button ${label}`);
  return node;
};
const click = (node) => {
  if (node.props.disabled) return false;
  node.props.onClick();
  return true;
};

test('normal queue exposes Send now for each selected request and leaves user text intact', () => {
  const sent = [];
  const nodes = render({ onSendNow: (id) => sent.push(id) });
  const buttons = sendButtons(nodes);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props['aria-label'], 'Send queued message 1 now');
  assert.equal(buttons[1].props['aria-label'], 'Send queued message 2 now');
  assert.equal(
    buttons[1].props.title,
    'Stop the current turn and send this message in the same conversation.',
  );
  assert.equal(click(buttons[1]), true);
  assert.deepEqual(sent, ['second']);
  assert(nodes.some((node) => node.type === 'p' && text(node) === 'User message second'));
});

test('an active turn disables Resume but keeps Send now available', () => {
  const sent = [];
  const nodes = render({ disabled: true, paused: true, onSendNow: (id) => sent.push(id) });
  const resume = nodes.find((node) => node.type === 'button' && text(node) === 'Resume queue');
  assert(resume.props.disabled);
  assert.equal(click(sendButtons(nodes)[0]), true);
  assert.deepEqual(sent, ['first']);
});

test('Send now cannot run when blocked or another queued turn is sending or interrupting', () => {
  for (const overrides of [
    { sendNowDisabled: true },
    { entries: [queued('first'), queued('second', { state: 'sending' })] },
    { entries: [queued('first'), queued('second', { state: 'interrupting' })] },
  ]) {
    const sent = [];
    const buttons = sendButtons(render({ ...overrides, onSendNow: (id) => sent.push(id) }));
    assert.equal(buttons.length, 2);
    for (const button of buttons) assert.equal(click(button), false);
    assert.deepEqual(sent, []);
  }
});

test('interrupting shows progress and prevents queue changes until the current turn stops', () => {
  const nodes = render({
    entries: [queued('first'), queued('second', { state: 'interrupting' }), queued('third')],
    paused: true,
  });
  assert(nodes.some((node) => node.type === 'span' && text(node) === 'Stopping current turn…'));
  assert.equal(nodes.filter((node) => node.type === 'Loader2').length, 1);
  for (const button of nodes.filter((node) => node.type === 'button')) {
    assert(
      button.props.disabled,
      `Expected ${text(button) || button.props['aria-label']} disabled`,
    );
  }
});

test('failed queued messages can be sent again using the existing request identity', () => {
  const sent = [];
  const nodes = render({
    entries: [queued('failed-request', { state: 'failed', error: 'Provider response' })],
    onSendNow: (id) => sent.push(id),
  });
  assert.equal(click(sendButtons(nodes)[0]), true);
  assert.deepEqual(sent, ['failed-request']);
  assert(nodes.some((node) => node.props.role === 'alert' && text(node) === 'Provider response'));
});

test('dependency queues retain Start now and do not offer same-conversation Send now', () => {
  let started = 0;
  const overrides = {
    entries: [
      queued('first', { startAfter: { sessionId: 'dependency', title: 'Other conversation' } }),
      queued('second'),
    ],
    onStartNow: () => started++,
  };
  const nodes = render(overrides);
  assert.equal(sendButtons(nodes).length, 0);
  const start = nodes.find((node) => node.type === 'button' && text(node) === 'Start now');
  assert.equal(click(start), true);
  assert.equal(started, 1);
  const blocked = render({ ...overrides, disabled: true }).find(
    (node) => node.type === 'button' && text(node) === 'Start now',
  );
  assert.equal(click(blocked), false);
  assert.equal(started, 1);
});

test('existing queue actions preserve selected request IDs and movement directions', () => {
  const moved = [];
  const removed = [];
  const nodes = render({
    onMove: (id, direction) => moved.push([id, direction]),
    onRemove: (id) => removed.push(id),
  });
  assert.equal(click(namedButton(nodes, 'Move queued message 1 up')), false);
  assert.equal(click(namedButton(nodes, 'Move queued message 2 down')), false);
  assert.equal(click(namedButton(nodes, 'Move queued message 1 down')), true);
  assert.equal(click(namedButton(nodes, 'Move queued message 2 up')), true);
  assert.equal(click(namedButton(nodes, 'Remove queued message 2')), true);
  assert.deepEqual(moved, [
    ['first', 1],
    ['second', -1],
  ]);
  assert.deepEqual(removed, ['second']);
});

test('queue supports English and Turkish labels, accessible descriptions, and progress', () => {
  try {
    for (const [locale, label] of [
      ['en', 'Send now'],
      ['tr', 'Hemen gönder'],
    ]) {
      i18n.setLocale(locale, false);
      const nodes = render();
      const send = sendButtons(nodes)[0];
      assert.equal(text(send), label);
      assert.equal(
        send.props['aria-label'],
        i18n.t('Send queued message {position} now', { position: 1 }),
      );
      assert.equal(
        send.props.title,
        i18n.t('Stop the current turn and send this message in the same conversation.'),
      );
      const stopping = render({ entries: [queued('first', { state: 'interrupting' })] });
      assert(
        stopping.some(
          (node) => node.type === 'span' && text(node) === i18n.t('Stopping current turn…'),
        ),
      );
      assert(nodes.some((node) => node.type === 'p' && text(node) === 'User message first'));
      if (locale === 'tr') {
        assert.notEqual(send.props['aria-label'], 'Send queued message 1 now');
        assert.notEqual(
          send.props.title,
          'Stop the current turn and send this message in the same conversation.',
        );
        assert.notEqual(i18n.t('Stopping current turn…'), 'Stopping current turn…');
      }
    }
  } finally {
    i18n.setLocale('en', false);
  }
});

test('no queue renders when empty and optional Send now callback is respected', () => {
  assert.equal(render({ entries: [] }).length, 0);
  assert.equal(sendButtons(render({ onSendNow: undefined })).length, 0);
});
