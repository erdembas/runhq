export const agentChatDefaultsKey = 'preferences:new-agent-chat';

export interface AgentChatDefaults {
  backend: string;
  model: string;
  effort: string;
  mode: 'default' | 'plan';
  agent: string;
  executable: string;
}

/**
 * Provider-specific options cannot follow automatic selection to another provider. Fields saved by
 * older versions, such as a separate-worktree preference, are ignored.
 */
export function agentChatDefaults(value?: unknown): AgentChatDefaults {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const string = (key: string) => (typeof saved[key] === 'string' ? saved[key].trim() : '');
  const backend = string('backend');
  return {
    backend,
    model: backend ? string('model') : '',
    effort: backend ? string('effort') : '',
    mode: backend && saved.mode === 'plan' ? 'plan' : 'default',
    agent: backend ? string('agent') : '',
    executable: backend ? string('executable') : '',
  };
}
