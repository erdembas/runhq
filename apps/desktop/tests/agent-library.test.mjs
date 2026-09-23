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
    () => parseRecipeSteps(Array.from({ length: 65 }, () => ({ role: 'review', target: 'a' }))),
    /up to 64 tasks/,
  );
  assert.throws(() => parseRecipeSteps([{ role: 'review', target: 7 }]), /step target/);
});

test('a recipe saved before tasks had their own instructions reads as the chain it was', () => {
  // Nothing in this list says what depends on what, which is what an ordered list of roles meant.
  const migrated = parseRecipeSteps([
    { role: 'plan', target: 'claude', model: '', effort: '', mode: '' },
    { role: 'implement', target: 'codex', model: '', effort: '', mode: '' },
    { role: 'review', target: 'claude', model: '', effort: '', mode: '' },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(migrated)).map((step) => [
      step.id,
      step.dependsOn,
      step.prompt,
      step.workspace,
    ]),
    [
      ['s1', [], '', 'shared'],
      ['s2', ['s1'], '', 'shared'],
      ['s3', ['s2'], '', 'shared'],
    ],
  );
  // A list that declares a graph keeps it, rather than having a chain forced on it.
  const graph = parseRecipeSteps([
    { id: 'api', role: 'implement', target: 'codex', prompt: 'write the endpoint' },
    { id: 'ui', role: 'implement', target: 'codex', dependsOn: [], workspace: 'own' },
    { id: 'rev', role: 'review', target: 'claude', dependsOn: ['api', 'ui'] },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(graph)).map((step) => [step.id, step.dependsOn]),
    [
      ['api', []],
      ['ui', []],
      ['rev', ['api', 'ui']],
    ],
  );
  assert.equal(graph[0].prompt, 'write the endpoint');
  // An imported file is untrusted, so a graph that cannot run is refused before it is offered.
  assert.throws(
    () => parseRecipeSteps([{ id: 'a', role: 'implement', target: 'codex', dependsOn: ['b'] }]),
    /unknown task/,
  );
  assert.throws(
    () =>
      parseRecipeSteps([
        { id: 'a', role: 'implement', target: 'codex', dependsOn: ['b'] },
        { id: 'b', role: 'review', target: 'claude', dependsOn: ['a'] },
      ]),
    /not declared before it/,
  );
  assert.throws(
    () =>
      parseRecipeSteps([
        { id: 'a', role: 'implement', target: 'codex' },
        { id: 'a', role: 'review', target: 'claude', dependsOn: ['a'] },
      ]),
    /unique keys/,
  );
  assert.throws(
    () => parseRecipeSteps([{ id: 'a', role: 'implement', target: 'codex', workspace: 'branch' }]),
    /step checkout/,
  );
});

test('a parameter inside a task instruction is asked for and substituted', () => {
  const saved = parseRecipe({
    ...recipe,
    prompt: 'Start work',
    workflowSteps: [
      { id: 'api', role: 'implement', target: 'codex', prompt: 'Fix {{ticket}} in the API' },
      { id: 'rev', role: 'review', target: 'claude', dependsOn: ['api'] },
    ],
  });
  // The task's own instruction is scanned alongside everything else the recipe asks for.
  assert.ok([...recipeParameters(saved)].includes('ticket'));
  const resolved = resolveRecipe(saved, { ticket: 'RUN-42', branch: 'main', goal: 'none' });
  assert.equal(resolved.workflowSteps[0].prompt, 'Fix RUN-42 in the API');
  // Resolving hands back a copy; the saved recipe still asks the question.
  assert.equal(saved.workflowSteps[0].prompt, 'Fix {{ticket}} in the API');
  assert.throws(
    () => resolveRecipe(saved, { branch: 'main', goal: 'none' }),
    /Enter a value for ticket/,
  );
});
