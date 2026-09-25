import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { i18nCore } from './helpers/i18n.mjs';

function evaluate(source, bindings = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(bindings), compiled)(exports, ...Object.values(bindings));
  return exports;
}

function moduleAt(path, modules = {}) {
  return evaluate(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    require: (name) => {
      if (name === '@runhq/cockpit-ui/i18n/core') return i18nCore;
      if (name in modules) return modules[name];
      throw new Error(`Unexpected module: ${name}`);
    },
  });
}

function workflowIpc(invoke) {
  return moduleAt('../src/lib/ipc/agentWorkflowIpc.ts', {
    '@tauri-apps/api/core': { invoke },
  }).agentWorkflowIpc;
}

test('native workflow model discovery sends its working directory without a saved project', async () => {
  const calls = [];
  const catalog = { models: [{ id: 'chosen-model' }] };
  const ipc = moduleAt('../src/lib/ipc/agentIpc.ts', {
    '@tauri-apps/api/core': {
      invoke: async (command, args) => {
        calls.push({ command, args });
        return catalog;
      },
    },
  }).agentIpc;
  assert.equal(
    await ipc.agentCatalog('opencode', '', '', undefined, 'chosen-model', '/selected/workspace'),
    catalog,
  );
  assert.deepEqual(calls, [
    {
      command: 'agent_catalog',
      args: {
        backend: 'opencode',
        executable: '',
        projectId: '',
        sessionId: null,
        model: 'chosen-model',
        workingDirectory: '/selected/workspace',
      },
    },
  ]);
});

// Execute the Hub's real event callbacks without mounting unrelated workbench panels. This
// protects what an imported draft actually submits, including data absent from ordinary recipes.
const hubSource = readFileSync(
  new URL('../src/components/agents/AgentWorkflowHub.tsx', import.meta.url),
  'utf8',
);
const hubTree = ts.createSourceFile(
  'Hub.tsx',
  hubSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function hubCallback(name, bindings) {
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(hubTree) === name)
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(hubTree);
  assert.ok(initializer, `Missing Hub callback: ${name}`);
  return evaluate(`exports.callback = ${initializer.getText(hubTree)};`, bindings).callback;
}

function hubEvent(name, bindings) {
  let expression;
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(hubTree) === name)
      expression = node.initializer?.expression;
    ts.forEachChild(node, visit);
  };
  visit(hubTree);
  assert.ok(expression, `Missing Hub event: ${name}`);
  return evaluate(`exports.callback = ${expression.getText(hubTree)};`, bindings).callback;
}

test('a human decision carries the exact visible approval identity and preserves the note', async () => {
  const calls = [];
  const saved = { id: 'workflow', stage: 'implementation_ready' };
  const ipc = workflowIpc(async (command, args) => {
    calls.push({ command, args });
    return saved;
  });
  const note = 'İnceleme tamamlandı.\nYalnızca bu onay için geçerli.';
  let pending;
  const onHumanDecision = hubEvent('onHumanDecision', {
    current: { id: 'workflow', steps: [{ id: 'approval', started_at: 1727000123, generation: 4 }] },
    action: (work) => {
      pending = work();
      return pending;
    },
    agentWorkflowIpc: ipc,
  });
  onHumanDecision('approval', true, note);
  assert.equal(await pending, saved);
  assert.deepEqual(calls, [
    {
      command: 'agent_workflow_decide_human',
      args: {
        id: 'workflow',
        stepId: 'approval',
        approved: true,
        note,
        expectedStartedAt: 1727000123,
        expectedGeneration: 4,
      },
    },
  ]);

  const stale = new Error('workflow.stale_decision');
  const outdated = workflowIpc(async (command, args) => {
    assert.equal(command, 'agent_workflow_decide_human');
    assert.equal(args.approved, false);
    assert.equal(args.expectedGeneration, 3);
    throw stale;
  });
  await assert.rejects(
    outdated.decideHuman('workflow', 'approval', false, '', 1727000123, 3),
    (error) => error === stale,
  );
});

const graph = moduleAt('../src/components/agents/agentWorkflowGraph.ts');
const bridge = moduleAt('../src/components/agents/agentWorkflowRecipeBridge.ts');
const policy = moduleAt('../src/components/agents/agentWorkflowStepPolicy.ts', {
  './agentWorkflowGraph': graph,
});

function importDraft(recipe) {
  const state = {};
  const setters = Object.fromEntries(
    [
      'Steps',
      'Objective',
      'Acceptance',
      'Setup',
      'Checks',
      'ImportedName',
      'Context',
      'Concurrency',
      'NewProject',
      'AutoProgress',
      'ImportOptions',
      'Creating',
    ].map((name) => [
      `set${name}`,
      (value) => {
        state[name] = value;
      },
    ]),
  );
  hubCallback('openImportedWorkflow', {
    ...setters,
    recipeStepsToCreateSteps: bridge.recipeStepsToCreateSteps,
    newWorkflowStep: policy.newWorkflowStep,
    resolvePool: (target) => target,
    available: [],
    reviewers: [{ id: 'reviewer' }],
    projects: [],
  })(recipe);
  return state;
}

test('a native package draft reaches create with its context, profiles and matching rules intact', async () => {
  const context = {
    workspace_mode: 'direct',
    package_root: '/captured/package',
    working_directory: '/selected/workspace',
    repositories: [{ name: 'Backend', path: '/selected/backend', branch: 'feature/work' }],
    environment: { RUN_MODE: 'verify' },
    issues: [],
    source: '/imports/workflow.zip',
    notify_human: false,
  };
  const recipe = {
    name: 'Imported package',
    prompt: 'Complete the package workflow',
    acceptance: 'PASS required',
    backend: 'implementation',
    model: 'chosen-model',
    effort: 'high',
    agent: 'builder',
    mode: 'default',
    setupCommands: '',
    checkCommands: '',
    workflowContext: context,
    workflowConcurrency: 3,
    workflowSteps: [
      {
        id: 'approval',
        role: 'human',
        prompt: 'Approve paths',
        target: '',
        model: '',
        effort: '',
        mode: '',
        dependsOn: [],
        workspace: 'shared',
      },
      {
        id: 'build',
        role: 'implement',
        prompt: 'Implement',
        target: 'implementation',
        model: 'chosen-model',
        effort: 'high',
        mode: 'default',
        dependsOn: ['approval'],
        workspace: 'shared',
        execution: {
          agent_profile: 'builder',
          result_line_regex: '^PIPELINE_RESULT: SUCCESS$',
          success_regex: 'PIPELINE_RESULT: SUCCESS',
          success_scope: 'output',
          result_scope: 'final_response',
          environment: { STEP_MODE: 'build' },
        },
      },
    ],
  };
  const draft = importDraft(recipe);
  assert.equal(draft.Context, context);
  assert.equal(draft.Concurrency, 3);
  assert.equal(draft.NewProject, '');
  assert.equal(draft.Steps[0].target, '');

  const calls = [];
  const saved = { id: 'saved', steps: draft.Steps, context };
  const agentWorkflowIpc = workflowIpc(async (command, args) => {
    calls.push({ command, args });
    return saved;
  });
  const create = hubCallback('create', {
    action: (work) => work(),
    agentWorkflowIpc,
    ipc: {
      agentAddProject: () => assert.fail('Opening a direct draft must not register a project'),
    },
    chosenProject: '',
    context: draft.Context,
    importedName: draft.ImportedName,
    initialRecipe: undefined,
    steps: draft.Steps,
    chosenBackend: '',
    chosenReviewer: '',
    model: '',
    effort: '',
    reviewModel: '',
    objective: draft.Objective,
    acceptance: draft.Acceptance,
    baseRef: 'HEAD',
    setup: draft.Setup,
    checks: draft.Checks,
    autoProgress: draft.AutoProgress,
    concurrency: draft.Concurrency,
    workflowTasksInExecutionOrder: graph.workflowTasksInExecutionOrder,
    lines: (value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    setNewProject: () => assert.fail('Direct draft project must remain unchanged'),
    setWorkflows: (update) => assert.equal(update([])[0], saved),
    setSelected: (id) => assert.equal(id, 'saved'),
    setCreating: () => {},
    setLaunchChoice: () => {},
  });
  assert.equal(await create({ mode: 'draft' }), saved);
  assert.equal(calls.length, 1, 'Saving a draft must not launch agents or commands');
  assert.equal(calls[0].command, 'agent_workflow_create');
  assert.deepEqual(calls[0].args.input.context, context);
  assert.deepEqual(calls[0].args.input.steps, draft.Steps);
  assert.equal(calls[0].args.input.steps[1].execution.agent_profile, 'builder');
  assert.equal(
    calls[0].args.input.steps[1].execution.result_line_regex,
    '^PIPELINE_RESULT: SUCCESS$',
  );
  assert.equal(calls[0].args.input.concurrency, 3);
});

test('a recipe without explicit workflow steps keeps its selected profile in the implementation step', () => {
  const draft = importDraft({
    name: 'Reusable task',
    prompt: 'Do the work',
    acceptance: '',
    setupCommands: '',
    checkCommands: '',
    backend: 'implementation',
    model: 'chosen-model',
    effort: 'high',
    agent: 'builder',
    mode: 'default',
  });
  assert.equal(draft.Steps[0].execution.agent_profile, 'builder');
  assert.equal(draft.Steps[0].model, 'chosen-model');
  assert.equal(draft.Steps[0].effort, 'high');
  assert.equal(
    draft.Steps[1].execution?.agent_profile,
    undefined,
    'The independent review must not inherit a writing profile',
  );
});
