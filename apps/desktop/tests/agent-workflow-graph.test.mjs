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
    if (name === '@runhq/cockpit-ui/i18n/core' || name === '../i18n/core') return i18nCore;
    throw new Error(name);
  });
  return exports;
}
const i18nCore = load('../../../packages/cockpit-ui/src/i18n/core.ts', {
  './en.json': {
    default: JSON.parse(
      readFileSync(new URL('../../../packages/cockpit-ui/src/i18n/en.json', import.meta.url)),
    ),
  },
  './tr.json': {
    default: JSON.parse(
      readFileSync(new URL('../../../packages/cockpit-ui/src/i18n/tr.json', import.meta.url)),
    ),
  },
});
const graph = load('../src/components/agents/agentWorkflowGraph.ts');
const policy = load('../src/components/agents/agentWorkflowStepPolicy.ts', {
  './agentWorkflowGraph': graph,
});
const editor = load('../src/components/agents/agentWorkflowEditor.ts', {
  './agentWorkflowGraph': graph,
  './agentWorkflowStepPolicy': policy,
});
const bridge = load('../src/components/agents/agentWorkflowRecipeBridge.ts');
const library = load('../src/components/agents/agentLibraryModel.ts');
const launch = load('../src/components/agents/agentWorkflowLaunch.ts', {
  '@runhq/cockpit-ui': load('../../../packages/cockpit-ui/src/components/agentStatus.ts'),
});

test('start timing offers all active tasks in the project across agents, excluding this workflow', () => {
  const session = (id, status, extra = {}) => ({
    id,
    project_id: 'project',
    status,
    archived: false,
    updated_at: 1,
    ...extra,
  });
  const candidates = launch.workflowLaunchCandidates(
    {
      a: session('a', 'running', { backend: 'codex' }),
      b: session('b', 'waiting_permission', { backend: 'claude', updated_at: 2 }),
      c: session('c', 'waiting_input', { backend: 'acp' }),
      own: session('own', 'running'),
      other: session('other', 'running', { project_id: 'other-project' }),
      archived: session('archived', 'running', { archived: true }),
      completed: session('completed', 'completed'),
      stopping: session('stopping', 'cancelling'),
      missing: undefined,
    },
    'project',
    ['own'],
  );
  assert.deepEqual(
    candidates.map((task) => task.id),
    ['b', 'a', 'c'],
  );
});

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

test('the supported task count passes and an extra task is rejected', () => {
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
  assert.equal(policy.workflowStepsProblem(many(512)), null);
  assert.match(policy.workflowStepsProblem(many(513)), /up to 512 tasks/);
});

test('a key is made from the task, and falls back when it is taken', () => {
  assert.equal(
    policy.workflowTaskId('Add POST /orders endpoint', new Set()),
    'add-post-orders-endpoint',
  );
  assert.equal(policy.workflowTaskId('Add POST', new Set(['add-post'])), 't1');
  assert.equal(policy.workflowTaskId('   ', new Set(['t1'])), 't2');
  assert.ok(policy.workflowTaskId('a'.repeat(80), new Set()).length <= 64);
});

test('every starter workflow has instructions, a final review and safe parallel workspaces', () => {
  for (const template of editor.WORKFLOW_TEMPLATES) {
    const tasks = editor.createWorkflowTemplate(template.id, 'builder', 'reviewer');
    assert.equal(policy.workflowStepsProblem(tasks), null, template.id);
    assert.ok(tasks.every((task) => task.prompt.trim()));
    assert.equal(tasks.at(-1).target, 'reviewer');
    assert.deepEqual(graph.workflowUnreviewedProducers(tasks), []);
  }
  const parallel = editor.createWorkflowTemplate('parallel', 'builder', 'reviewer');
  assert.ok(parallel.slice(0, 2).every((task) => task.workspace === 'own'));
});

test('adding and removing a step keeps the final review after the work without changing the draft', () => {
  const original = editor.createWorkflowTemplate('parallel', 'builder', 'reviewer');
  const snapshot = globalThis.structuredClone(original);
  const added = editor.insertWorkflowTask(original, 'docs', 'implement', 'builder', 'reviewer');
  const newTask = added.steps.find((task) => task.id === added.id);
  newTask.prompt = 'Add a regression test for the change';
  assert.equal(policy.workflowStepsProblem(added.steps), null);
  assert.deepEqual(newTask.depends_on, ['docs']);
  assert.deepEqual(added.steps.at(-1).depends_on, ['build', added.id]);
  assert.deepEqual(editor.removeWorkflowTask(added.steps, added.id), original);
  assert.deepEqual(original, snapshot);
});

test('prompt queues wait for intermediate reviews and preserve the selected conversation mode', () => {
  const prompts = [
    { prompt: 'Build the endpoint', review: true },
    { prompt: 'Address findings and add tests', review: false },
    { prompt: 'Update docs', review: false },
  ];
  for (const mode of ['same', 'separate']) {
    const tasks = editor.createWorkflowPromptQueue(prompts, 'builder', 'reviewer', mode);
    assert.equal(policy.workflowStepsProblem(tasks), null);
    assert.deepEqual(
      tasks.map((task) => task.id),
      ['prompt-1', 'review-1', 'prompt-2', 'prompt-3', 'review-3'],
    );
    assert.deepEqual(
      tasks.map((task) => task.depends_on),
      [[], ['prompt-1'], ['review-1'], ['prompt-2'], ['prompt-3']],
    );
    assert.equal(tasks[2].continue_from, mode === 'same' ? 'prompt-1' : undefined);
    assert.equal(tasks[3].continue_from, mode === 'same' ? 'prompt-2' : undefined);
    assert.ok(tasks.filter((task) => task.role === 'review').every((task) => !task.continue_from));
    const restored = bridge.recipeStepsToCreateSteps(
      library.parseRecipeSteps(bridge.createStepsToRecipeSteps(tasks)),
    );
    assert.deepEqual(restored, tasks);
  }
});

test('queue model choices stay with their prompts and independent reviews when saved as a recipe', () => {
  const tasks = editor.createWorkflowPromptQueue(
    [
      { prompt: 'First', review: true, model: 'provider/first', effort: 'high' },
      { prompt: 'Second', review: false, model: 'provider/second', effort: 'low' },
      { prompt: 'Use provider defaults', review: false },
    ],
    'builder',
    'reviewer',
    'same',
    { model: 'review-model', effort: 'medium' },
  );
  assert.deepEqual(
    tasks.map(({ model, effort }) => [model, effort]),
    [
      ['provider/first', 'high'],
      ['review-model', 'medium'],
      ['provider/second', 'low'],
      ['', ''],
      ['review-model', 'medium'],
    ],
  );
  assert.deepEqual(
    bridge.recipeStepsToCreateSteps(
      library.parseRecipeSteps(bridge.createStepsToRecipeSteps(tasks)),
    ),
    tasks,
  );
});

test('inserting a review puts every successor behind it without joining the prompt conversation', () => {
  const tasks = diamond();
  const next = editor.insertWorkflowTask(tasks, 'api', 'review', 'reviewer', 'reviewer', 'same');
  assert.deepEqual(next.steps.find((task) => task.id === 'ui').depends_on, [next.id]);
  assert.deepEqual(next.steps.find((task) => task.id === 'docs').depends_on, [next.id]);
  assert.deepEqual(next.steps.find((task) => task.id === next.id).depends_on, ['api']);
  assert.equal(next.steps.find((task) => task.id === next.id).continue_from, undefined);
  assert.equal(policy.workflowStepsProblem(next.steps), null);
});

test('inserting and removing a prompt rewires conversation context through a review', () => {
  const tasks = editor.createWorkflowPromptQueue(
    [
      { prompt: 'First', review: true },
      { prompt: 'Second', review: false },
    ],
    'builder',
    'reviewer',
    'same',
  );
  const next = editor.insertWorkflowTask(
    tasks,
    'review-1',
    'implement',
    'other-account',
    'reviewer',
    'same',
  );
  const added = next.steps.find((task) => task.id === next.id);
  added.prompt = 'Middle';
  assert.equal(added.continue_from, 'prompt-1');
  assert.equal(added.target, 'builder');
  assert.equal(next.steps.find((task) => task.id === 'prompt-2').continue_from, added.id);
  assert.equal(policy.workflowStepsProblem(next.steps), null);
  assert.deepEqual(editor.removeWorkflowTask(next.steps, added.id), tasks);
});

test('extending a queue after its last review keeps that review and adds a new final review', () => {
  const tasks = editor.createWorkflowPromptQueue(
    [{ prompt: 'First', review: false }],
    'builder',
    'reviewer',
    'same',
  );
  const next = editor.insertWorkflowTask(
    tasks,
    'review-1',
    'implement',
    'builder',
    'reviewer',
    'same',
  );
  next.steps.find((task) => task.id === next.id).prompt = 'Next';
  assert.deepEqual(next.steps[2].depends_on, ['review-1']);
  assert.equal(next.steps[2].continue_from, 'prompt-1');
  assert.equal(next.steps.at(-1).role, 'review');
  assert.equal(policy.workflowStepsProblem(next.steps), null);
});

test('conversation continuation rejects changed accounts, isolated copies, review sessions and forks', () => {
  const tasks = editor.createWorkflowPromptQueue(
    [
      { prompt: 'First', review: true },
      { prompt: 'Second', review: false },
    ],
    'builder',
    'reviewer',
    'same',
  );
  for (const patch of [
    { target: 'other' },
    { workspace: 'own' },
    { continue_from: 'review-1' },
    { continue_from: 'missing' },
  ]) {
    const invalid = tasks.map((task) => (task.id === 'prompt-2' ? { ...task, ...patch } : task));
    assert.ok(policy.workflowStepsProblem(invalid), JSON.stringify(patch));
  }
  const fork = [
    ...tasks,
    task('fork', 'implement', ['prompt-1'], { target: 'builder', continue_from: 'prompt-1' }),
  ];
  assert.ok(
    policy
      .workflowTasksProblems(fork)
      .some((problem) => /two conversation continuations/.test(problem.message)),
  );
});

test('removing a branch preserves shared ancestors without duplicate connections', () => {
  const tasks = [
    task('a', 'implement'),
    task('b', 'implement', ['a']),
    task('rev', 'review', ['a', 'b']),
  ];
  const removed = editor.removeWorkflowTask(tasks, 'b');
  assert.deepEqual(removed.at(-1).depends_on, ['a']);
  assert.equal(policy.workflowStepsProblem(removed), null);
});

test('canvas connections reject duplicates, self-links, cycles and unknown steps', () => {
  const tasks = diamond();
  assert.equal(editor.canConnectWorkflowTasks(tasks, 'api', 'rev'), true);
  for (const [source, target] of [
    ['api', 'ui'],
    ['api', 'api'],
    ['rev', 'api'],
    ['missing', 'api'],
    ['api', 'missing'],
  ]) {
    assert.equal(
      editor.canConnectWorkflowTasks(tasks, source, target),
      false,
      `${source} → ${target}`,
    );
  }
});

test('the map places dependencies before dependents and parallel steps apart', () => {
  const tasks = diamond().reverse();
  const positions = editor.workflowCanvasPositions(tasks);
  for (const task of tasks) {
    for (const dependency of task.depends_on)
      assert.ok(positions[dependency].x < positions[task.id].x);
  }
  assert.equal(positions.ui.x, positions.docs.x);
  assert.notEqual(positions.ui.y, positions.docs.y);
});

test('a completed review with findings blocks its successors until an explicit decision', () => {
  const steps = [
    step('build', 'implement', [], 'completed'),
    step('review', 'review', ['build'], 'completed', {
      review_policy: 'on_findings',
      review_outcome: 'findings',
    }),
    step('next', 'implement', ['review'], 'pending'),
  ];
  assert.deepEqual(graph.workflowRunnableTasks(steps), []);
  assert.equal(graph.groupWorkflowTasks(steps).attention[0].id, 'review');
  for (const outcome of ['unknown', null, undefined]) {
    assert.equal(graph.workflowReviewNeedsDecision({ ...steps[1], review_outcome: outcome }), true);
  }
  assert.equal(graph.workflowReviewNeedsDecision({ ...steps[1], review_outcome: 'passed' }), false);
  assert.equal(
    graph.workflowReviewNeedsDecision({
      ...steps[1],
      review_outcome: 'passed',
      review_policy: 'approval',
    }),
    true,
  );
  steps[1].review_decision = 'approved';
  assert.deepEqual(
    graph.workflowRunnableTasks(steps).map((s) => s.id),
    ['next'],
  );
});

test('live queue reordering preserves the started prefix and reconnects conversation context', () => {
  const queue = editor.createWorkflowPromptQueue(
    [{ prompt: 'First' }, { prompt: 'Second' }, { prompt: 'Third' }],
    'codex',
    'claude',
    'same',
  );
  const locked = new Set(['prompt-1']);
  assert.equal(editor.moveWorkflowQueue(queue, 'prompt-2', -1, locked), queue);
  const moved = editor.moveWorkflowQueue(queue, 'prompt-3', -1, locked);
  assert.equal(moved[0], queue[0]);
  assert.equal(moved[1].id, 'prompt-3');
  assert.equal(moved[1].continue_from, 'prompt-1');
  assert.equal(moved[2].continue_from, 'prompt-3');
  assert.deepEqual(moved[3].depends_on, ['prompt-2']);
  assert.equal(policy.workflowStepsProblem(moved), null);
  const parallel = diamond();
  assert.equal(editor.moveWorkflowQueue(parallel, 'docs', -1), parallel);
});

test('review policy survives queue creation and recipe round trips', () => {
  const queue = editor.createWorkflowPromptQueue([{ prompt: 'Build' }], 'codex', 'claude', 'same', {
    review_policy: 'auto_fix',
    model: 'review-model',
    effort: 'high',
  });
  assert.equal(queue[1].review_policy, 'auto_fix');
  const saved = library.parseRecipeSteps(bridge.createStepsToRecipeSteps(queue));
  assert.deepEqual(bridge.recipeStepsToCreateSteps(saved), queue);
  assert.throws(
    () => library.parseRecipeSteps([{ ...saved[0], reviewPolicy: 'guess' }]),
    /review policy/i,
  );
});

test('prompt-only sequencing releases the next prompt independently of an intermediate review', () => {
  const tasks = editor.createWorkflowPromptQueue(
    [{ prompt: 'First', review: true }, { prompt: 'Second', review: true }, { prompt: 'Third' }],
    'codex',
    'claude',
    'same',
    {},
    'prompts',
  );
  assert.deepEqual(tasks.find((s) => s.id === 'prompt-2').depends_on, ['prompt-1']);
  assert.equal(tasks.find((s) => s.id === 'prompt-2').continue_from, 'prompt-1');
  assert.equal(policy.workflowStepsProblem(tasks), null);
  const running = tasks.map((s) => ({
    ...s,
    status: s.id === 'prompt-1' ? 'completed' : s.id === 'review-1' ? 'running' : 'pending',
  }));
  assert.deepEqual(
    graph.workflowRunnableTasks(running).map((s) => s.id),
    ['prompt-2'],
  );
  assert.equal(editor.workflowExecutionMode(tasks), 'prompts');
});

test('parallel mode isolates every prompt, drops shared conversations and reviews all results', () => {
  const queue = editor.createWorkflowPromptQueue(
    [
      { prompt: 'First', review: true, model: 'model-a' },
      { prompt: 'Second', model: 'model-b' },
    ],
    'codex',
    'claude',
    'same',
    { review_policy: 'approval' },
  );
  const parallel = editor.setWorkflowExecution(queue, 'parallel');
  for (const prompt of parallel.filter((s) => s.role === 'implement')) {
    assert.deepEqual(prompt.depends_on, []);
    assert.equal(prompt.workspace, 'own');
    assert.equal(prompt.continue_from, undefined);
  }
  assert.equal(parallel[0].model, 'model-a');
  assert.equal(parallel[1].review_policy, 'approval');
  assert.deepEqual(
    new Set(parallel.at(-1).depends_on),
    new Set(['prompt-1', 'prompt-2', 'review-1']),
  );
  assert.equal(policy.workflowStepsProblem(parallel), null);
  assert.equal(editor.workflowExecutionMode(parallel), 'parallel');
  assert.equal(queue[2].continue_from, 'prompt-1');
  const sequential = editor.setWorkflowExecution(parallel, 'sequence');
  assert.equal(editor.workflowIsQueue(sequential), true);
  assert.equal(policy.workflowStepsProblem(sequential), null);
});

test('execution settings survive recipe import, export and live editing', () => {
  const execution = {
    max_fix_attempts: 3,
    agent_profile: 'implementation-profile',
    timeout_minutes: 240,
    lock: 'main',
    working_directory: 'backend',
    run_if: { step_id: 'a', outcomes: ['findings'] },
    result_format: 'pipeline',
    on_failure: 'cancel',
  };
  const tasks = [
    task('a', 'implement'),
    task('b', 'implement', ['a'], { execution }),
    task('review', 'review', ['b']),
  ];
  const saved = bridge.createStepsToRecipeSteps(tasks);
  const parsed = library.parseRecipeSteps(saved);
  assert.deepEqual(bridge.recipeStepsToCreateSteps(parsed)[1].execution, execution);
  assert.deepEqual(editor.workflowStepDeclaration(tasks[1]).execution, execution);
  assert.throws(
    () => library.parseWorkflowExecution({ timeout_minutes: -1 }),
    /Invalid workflow execution/,
  );
  assert.throws(
    () => library.parseWorkflowExecution({ max_fix_attempts: 11 }),
    /Invalid workflow execution/,
  );
  assert.throws(
    () => library.parseWorkflowExecution({ unsupportedRule: true }),
    /Invalid workflow execution/,
  );
});

test('terminal steps require a command and same-lock shared steps are admitted', () => {
  const gate = task('gate', 'shell', ['a'], {
    execution: { command: 'bash verify.sh', lock: 'main' },
  });
  assert.equal(graph.workflowRoleProduces('shell'), true);
  assert.equal(
    policy.workflowStepsProblem([task('a', 'implement'), gate, task('review', 'review', ['gate'])]),
    null,
  );
  assert.match(
    policy.workflowStepsProblem([
      task('a', 'implement'),
      { ...gate, execution: {} },
      task('review', 'review', ['gate']),
    ]),
    /terminal step needs a command/,
  );
  const locked = ['a', 'b'].map((id) =>
    task(id, 'implement', [], { execution: { lock: 'database' } }),
  );
  assert.equal(
    policy.workflowStepsProblem([...locked, task('review', 'review', ['a', 'b'])]),
    null,
  );
});

const directContext = () => ({
  workspace_mode: 'direct',
  package_root: '/packages/example',
  working_directory: '/projects/example',
  repositories: [{ name: 'Backend', path: '/projects/backend', branch: 'feature/change' }],
  environment: { WORKFLOW_MODE: 'verify' },
  issues: [{ code: 'missing_file', detail: 'verify.sh', blocking: true }],
  source: '/imports/workflow.zip',
});

test('native package recipes preserve context, agent settings, control roles and execution contracts', () => {
  const execution = {
    run_condition: "review.verdict != 'PASS' && review.runCount < 3",
    complete_condition: "review.verdict == 'PASS'",
    halt_condition: 'review.runCount >= 3',
    max_runs: 3,
    rerun_step: 'review',
    require_pass: ['review'],
    verdict_regex: 'REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)',
    result_line_regex: '^REVIEW_VERDICT: (PASS|FAIL)$',
    result_scope: 'combined_output',
    success_scope: 'output',
    failure_scope: 'last_line',
    verdict_scope: 'output',
    success_exit_code: 0,
    failure_exit_code: null,
    failure_exit_code_not: 0,
    environment: { PACKAGE_ROOT: '/packages/example', EMPTY: '' },
    working_directory: '/packages/example',
  };
  const tasks = [
    task('approval', 'human', [], { prompt: '', target: '' }),
    task('review', 'review', ['approval'], { model: 'review-model', effort: 'high' }),
    task('done', 'barrier', ['review'], { target: '', prompt: '', execution }),
  ];
  const recipe = library.parseRecipe({
    id: 'imported',
    name: 'Imported workflow',
    prompt: 'Project workflow',
    backend: 'codex',
    model: '',
    effort: '',
    agent: '',
    mode: 'default',
    isolated: false,
    acceptance: '',
    setupCommands: '',
    checkCommands: '',
    version: 1,
    workflowConcurrency: 2,
    workflowSteps: bridge.createStepsToRecipeSteps(tasks),
    workflowContext: directContext(),
  });
  const restored = bridge.recipeStepsToCreateSteps(recipe.workflowSteps);
  assert.deepEqual(restored, tasks);
  assert.deepEqual(recipe.workflowContext, directContext());
  assert.equal(recipe.workflowConcurrency, 2);
  assert.deepEqual(library.portableAgentRecipe(recipe).workflowContext, directContext());
  assert.deepEqual(editor.workflowStepDeclaration(tasks[2]).execution, execution);
  assert.equal(policy.workflowStepsProblem(restored, recipe.workflowContext), null);
  assert.notEqual(
    policy.workflowStepsProblem(restored),
    null,
    'isolated validation remains strict',
  );
  restored[2].execution.environment.PACKAGE_ROOT = 'changed';
  assert.equal(recipe.workflowSteps[2].execution.environment.PACKAGE_ROOT, '/packages/example');
});

test('control steps are neither agents nor independent reviews and human gates need attention', () => {
  for (const role of ['human', 'barrier', 'shell']) {
    assert.equal(graph.workflowRoleUsesAgent(role), false);
    assert.equal(graph.workflowRoleReviews(role), false);
    assert.equal(policy.newWorkflowStep(role, 'codex', role).target, '');
    assert.equal(policy.newWorkflowStep(role, 'codex', role).review_policy, undefined);
  }
  const approval = step('approval', 'human', [], 'awaiting_approval', {
    target: '',
    session_id: null,
    review_policy: 'approval',
  });
  assert.equal(graph.workflowTaskLane(approval), 'attention');
  assert.equal(graph.workflowReviewNeedsDecision({ ...approval, status: 'completed' }), false);
  assert.deepEqual(
    graph.workflowUnreviewedProducers([
      task('build', 'implement'),
      task('gate', 'barrier', ['build']),
    ]),
    ['build'],
  );
  assert.deepEqual(
    graph.workflowBlockedBy(
      [approval, step('build', 'implement', ['approval'], 'pending')],
      'build',
    ),
    ['approval'],
  );
});

test('direct flows retain declared gates while preserving isolated workspace safety rules', () => {
  const tasks = [
    task('approval', 'human', [], { target: '', prompt: '' }),
    task('build', 'implement', ['approval'], { model: 'chosen-model', effort: 'high' }),
    task('verify', 'shell', ['build'], { target: '', execution: { command: 'verify.sh' } }),
    task('finish', 'barrier', ['verify'], { target: '', prompt: '' }),
  ];
  assert.equal(policy.workflowStepsProblem(tasks, directContext()), null);
  assert.ok(policy.workflowStepsProblem(tasks));
  assert.equal(editor.workflowExecutionMode(tasks), 'custom');
  assert.deepEqual(editor.setWorkflowExecution(tasks, 'parallel'), tasks);
  assert.match(
    policy.workflowStepsProblem(
      tasks.map((entry) => (entry.id === 'build' ? { ...entry, workspace: 'own' } : entry)),
      directContext(),
    ),
    /shared working directory/,
  );
  const concurrent = [task('a', 'implement'), task('b', 'implement')];
  assert.equal(policy.workflowStepsProblem(concurrent, directContext()), null);
  assert.ok(policy.workflowStepsProblem(concurrent));
  const appended = editor.insertWorkflowTask(
    tasks,
    'finish',
    'implement',
    'codex',
    'claude',
    'separate',
    false,
  );
  assert.equal(appended.steps.length, tasks.length + 1);
  assert.equal(appended.steps.at(-1).role, 'implement');
});

test('native package task keys and pass requirements preserve long ancestor references', () => {
  const id = `review-${'a'.repeat(57)}`;
  const tasks = [
    task(id, 'review'),
    task('middle', 'shell', [id], { target: '', execution: { command: 'true' } }),
    task('gate', 'barrier', ['middle'], {
      target: '',
      prompt: '',
      execution: { require_pass: [id], complete_condition: `${id}.verdict == 'PASS'` },
    }),
  ];
  assert.equal(id.length, 64);
  assert.equal(policy.workflowStepsProblem(tasks, directContext()), null);
  assert.match(
    policy.workflowStepsProblem([{ ...tasks[0], id: `${id}a` }], directContext()),
    /up to 64/,
  );
  assert.equal(
    bridge.recipeStepsToCreateSteps(
      library.parseRecipeSteps(bridge.createStepsToRecipeSteps(tasks)),
    )[2].execution.complete_condition,
    `${id}.verdict == 'PASS'`,
  );
});

test('invalid imported execution contracts fail without dropping their settings', () => {
  for (const invalid of [
    { max_runs: 0 },
    { max_runs: 101 },
    { require_pass: true },
    { result_scope: 'unknown' },
    { success_scope: 'tail' },
    { success_exit_code: 0.5 },
    { result_line_regex: 'a'.repeat(4097) },
    { agent_profile: 'a'.repeat(257) },
    { environment: { 'INVALID-NAME': 'value' } },
  ])
    assert.throws(() => library.parseWorkflowExecution(invalid), /Invalid workflow execution/);
  const tasks = [
    task('review', 'review'),
    task('fix', 'implement', ['review'], {
      execution: { rerun_step: 'unknown', max_runs: 2 },
    }),
  ];
  assert.match(policy.workflowStepsProblem(tasks, directContext()), /repeat target/);
  tasks[1].execution = { run_condition: "missing.verdict == 'PASS'" };
  assert.match(policy.workflowStepsProblem(tasks, directContext()), /invalid execution settings/);
});
