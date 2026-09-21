import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { TextEncoder } from 'node:util';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL('../src/components/agents/agentLibraryModel.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports, TextEncoder },
);
const {
  parseRecipeSteps,
  parseRecipe,
  portableAgentRecipe,
  recipeParameters,
  resolveRecipe,
  buildAgentContextPrompt,
  agentContextImages,
} = exports;
const recipe = {
  id: 'recipe',
  name: 'Review',
  prompt: 'Review {{branch}} and {{branch}}',
  backend: 'codex',
  model: '',
  effort: '',
  agent: '',
  mode: 'plan',
  isolated: true,
  acceptance: '{{goal}}',
  setupCommands: '',
  checkCommands: 'test {{branch}}',
  version: 1,
};

test('recipe parameters are unique, required, literal substitutions and do not mutate saved recipes', () => {
  assert.deepEqual([...recipeParameters(recipe.prompt)], ['branch']);
  assert.throws(() => resolveRecipe(recipe, { branch: 'main' }), /goal/);
  const next = resolveRecipe(recipe, { branch: '$&', goal: 'No regressions' });
  assert.equal(next.prompt, 'Review $& and $&');
  assert.equal(next.checkCommands, 'test $&');
  assert.equal(recipe.acceptance, '{{goal}}');
});
test('invalid imported recipes are rejected before storage', () => {
  assert.equal(parseRecipe(recipe).name, 'Review');
  assert.throws(() => parseRecipe({ ...recipe, isolated: 'false' }));
  assert.throws(() => parseRecipe({ ...recipe, prompt: '' }));
  assert.throws(() => parseRecipe({ ...recipe, version: -1 }));
  const portable = portableAgentRecipe({
    ...recipe,
    projectId: 'private-project',
    sourceSessionId: 'live-task',
    executable: '/unexpected/command',
  });
  assert.equal(portable.projectId, undefined);
  assert.equal(portable.sourceSessionId, undefined);
  assert.equal(portable.executable, undefined);
});
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

test('a recipe can save a division of labour, and refuses one it cannot run', () => {
  const steps = [
    { role: 'plan', target: 'claude', model: 'sonnet', effort: '', mode: '' },
    { role: 'implement', target: 'codex', model: '', effort: '', mode: '' },
    { role: 'review', target: 'pool:claude', model: '', effort: '', mode: '' },
  ];
  const saved = parseRecipe({ ...recipe, workflowSteps: steps });
  assert.deepEqual(
    JSON.parse(JSON.stringify(saved.workflowSteps)).map((s) => [s.role, s.target]),
    [
      ['plan', 'claude'],
      ['implement', 'codex'],
      ['review', 'pool:claude'],
    ],
  );
  // No steps means what a recipe always meant: its single agent implements and reviews.
  assert.equal(parseRecipe(recipe).workflowSteps, undefined);
  assert.deepEqual([...parseRecipeSteps(undefined)], []);
  // A recipe is imported from a file, so an unknown role must not reach a workflow.
  assert.throws(() => parseRecipeSteps([{ role: 'deploy', target: 'codex' }]), /step role/);
  assert.throws(() => parseRecipeSteps('two steps'), /Invalid recipe steps/);
  assert.throws(
    () => parseRecipeSteps(Array.from({ length: 9 }, () => ({ role: 'review', target: 'a' }))),
    /up to 8 steps/,
  );
  assert.throws(() => parseRecipeSteps([{ role: 'review', target: 7 }]), /step target/);
});
