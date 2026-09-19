import type { AgentBackend, AiProvider } from '@/types';

export interface CliChatProvider {
  id: string;
  name: string;
  model: string;
  default: boolean;
  context_window?: number | null;
  cli: AgentBackend;
}

export type AiChatProvider = AiProvider | CliChatProvider;

export function isCliChatProvider(provider: AiChatProvider): provider is CliChatProvider {
  return 'cli' in provider;
}

export function canUseChatProvider(provider: AiChatProvider) {
  return !isCliChatProvider(provider) || provider.cli.available;
}

export function cliChatProviders(backends: AgentBackend[]): CliChatProvider[] {
  return backends
    .filter((backend) => backend.enabled !== false && backend.adapter !== 'terminal')
    .map((cli) => ({ id: `cli:${cli.id}`, name: cli.name, model: '', default: false, cli }));
}

const selectionKey = 'runhq:ai-chat-provider';

export function selectedChatProviderId(): string | null {
  try {
    return localStorage.getItem(selectionKey);
  } catch {
    return null;
  }
}

export function rememberChatProvider(provider: AiChatProvider) {
  try {
    localStorage.setItem(selectionKey, provider.id);
  } catch {
    // Selection still works when browser storage is unavailable.
  }
}
