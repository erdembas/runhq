import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// These modules are plain logic over plain data, so they are run in this realm rather than a fresh
// one: an array built inside a vm realm is not deep-equal to an array built out here, and the
// assertions are about the values, not about where they were made.
function load(path, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function('exports', 'require', source);
  run(exports, (name) => {
    if (modules[name]) return modules[name];
    throw new Error(name);
  });
  return exports;
}
const graph = load('../src/components/agents/agentWorkflowGraph.ts');
const policy = load('../src/components/agents/agentWorkflowStepPolicy.ts', {
  './agentWorkflowGraph': graph,
});
const bridge = load('../src/components/agents/agentWorkflowRecipeBridge.ts');
const library = load('../src/components/agents/agentLibraryModel.ts');

const task = (id, role, depends_on = [], extra = {}) => ({
  id,
  role,
  target: 'codex',
  model: '',
  effort: '',
  mode: '',
  prompt: `do ${id}`,
  depends_on,
  workspace: 'shared',
  ...extra,
});
const step = (id, role, depends_on, status, extra = {}) => ({
  ...task(id, role, depends_on),
  session_id: `session-${id}`,
  input_step_id: depends_on[0] ?? null,
  status,
  input_revision: null,
  cwd: null,
  root: null,
  output_tree: null,
  output_revision: null,
  merge: null,
  generation: 0,
  started_at: null,
  finished_at: null,
  error: null,
  ...extra,
});
/** api → {ui, docs} → rev: the shape the whole feature exists for. */
const diamond = () => [
  task('api', 'implement'),
  task('ui', 'implement', ['api'], { workspace: 'own' }),
  task('docs', 'implement', ['api'], { workspace: 'own' }),
  task('rev', 'review', ['ui', 'docs']),
];

test('a diamond is ordered, levelled and read back as its dependencies', () => {
  const tasks = diamond();
  const { order, cycle } = graph.workflowTopologicalOrder(tasks);
  assert.equal(cycle, null);
  assert.ok(order.indexOf('api') < order.indexOf('ui'));
  assert.ok(order.indexOf('docs') < order.indexOf('rev'));
  assert.deepEqual(graph.workflowTaskLevels(tasks), { api: 0, ui: 1, docs: 1, rev: 2 });
  assert.deepEqual(graph.workflowDependents(tasks).api, ['ui', 'docs']);
  assert.deepEqual([...graph.workflowAncestors(tasks, 'rev')].sort(), ['api', 'docs', 'ui']);
  assert.deepEqual([...graph.workflowDescendants(tasks, 'api')].sort(), ['docs', 'rev', 'ui']);
});

test('a cycle is named rather than ordered', () => {
  const tasks = [
    task('a', 'implement', ['c']),
    task('b', 'implement', ['a']),
    task('c', 'review', ['b']),
  ];
  const { order, cycle } = graph.workflowTopologicalOrder(tasks);
  assert.deepEqual(order, []);
  assert.ok(cycle.includes('a') && cycle.includes('b') && cycle.includes('c'));
});

test('a graph authored in a different row order submits dependencies first without losing instructions', () => {
  const tasks = diamond().reverse();
  const sorted = graph.workflowTasksInExecutionOrder(tasks);
  const seen = new Set();
  for (const task of sorted) {
    assert.ok(task.depends_on.every((id) => seen.has(id)));
    assert.equal(
      task,
      tasks.find((original) => original.id === task.id),
    );
    seen.add(task.id);
  }
  assert.equal(tasks[0].id, 'rev', 'ordering a submission does not reorder the draft');
  assert.throws(
    () =>
      graph.workflowTasksInExecutionOrder([
        task('a', 'implement', ['b']),
        task('b', 'review', ['a']),
      ]),
    /depend on each other/,
  );
  assert.throws(
    () => graph.workflowTasksInExecutionOrder([task('a', 'implement', ['missing'])]),
    /unknown task/,
  );
  assert.throws(
    () => graph.workflowTasksInExecutionOrder([task('a', 'implement'), task('a', 'review')]),
    /unique/,
  );
});

test('editing a collapsed instruction preserves every remaining line', () => {
  assert.equal(
    policy.replaceWorkflowTaskSummary('Fix API\nKeep compatibility\n\nRun tests', 'Fix endpoint'),
    'Fix endpoint\nKeep compatibility\n\nRun tests',
  );
  assert.equal(policy.replaceWorkflowTaskSummary('Fix API', 'Fix endpoint'), 'Fix endpoint');
});

test('an editor graph survives recipe save and reload with its dependencies and instructions', () => {
  const authored = diamond().reverse();
  const saved = library.parseRecipeSteps(
    bridge.createStepsToRecipeSteps(graph.workflowTasksInExecutionOrder(authored)),
  );
  const restored = bridge.recipeStepsToCreateSteps(saved);
  assert.equal(policy.workflowStepsProblem(restored), null);
  for (const task of authored) {
    assert.deepEqual(
      restored.find((entry) => entry.id === task.id),
      task,
    );
  }
});

test('a dependency that would close a loop is refused before it is drawn', () => {
  const tasks = diamond();
  assert.equal(graph.workflowWouldCycle(tasks, 'api', 'rev'), true);
  assert.equal(graph.workflowWouldCycle(tasks, 'api', 'api'), true);
  assert.equal(graph.workflowWouldCycle(tasks, 'rev', 'api'), false);
});

test('only tasks whose dependencies finished and landed can start', () => {
  const steps = [
    step('api', 'implement', [], 'completed'),
    step('ui', 'implement', ['api'], 'pending', { workspace: 'own' }),
    step('rev', 'review', ['ui'], 'pending'),
  ];
  assert.deepEqual(
    graph.workflowRunnableTasks(steps).map((s) => s.id),
    ['ui'],
  );
  assert.deepEqual(graph.workflowBlockedBy(steps, 'rev'), ['ui']);

  // Finished in its own checkout is not the same as applied to the shared one.
  steps[1].status = 'completed';
  assert.deepEqual(graph.workflowBlockedBy(steps, 'rev'), ['ui']);
  steps[1].merge = { status: 'applied' };
  assert.deepEqual(graph.workflowBlockedBy(steps, 'rev'), []);

  // A failed dependency does not unblock anything either.
  steps[1].status = 'failed';
  assert.deepEqual(graph.workflowBlockedBy(steps, 'rev'), ['ui']);
});

test('lanes put what needs a person first, then running, ready and blocked', () => {
  const steps = [
    step('api', 'implement', [], 'completed'),
    step('ui', 'implement', ['api'], 'running'),
    step('docs', 'implement', ['api'], 'pending'),
    step('rev', 'review', ['ui', 'docs'], 'pending'),
    step('old', 'implement', [], 'failed'),
  ];
  const sessions = { 'session-ui': { status: 'running', pending: [{ id: 'permission' }] } };
  const lanes = graph.groupWorkflowTasks(steps, sessions);
  assert.deepEqual(
    lanes.attention.map((s) => s.id),
    ['ui', 'old'],
    'an agent waiting on the person comes before the fact that it is running',
  );
  assert.deepEqual(
    lanes.ready.map((s) => s.id),
    ['docs'],
  );
  assert.deepEqual(
    lanes.blocked.map((s) => s.id),
    ['rev'],
  );
  assert.deepEqual(
    lanes.completed.map((s) => s.id),
    ['api'],
  );
  const total = Object.values(lanes).reduce((sum, lane) => sum + lane.length, 0);
  assert.equal(total, steps.length, 'every task is in exactly one lane');
  assert.equal(graph.workflowProgress(steps, sessions).attention, 2);
});

test('a conflicted result asks for the person, whatever its step status says', () => {
  const steps = [
    step('ui', 'implement', [], 'completed', {
      workspace: 'own',
      merge: { status: 'conflict', conflict: 'README.md' },
    }),
  ];
  assert.equal(graph.workflowTaskLane(steps[0]), 'attention');
});

test('tasks that could run at once, and producers nobody reviews, are found', () => {
  const tasks = diamond();
  assert.deepEqual(graph.workflowConcurrentProducerPairs(tasks), [['ui', 'docs']]);
  assert.deepEqual(graph.workflowUnreviewedProducers(tasks), []);
  const chain = [task('api', 'implement'), task('rev', 'review', ['api'])];
  assert.deepEqual(graph.workflowConcurrentProducerPairs(chain), []);
  const partial = [...diamond().slice(0, 3), task('rev', 'review', ['ui'])];
  assert.deepEqual(graph.workflowUnreviewedProducers(partial), ['docs']);
});

test('state is asked for often while agents move and rarely while they do not', () => {
  const idle = [{ stage: 'review_ready', steps: [step('a', 'implement', [], 'completed')] }];
  assert.equal(graph.workflowPollInterval(idle), 5000);
  assert.equal(
    graph.workflowPollInterval([
      { stage: 'implementing', steps: [step('a', 'implement', [], 'running')] },
    ]),
    1500,
  );
});

test('a valid graph has nothing that stops it', () => {
  const problems = policy.workflowTasksProblems(diamond());
  assert.equal(policy.workflowStepsProblem(diamond()), null);
  // The one thing left to say about a fan-out is that its results land one after another.
  assert.ok(problems.every((problem) => problem.severity === 'warning'));
  assert.ok(problems.every((problem) => /applied one after the other/.test(problem.message)));
});

test('each rule names the task it is about', () => {
  const only = (tasks) => policy.workflowTasksProblems(tasks).filter((p) => p.severity === 'error');
  const cases = [
    [[], null, /at least one task/],
    [[task('api', 'implement'), task('api', 'review', ['api'])], 'api', /unique/],
    [[{ ...task('API', 'implement') }], null, /lowercase letters/],
    [
      [{ ...task('api', 'implement'), prompt: '  ' }, task('rev', 'review', ['api'])],
      'api',
      /no instruction/,
    ],
    [
      [{ ...task('api', 'implement'), target: '' }, task('rev', 'review', ['api'])],
      'api',
      /needs an account/,
    ],
    [[task('api', 'implement'), task('rev', 'review', ['nope'])], 'rev', /not a task here/],
    [[task('rev', 'review')], 'rev', /nothing has produced yet/],
    [
      [task('api', 'implement'), task('rev', 'review', ['api'], { workspace: 'own' })],
      'rev',
      /runs where it reviews/,
    ],
  ];
  for (const [tasks, taskId, pattern] of cases) {
    const problems = only(tasks);
    assert.ok(problems.length, `expected a problem for ${pattern}`);
    const found = problems.find((problem) => pattern.test(problem.message));
    assert.ok(found, `expected ${pattern} in ${problems.map((p) => p.message).join(' | ')}`);
    if (taskId) assert.equal(found.taskId, taskId);
  }
});

test('two producers that would share the shared checkout are refused, with the repair', () => {
  const tasks = [
    task('ui', 'implement'),
    task('docs', 'implement'),
    task('rev', 'review', ['ui', 'docs']),
  ];
  const problem = policy
    .workflowTasksProblems(tasks)
    .find((entry) => entry.fix === 'isolate-concurrent-producers');
  assert.ok(problem, 'the clash is stated');
  assert.match(problem.message, /at the same time/);
  const fixed = policy.isolateConcurrentProducers(tasks);
  assert.deepEqual(
    fixed.map((entry) => entry.workspace),
    ['own', 'own', 'shared'],
  );
  assert.equal(policy.workflowStepsProblem(fixed), null);
  // Applying results one after another is worth saying, but it does not stop anything.
  assert.ok(policy.workflowTasksProblems(fixed).every((entry) => entry.severity === 'warning'));
});

test('a workflow needs a review of the finished work, not of one branch', () => {
  const tasks = [
    task('api', 'implement'),
    task('ui', 'implement', ['api'], { workspace: 'own' }),
    task('rev', 'review', ['api']),
  ];
  const messages = policy.workflowTasksProblems(tasks).map((entry) => entry.message);
  assert.ok(messages.some((message) => /depends on every task that produces/.test(message)));
  assert.ok(messages.some((message) => /never reviewed/.test(message)));
});

test('sixty-four tasks pass and sixty-five do not', () => {
  const many = (count) => {
    const tasks = Array.from({ length: count - 1 }, (_, index) =>
      task(`t${index}`, 'implement', [], { workspace: 'own' }),
    );
    return [
      ...tasks,
      task(
        'rev',
        'review',
        tasks.map((entry) => entry.id),
      ),
    ];
  };
  assert.equal(policy.workflowStepsProblem(many(64)), null);
  assert.match(policy.workflowStepsProblem(many(65)), /up to 64 tasks/);
});

test('a key is made from the task, and falls back when it is taken', () => {
  assert.equal(
    policy.workflowTaskId('Add POST /orders endpoint', new Set()),
    'add-post-orders-endpoint',
  );
  assert.equal(policy.workflowTaskId('Add POST', new Set(['add-post'])), 't1');
  assert.equal(policy.workflowTaskId('   ', new Set(['t1'])), 't2');
  assert.ok(policy.workflowTaskId('a'.repeat(80), new Set()).length <= 32);
});
