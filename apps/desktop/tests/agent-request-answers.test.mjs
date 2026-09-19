import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../../../packages/cockpit-ui/src/lib/agentRequestAnswers.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const { getAgentQuestionAnswers, collectAgentRequestAnswers } = exports;
const question = (properties = {}) => ({
  id: 'scope',
  question: 'Which scope should change?',
  options: [
    { label: 'Current project', value: 'project:current' },
    { label: 'All projects', value: 'project:all' },
  ],
  multiple: false,
  secret: false,
  ...properties,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test('custom single answers replace a selected option and only trim outer whitespace', () => {
  const selected = { scope: ['project:current'] };
  const custom = { scope: '  Preserve   internal spacing\nand line breaks.\n  ' };
  assert.deepEqual(Array.from(getAgentQuestionAnswers(question(), selected, custom)), [
    'Preserve   internal spacing\nand line breaks.',
  ]);
  assert.deepEqual(selected, { scope: ['project:current'] });
  assert.equal(custom.scope, '  Preserve   internal spacing\nand line breaks.\n  ');
});

test('multi-select answers retain provider values in order and append a custom answer', () => {
  const selected = Object.freeze({
    scope: Object.freeze(['project:all', 'project:current']),
  });
  const values = getAgentQuestionAnswers(question({ multiple: true }), selected, {
    scope: '  An additional project  ',
  });
  assert.deepEqual(Array.from(values), ['project:all', 'project:current', 'An additional project']);
});

test('option values remain opaque, including empty values and natural-language labels', () => {
  const supplied = question({
    multiple: true,
    options: [
      { label: "I'll describe it", value: 'custom:provider-choice' },
      { label: 'Use default', value: '' },
      { label: 'Label-only option' },
    ],
  });
  assert.deepEqual(
    Array.from(
      getAgentQuestionAnswers(
        supplied,
        { scope: ['custom:provider-choice', '', 'Label-only option'] },
        {},
      ),
    ),
    ['custom:provider-choice', '', 'Label-only option'],
  );
});

test('whitespace-only custom input keeps existing selections without aliasing their array', () => {
  const selected = { scope: ['project:current'] };
  const values = getAgentQuestionAnswers(question(), selected, { scope: ' \n\t ' });
  assert.deepEqual(Array.from(values), ['project:current']);
  values.push('project:all');
  assert.deepEqual(selected.scope, ['project:current']);
});

test('requests that forbid custom input ignore stale custom answers for single and multi select', () => {
  for (const multiple of [false, true]) {
    const supplied = question({ multiple, allow_custom: false });
    assert.deepEqual(
      Array.from(
        getAgentQuestionAnswers(supplied, { scope: ['project:current'] }, { scope: 'stale' }),
      ),
      ['project:current'],
    );
    assert.deepEqual(Array.from(getAgentQuestionAnswers(supplied, {}, { scope: 'stale' })), []);
  }
});

test('secret answers retain case, punctuation, spaces, and line breaks inside the value', () => {
  const secret = 'AbC  .+$\\/\nNext_Line';
  assert.deepEqual(
    Array.from(
      getAgentQuestionAnswers(question({ secret: true }), {}, { scope: ` \t${secret}\n ` }),
    ),
    [secret],
  );
});

test('completion and payload agree across answered, unanswered, and forbidden-custom questions', () => {
  const questions = [
    question({ id: 'selected' }),
    question({ id: 'written', options: [] }),
    question({ id: 'blank', options: [] }),
    question({ id: 'forbidden', allow_custom: false }),
    question({ id: 'missing' }),
  ];
  const result = collectAgentRequestAnswers(
    questions,
    { selected: ['project:current'], unrelated: ['ignore'] },
    { written: '  My answer  ', blank: ' \n ', forbidden: 'stale', unrelated: 'ignore' },
  );
  assert.deepEqual(plain(result), {
    answers: {
      selected: ['project:current'],
      written: ['My answer'],
      blank: [],
      forbidden: [],
      missing: [],
    },
    missingQuestionIds: ['blank', 'forbidden', 'missing'],
    answeredCount: 2,
  });
});

test('empty question lists produce an empty payload and no missing answers', () => {
  assert.deepEqual(plain(collectAgentRequestAnswers([], {}, {})), {
    answers: {},
    missingQuestionIds: [],
    answeredCount: 0,
  });
});

test('blank provider values remain intact but cannot count as completed answers', () => {
  const questions = [
    question({ id: 'empty', options: [{ label: 'Default', value: '' }] }),
    question({ id: 'spaces', options: [{ label: 'Whitespace', value: ' \n ' }] }),
    question({ id: 'mixed', multiple: true }),
    question({ id: 'padded' }),
  ];
  const selected = {
    empty: [''],
    spaces: [' \n '],
    mixed: ['project:current', ''],
    padded: [' project:current '],
  };
  assert.deepEqual(plain(collectAgentRequestAnswers(questions, selected, {})), {
    answers: selected,
    missingQuestionIds: ['empty', 'spaces', 'mixed'],
    answeredCount: 1,
  });
});
