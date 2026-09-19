import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const sources = new Map();
for (const [name, file] of [
  ['card', 'components/AgentRequestCard.tsx'],
  ['./AgentQuestionField', 'components/AgentQuestionField.tsx'],
  ['../lib/agentRequestAnswers', 'lib/agentRequestAnswers.ts'],
]) {
  sources.set(
    name,
    ts.transpileModule(
      readFileSync(new URL(`../../../packages/cockpit-ui/src/${file}`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
  );
}

const question = (id, options = [], extra = {}) => ({
  id,
  question: `Question ${id}?`,
  options,
  multiple: false,
  secret: false,
  ...extra,
});
const request = (questions, extra = {}) => ({
  id: 'request-1',
  title: 'Agent needs your input',
  kind: 'question',
  details: '',
  questions,
  choices: null,
  schema: null,
  ...extra,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const text = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'object') return text(node.props?.children);
  return String(node);
};

// Run the real components with persistent hook slots, JSX, and the browser's disabled-fieldset
// event gate. This tests interactions and payloads without coupling tests to hook indexes.
function mount(initialProps) {
  const slots = [];
  const modules = new Map();
  let cursor = 0;
  let props = { ...initialProps };
  let nodes;
  const react = {
    useId: () => 'request-card',
    useEffect: () => {},
    useRef: (value) => {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
  };
  const element = (type, elementProps) => ({ type, props: elementProps });
  const load = (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'lucide-react') return {};
    if (name === '../lib/cn') return { cn: (...values) => values.filter(Boolean).join(' ') };
    // The shared picker owns its own popover behavior; stand in for it with the native control it
    // replaced so these tests stay about the request payload rather than the picker's internals.
    if (name === './SearchableSelect')
      return {
        SearchableSelect: ({ label, value, options, onChange, disabled, placeholder }) =>
          element('select', {
            'aria-label': label,
            value,
            disabled,
            onChange: (event) => onChange(event.target.value),
            children: [
              element('option', { value: '', children: placeholder ?? 'Choose…' }),
              ...options.map((option) =>
                element('option', { value: option.value, children: option.label }),
              ),
            ],
          }),
      };
    if (modules.has(name)) return modules.get(name);
    assert(sources.has(name), `Unexpected import ${name}`);
    const exports = {};
    modules.set(name, exports);
    runInNewContext(sources.get(name), { exports, require: load });
    return exports;
  };
  const { AgentRequestCard } = load('card');
  const visit = (node, disabled = false, form = null) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, disabled, form));
      return;
    }
    if (typeof node.type === 'function') {
      visit(node.type(node.props), disabled, form);
      return;
    }
    const current = {
      ...node,
      disabled: disabled || !!node.props.disabled,
      form: node.type === 'form' ? node : form,
    };
    nodes.push(current);
    visit(node.props.children, current.disabled, current.form);
  };
  const render = () => {
    cursor = 0;
    nodes = [];
    visit(AgentRequestCard(props));
  };
  render();
  return {
    all: () => nodes,
    find: (predicate) => {
      const node = nodes.find(predicate);
      assert(node, 'Expected control is rendered');
      return node;
    },
    button(label) {
      return this.find((node) => node.type === 'button' && text(node) === label);
    },
    choice(label) {
      const index = nodes.findIndex((node) => node.type === 'label' && text(node).includes(label));
      assert(index >= 0, `Expected choice ${label}`);
      return nodes.slice(index + 1).find((node) => node.type === 'input');
    },
    click(node) {
      if (node.disabled) return false;
      node.props.onClick?.();
      if (node.props.type === 'submit') node.form.props.onSubmit({ preventDefault() {} });
      render();
      return true;
    },
    change(node, value) {
      if (node.disabled) return false;
      node.props.onChange({ target: { value, checked: value } });
      render();
      return true;
    },
    submit() {
      this.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
      render();
    },
    update(next) {
      props = { ...props, ...next };
      render();
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
  };
}

test('wizard preserves drafts when going back and sends every answer exactly once', async () => {
  const sent = [];
  const pending = deferred();
  const h = mount({
    request: request([question('observed'), question('expected'), question('steps')]),
    onAnswer: (value) => {
      sent.push(plain(value));
      return pending.promise;
    },
  });
  const input = () => h.find((node) => node.type === 'textarea');
  h.change(input(), '  Crashes on save  ');
  h.click(h.button('Next question'));
  h.change(input(), 'Saves successfully');
  h.click(h.button('Back'));
  assert.equal(input().props.value, '  Crashes on save  ');
  h.click(h.button('Next question'));
  assert.equal(input().props.value, 'Saves successfully');
  h.click(h.button('Next question'));
  h.change(input(), 'Open\nEdit\nSave');
  assert.equal(sent.length, 0);
  const submit = h.find((node) => node.type === 'form').props.onSubmit;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  h.update({});
  assert.deepEqual(sent, [
    {
      answers: {
        observed: ['Crashes on save'],
        expected: ['Saves successfully'],
        steps: ['Open\nEdit\nSave'],
      },
    },
  ]);
  assert(
    h
      .all()
      .filter((node) => node.type === 'button')
      .every((node) => node.disabled),
  );
  assert.equal(h.change(input(), 'Should not change'), false);
  h.submit();
  assert.equal(sent.length, 1);
  pending.resolve();
  await h.settle();
  assert(h.all().some((node) => node.props.role === 'status' && text(node) === 'Response sent'));
});

test('whitespace and skipped questions cannot reach submission', () => {
  let calls = 0;
  const h = mount({
    request: request([question('first'), question('last')]),
    onAnswer: async () => calls++,
  });
  h.change(
    h.find((node) => node.type === 'textarea'),
    '   ',
  );
  h.click(h.button('Next question'));
  assert(h.all().some((node) => node.props.role === 'alert'));
  h.click(h.find((node) => node.props['aria-label'] === 'Question 2: Question last?'));
  h.change(
    h.find((node) => node.type === 'textarea'),
    'Last answer',
  );
  h.click(h.button('Send answers'));
  assert.equal(calls, 0);
  assert(h.all().some((node) => node.type === 'legend' && text(node) === 'Question first?'));
  assert(h.all().some((node) => node.props.role === 'alert'));
});

test('choosing an option deactivates a custom answer while retaining its editable draft', async () => {
  const sent = [];
  const h = mount({
    request: request([
      question('mode', [
        { label: 'First', value: 'opaque-first' },
        { label: 'Second', value: 'opaque-second' },
      ]),
    ]),
    onAnswer: async (value) => sent.push(plain(value)),
  });
  h.click(h.button('Write your own answer'));
  h.change(
    h.find((node) => node.type === 'textarea'),
    'Keep this draft',
  );
  h.change(h.choice('Second'), true);
  assert(!h.all().some((node) => node.type === 'textarea'));
  h.click(h.button('Write your own answer'));
  assert.equal(h.find((node) => node.type === 'textarea').props.value, 'Keep this draft');
  h.change(h.choice('First'), true);
  h.click(h.button('Send answer'));
  await h.settle();
  assert.deepEqual(sent, [{ answers: { mode: ['opaque-first'] } }]);
});

test('multiple choices combine provider values with a trimmed custom answer', async () => {
  const sent = [];
  const h = mount({
    request: request([
      question(
        'features',
        [
          { label: 'A', value: 'a-id' },
          { label: 'B', value: 'b-id' },
        ],
        {
          multiple: true,
        },
      ),
    ]),
    onAnswer: async (value) => sent.push(plain(value)),
  });
  h.change(h.choice('A'), true);
  h.change(h.choice('B'), true);
  h.change(h.choice('A'), false);
  h.change(h.choice('A'), true);
  h.click(h.button('Add your own answer'));
  h.change(
    h.find((node) => node.type === 'textarea'),
    '  Extra feature  ',
  );
  h.click(h.button('Send answer'));
  await h.settle();
  assert.deepEqual(sent, [{ answers: { features: ['b-id', 'a-id', 'Extra feature'] } }]);
});

test('provider-restricted questions expose only offered options and preserve their IDs', async () => {
  const sent = [];
  const h = mount({
    request: request([
      question('cursor', [{ label: 'Continue', value: 'opt-9' }], { allow_custom: false }),
    ]),
    onAnswer: async (value) => sent.push(plain(value)),
  });
  assert(!h.all().some((node) => node.type === 'textarea' || node.props.type === 'password'));
  assert(!h.all().some((node) => node.type === 'button' && text(node).includes('own answer')));
  h.change(h.choice('Continue'), true);
  assert.equal(h.choice('Continue').props.checked, true);
  h.click(h.button('Send answer'));
  await h.settle();
  assert.deepEqual(sent, [{ answers: { cursor: ['opt-9'] } }]);
});

test('secret input remains masked and disabled state blocks fields, navigation, and submit', () => {
  let calls = 0;
  const h = mount({
    request: request([question('token', [], { secret: true }), question('next')]),
    onAnswer: async () => calls++,
  });
  h.change(
    h.find((node) => node.props.type === 'password'),
    'private-token',
  );
  h.update({ disabled: true });
  const password = h.find((node) => node.props.type === 'password');
  assert.equal(password.props.autoComplete, 'off');
  assert.equal(h.change(password, 'changed'), false);
  assert.equal(h.click(h.button('Next question')), false);
  h.submit();
  assert.equal(password.props.value, 'private-token');
  assert.equal(calls, 0);
  assert(
    h
      .all()
      .filter((node) => node.type === 'button')
      .every((node) => node.disabled),
  );
  assert(!h.all().some((node) => text(node).includes('private-token')));
});

test('submission failures preserve answers and allow an explicit retry', async () => {
  const sent = [];
  const h = mount({
    request: request([question('answer')]),
    onAnswer: async (value) => {
      sent.push(plain(value));
      if (sent.length === 1) throw new Error('Connection lost');
    },
  });
  h.change(
    h.find((node) => node.type === 'textarea'),
    'Retry this answer',
  );
  h.click(h.button('Send answer'));
  await h.settle();
  assert(
    h.all().some((node) => node.props.role === 'alert' && text(node).includes('Connection lost')),
  );
  assert.equal(h.find((node) => node.type === 'textarea').props.value, 'Retry this answer');
  h.click(h.button('Send answer'));
  await h.settle();
  assert.deepEqual(sent, [
    { answers: { answer: ['Retry this answer'] } },
    { answers: { answer: ['Retry this answer'] } },
  ]);
  assert(h.all().some((node) => node.props.role === 'status'));
});

test('forms preserve false, zero, schema defaults, and omit absent optional fields', async () => {
  const sent = [];
  const h = mount({
    request: request(null, {
      kind: 'form',
      schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: false },
          count: { type: 'integer', default: 0 },
          name: { type: 'string', default: 'Default name' },
          optional: { type: 'string' },
        },
        required: ['enabled', 'count', 'name'],
      },
    }),
    onAnswer: async (value) => sent.push(plain(value)),
  });
  h.change(
    h.find((node) => node.type === 'select'),
    'false',
  );
  h.change(
    h.find((node) => node.props.type === 'number'),
    '0',
  );
  h.click(h.button('Submit response'));
  await h.settle();
  assert.deepEqual(sent, [
    { action: 'accept', content: { enabled: false, count: 0, name: 'Default name' } },
  ]);
});

test('form fields and decline are disabled while an answer is pending', async () => {
  const pending = deferred();
  const sent = [];
  const h = mount({
    request: request(null, { kind: 'form', schema: { properties: { name: { type: 'string' } } } }),
    onAnswer: (value) => {
      sent.push(plain(value));
      return pending.promise;
    },
  });
  h.click(h.button('Submit response'));
  assert.equal(
    h.change(
      h.find((node) => node.type === 'input'),
      'changed',
    ),
    false,
  );
  assert.equal(h.click(h.button('Decline')), false);
  h.submit();
  assert.equal(sent.length, 1);
  pending.resolve();
  await h.settle();
});

test('object approval choices are passed through without transformation', async () => {
  const decision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } };
  let actual;
  const h = mount({
    request: request(null, {
      kind: 'approval',
      choices: [{ label: 'Allow proposed policy change', value: decision }],
    }),
    onAnswer: async (value) => {
      actual = value.decision;
    },
  });
  h.click(h.button('Allow proposed policy change'));
  await h.settle();
  assert.equal(actual, decision);
});

test('URL forms open the supplied URL and confirm without invented content', async () => {
  const opened = [];
  const sent = [];
  const h = mount({
    request: request(null, { kind: 'form', url: 'https://example.com/authorize' }),
    onOpenUrl: async (url) => opened.push(url),
    onAnswer: async (value) => sent.push(plain(value)),
  });
  h.click(h.button('https://example.com/authorize'));
  h.click(h.button('I’ve completed this'));
  await h.settle();
  assert.deepEqual(opened, ['https://example.com/authorize']);
  assert.deepEqual(sent, [{ action: 'accept' }]);
});
