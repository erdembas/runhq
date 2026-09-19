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
  auto_progress: false,
  transferred_files: [],
  integration_branch: null,
  integration_commit: null,
};
mockIPC((cmd, args) => {
  if (cmd === 'agent_projects') return projects;
  if (cmd === 'agent_sessions') return Object.values(sessions);
  if (cmd === 'agent_workflows') return [wf];
  if (cmd === 'agent_workspace_data') return [];
  if (cmd === 'agent_workspace_save') return null;
  if (cmd === 'agent_history_search')
    return [{ sequence: 3, session: sessions.implement, item: items[0] }];
  if (cmd === 'agent_history_retention_preview') return [];
  if (cmd === 'agent_snapshot')
    return { session: sessions[args.id] || sessions.implement, items, before: null };
  if (cmd === 'agent_catalog') return { models: [], modes: [], agents: [], commands: [] };
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
