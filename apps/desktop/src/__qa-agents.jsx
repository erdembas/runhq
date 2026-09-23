import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import './styles.css';
import { AgentWorkspace } from './components/agents/AgentWorkspace';
import { AgentToolsHub } from './components/agents/AgentToolsHub';
import { useAgentStore } from './store/useAgentStore';
import { useAgentLibraryStore } from './store/useAgentLibraryStore';
import { useAgentNotificationStore } from './store/useAgentNotificationStore';
const now = Date.now();
const step = (overrides) => ({
  id: '',
  role: 'implement',
  target: 'codex',
  model: '',
  effort: '',
  mode: '',
  session_id: null,
  input_step_id: overrides.depends_on?.[0] ?? null,
  depends_on: [],
  prompt: '',
  workspace: 'shared',
  cwd: null,
  root: null,
  status: 'pending',
  input_revision: null,
  output_tree: null,
  output_revision: null,
  merge: null,
  generation: 0,
  started_at: null,
  finished_at: null,
  error: null,
  ...overrides,
});
const projects = [{ id: 'qa-project', name: 'RunHQ preview', path: '/fixture/runhq' }];
const tools = [
  {
    id: 'codex',
    name: 'Codex',
    adapter: 'codex',
    enabled: true,
    available: true,
    executable: 'codex',
    args: [],
    path: '/fixture/codex',
  },
  {
    id: 'claude',
    name: 'Claude',
    adapter: 'claude',
    enabled: true,
    available: true,
    executable: 'claude',
    args: [],
    path: '/fixture/claude',
  },
  {
    id: 'claude-second',
    name: 'Claude (second account)',
    adapter: 'claude',
    enabled: true,
    available: true,
    executable: 'claude',
    args: [],
    env: { CLAUDE_CONFIG_DIR: '/fixture/home/second' },
    path: '/fixture/claude',
  },
];
const sample = (id, title, status, extra = {}) => ({
  id,
  title,
  status,
  project_id: 'qa-project',
  project_name: 'RunHQ preview',
  cwd: '/fixture/runhq',
  backend: 'codex',
  backend_name: 'Codex',
  adapter: 'codex',
  executable: 'codex',
  model: 'fixture-model',
  effort: '',
  mode: 'default',
  agent: '',
  args: [],
  pending: [],
  created_at: now - 600000,
  updated_at: now - 120000,
  revision: 1,
  archived: false,
  unread: false,
  isolated: true,
  branch: 'codex/task',
  usage: { total: { inputTokens: 2100, outputTokens: 410, totalTokens: 2510 } },
  turn_started_at: null,
  last_turn_ms: 96_000,
  total_run_ms: 240_000,
  runtime_state: {},
  ...extra,
});
const sessions = {
  implement: sample('implement', 'Add project activity indicators', 'completed', { unread: true }),
  review: sample('review', 'Review sidebar navigation', 'waiting_permission', {
    backend: 'claude',
    backend_name: 'Claude',
    adapter: 'claude',
    pending: [
      {
        id: 'permission',
        kind: 'approval',
        title: 'Inspect changed files',
        details: 'Read the proposed sidebar changes before reviewing.',
        questions: null,
        choices: [
          { label: 'Allow once', value: 'allow' },
          { label: 'Deny', value: 'deny' },
        ],
        schema: null,
      },
    ],
  }),
  stopped: sample('stopped', 'Improve queue recovery', 'interrupted', {
    last_error: 'Stopped when RunHQ closed. Review the saved message before continuing.',
  }),
};
const items = [
  {
    id: 'answer',
    kind: 'assistant',
    title: 'Implementation result',
    text: 'Added visible agent counts to project rows. The review is ready.',
    status: 'completed',
    created_at: now - 120000,
  },
  {
    id: 'fanout',
    kind: 'subagent',
    title: 'Explore routing',
    text: JSON.stringify({
      prompt: 'Find every place that renders a project row.',
      agentId: 'explorer-1',
      subagentType: 'explore',
      model: 'composer-1',
      durationMs: 123000,
    }),
    status: 'completed',
    created_at: now - 150000,
  },
];
// A saved recipe that targets the pool, so drafting it shows which account it resolves to.
const pooledRecipe = {
  key: 'recipe:pooled',
  updated_at: now,
  value: {
    id: 'pooled',
    name: 'Nightly dependency sweep',
    prompt: 'Update {{dependency}} and report the affected usage.',
    backend: 'pool:claude',
    model: '',
    effort: '',
    mode: 'default',
    agent: '',
    isolated: true,
    acceptance: '',
    setupCommands: '',
    checkCommands: '',
    version: 1,
  },
};
const wf = {
  id: 'wf',
  project_id: 'qa-project',
  title: 'Project activity indicators',
  objective: 'Show active agents for each project.',
  acceptance: 'Counts match active sessions and remain readable at narrow widths.',
  implementation_session_id: 'implement',
  review_session_id: null,
  reviewer_backend: 'claude',
  steps: [
    // A graph, because that is what the screen has to show: two tasks in checkouts of their own
    // running beside each other, one waiting on both, one finished.
    step({
      id: 'plan',
      role: 'plan',
      target: 'pool:claude',
      prompt: 'Plan the activity badge work',
      session_id: 'implement',
      status: 'completed',
      input_revision: 'abc123def456',
    }),
    step({
      id: 'api',
      role: 'implement',
      target: 'codex',
      prompt: 'Add the activity count endpoint',
      depends_on: ['plan'],
      workspace: 'own',
      session_id: 'implement',
      status: 'running',
      cwd: '/fixture/worktrees/api',
      root: '/fixture/worktrees/api',
    }),
    step({
      id: 'badge',
      role: 'implement',
      target: 'claude-second',
      prompt: 'Render the badge in the sidebar',
      depends_on: ['plan'],
      workspace: 'own',
      status: 'pending',
    }),
    step({
      id: 'review',
      role: 'review',
      target: 'claude',
      prompt: 'Review both changes against the acceptance criteria',
      depends_on: ['api', 'badge'],
      status: 'pending',
    }),
  ],
  reviewer_model: '',
  base_revision: 'abc123def456',
  cwd: '/fixture/worktrees/task',
  root: '/fixture/worktrees/task',
  target: '/fixture/runhq',
  stage: 'ready',
  setup_commands: ['pnpm install --frozen-lockfile'],
  check_commands: ['pnpm typecheck', 'pnpm test'],
  setup: [],
  checks: [],
  review_fingerprint: null,
  current_fingerprint: 'fixture',
  preview: {
    target: '/fixture/runhq',
    target_branch: 'main',
    target_fingerprint: 'abc123def456',
    source_fingerprint: 'fixture',
    patch: 'diff --git a/sidebar.tsx b/sidebar.tsx\n+<AgentActivityBadge />',
    conflict: null,
  },
  error: null,
  created_at: now - 600000,
  updated_at: now,
  cleaned: false,
  auto_progress: true,
  concurrency: 0,
  joined: [],
  transferred_files: [],
  integration_branch: null,
  integration_commit: null,
};
const previewReview = {
  ...wf,
  id: 'review-decision-preview',
  title: 'Review decision example',
  stage: 'awaiting_review',
  setup_commands: [],
  check_commands: [],
  preview: null,
  steps: [
    step({
      id: 'first',
      role: 'implement',
      target: 'codex',
      prompt: 'Add a search field',
      status: 'completed',
      started_at: now - 60000,
      session_id: 'implement',
    }),
    step({
      id: 'check',
      role: 'review',
      target: 'claude',
      prompt: 'Review the search field',
      depends_on: ['first'],
      status: 'completed',
      started_at: now - 30000,
      finished_at: now,
      session_id: 'review',
      review_policy: 'on_findings',
      review_outcome: 'findings',
      review_summary: 'The search field needs a visible label and an empty-results message.',
    }),
    step({
      id: 'next',
      role: 'implement',
      target: 'codex',
      prompt: 'Add documentation',
      depends_on: ['check'],
    }),
    step({
      id: 'final',
      role: 'review',
      target: 'claude',
      prompt: 'Review all changes',
      depends_on: ['next'],
      review_policy: 'approval',
    }),
  ],
};
const previewWorkflows = [wf, previewReview];
mockIPC((cmd, args) => {
  if (cmd === 'agent_projects') return projects;
  if (cmd === 'agent_sessions') return Object.values(sessions);
  if (cmd === 'agent_workflows') return previewWorkflows;
  if (cmd === 'agent_workflow_create') {
    const id = `preview-workflow-${previewWorkflows.length}`;
    const sessionId = `${id}-session`;
    const input = args.input;
    const title = input.objective || input.steps[0]?.prompt || 'Prompt queue';
    sessions[sessionId] = sample(sessionId, title, 'idle');
    const created = {
      ...wf,
      ...input,
      id,
      title,
      stage: input.setup_commands.length ? 'setup_ready' : 'implementation_ready',
      implementation_session_id: sessionId,
      review_session_id: null,
      launch_pending: false,
      start_after: null,
      steps: input.steps.map((entry, index) =>
        step({ ...entry, session_id: index === 0 ? sessionId : null }),
      ),
      setup: [],
      checks: [],
      error: null,
      preview: null,
      review_fingerprint: null,
      current_fingerprint: null,
    };
    previewWorkflows.unshift(created);
    return created;
  }
  if (cmd === 'agent_workflow_edit' || cmd === 'agent_workflow_update_steps') {
    const entry = previewWorkflows.find((entry) => entry.id === args.id);
    if (cmd === 'agent_workflow_update_steps') {
      if (!entry.editing || entry.edit_revision !== args.input.revision)
        throw new Error('Queue changed');
      entry.steps = args.input.steps.map((definition) => {
        const old = entry.steps.find((item) => item.id === definition.id);
        return old && (old.started_at || old.status !== 'pending')
          ? old
          : step({ ...definition, session_id: old?.session_id ?? null });
      });
      entry.editing = false;
    } else entry.editing = args.editing;
    entry.edit_revision = (entry.edit_revision || 0) + 1;
    return entry;
  }
  if (cmd === 'agent_workflow_review_decision') {
    const entry = previewWorkflows.find((entry) => entry.id === args.id);
    const review = entry.steps.find((step) => step.id === args.stepId);
    review.review_decision = args.decision === 'approve' ? 'approved' : 'fix_requested';
    entry.stage = 'implementation_ready';
    return entry;
  }
  if (cmd === 'agent_workflow_launch' || cmd === 'agent_workflow_cancel') {
    const entry = previewWorkflows.find((entry) => entry.id === args.id);
    if (!entry) throw new Error('Unknown preview workflow');
    const preceding = args.afterSessionId && sessions[args.afterSessionId];
    entry.start_after = preceding ? { session_id: preceding.id, title: preceding.title } : null;
    entry.launch_pending = !!preceding;
    entry.stage =
      cmd === 'agent_workflow_cancel' ? 'cancelled' : preceding ? 'waiting' : 'implementing';
    if (entry.stage === 'implementing') {
      entry.steps[0].status = 'running';
      entry.steps[0].started_at = Date.now();
      sessions[entry.implementation_session_id].status = 'running';
    }
    return entry;
  }
  if (cmd === 'agent_workspace_data') return [];
  if (cmd === 'agent_workspace_save') return null;
  if (cmd === 'agent_history_search')
    return [{ sequence: 3, session: sessions.implement, item: items[0] }];
  if (cmd === 'agent_history_retention_preview') return [];
  if (cmd === 'agent_snapshot')
    return { session: sessions[args.id] || sessions.implement, items, before: null };
  if (cmd === 'agent_catalog') {
    const claude = args.backend?.startsWith('claude');
    return {
      connection: claude ? 'claude' : 'codex',
      models: [
        {
          id: 'fixture-model',
          name: claude ? 'Claude preview' : 'Codex preview',
          description: 'Local QA fixture',
          efforts: ['low', 'medium', 'high'],
        },
        {
          id: 'fixture-fast',
          name: 'Fast preview',
          description: 'Local QA fixture',
          efforts: ['low', 'medium'],
        },
      ],
      modes: ['default', 'plan'],
      agents: [],
      commands: [],
      can_steer: false,
    };
  }
  if (cmd === 'agent_detect' || cmd === 'agent_tools') return tools;
  if (cmd === 'agent_update') return { ...sessions[args.id], revision: 2, unread: false };
  if (cmd === 'agent_workspace_diff')
    return 'diff --git a/sidebar.tsx b/sidebar.tsx\n+<AgentActivityBadge />';
  if (cmd === 'plugin:event|listen') return 1;
  if (cmd === 'plugin:event|unlisten') return null;
  return null;
});
useAgentNotificationStore.setState({ preferences: { enabled: false, mutedProjects: [] } });
useAgentStore.setState({
  ready: true,
  projects,
  sessions,
  tools,
  toolsReady: true,
  toolsCheckedAt: now,
  refreshTools: async () => {},
  refresh: async () => {},
});
useAgentLibraryStore.setState({
  ready: true,
  error: null,
  records: {
    'pool:claude': {
      key: 'pool:claude',
      updated_at: now,
      value: {
        id: 'claude',
        name: 'Claude accounts',
        accounts: ['claude', 'claude-second'],
      },
    },
    'preferences:cooldowns': {
      key: 'preferences:cooldowns',
      updated_at: now,
      value: {
        claude: {
          since: now - 240_000,
          until: now + 26 * 60_000,
          reason:
            'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Usage limit reached for this account."}}',
        },
      },
    },
    'recipe:pooled': pooledRecipe,
    // A task RunHQ routed rather than the user, so the session header can explain itself.
    'routing:implement': {
      key: 'routing:implement',
      updated_at: now,
      value: {
        accountId: 'codex',
        accountName: 'Codex',
        reason: 'takes over after Claude reported a limit',
        poolName: 'Claude accounts',
        at: now - 300_000,
      },
    },
    'memory:qa': {
      key: 'memory:qa',
      updated_at: now,
      value: {
        id: 'qa',
        projectId: 'qa-project',
        title: 'Keep project navigation stable',
        content: 'Badges open the agent task without expanding or selecting the service row.',
        sourceSessionId: 'implement',
        sourceItemId: 'answer',
        capturedAt: now,
      },
    },
  },
});
// Stores eagerly refresh at import time, before mockIPC is installed; clear that startup rejection.
setTimeout(() => useAgentLibraryStore.setState({ error: null }), 0);
createRoot(document.getElementById('root')).render(
  <main style={{ height: '100vh', display: 'flex', background: 'var(--color-surface)' }}>
    <AgentWorkspace visible />
    <AgentToolsHub />
  </main>,
);
