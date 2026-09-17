import type { AgentBackendId } from '@runhq/cockpit-types';

export const agentProviderNames: Record<AgentBackendId, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  claude: 'Claude',
  cursor: 'Cursor',
};
