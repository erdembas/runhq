import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { ConversationOrigin } from '@/types';
import { aiGenerationSettings, type AiGenerationSettings } from './aiGenerationSettings';
import type { AiChatProvider } from '@/components/ai/chat-panel/aiChatProviders';
import { canUseChatProvider } from '@/components/ai/chat-panel/aiChatProviders';

export type AiUseCase = 'default' | ConversationOrigin;
export interface AiSelection extends AiGenerationSettings {
  providerId: string;
}
export type AiPreferences = Partial<Record<AiUseCase, AiSelection>>;
export const aiUseCases: AiUseCase[] = [
  'default',
  'free',
  'commit',
  'diff',
  'log',
  'standup',
  'why',
  'dashboard_report',
  'advisory',
  'license',
];
export function isAiConversationOrigin(value: string): value is ConversationOrigin {
  return aiUseCases.some((entry) => entry !== 'default' && entry === value);
}

export const aiPreferencesKey = 'runhq.ai.preferences.v1';
export const aiPreferencesEvent = 'runhq:ai-preferences-changed';

export function readAiPreferences(): AiPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(aiPreferencesKey) || '{}');
    const result: AiPreferences = {};
    for (const key of aiUseCases) {
      const entry = parsed?.[key];
      if (typeof entry?.providerId === 'string' && entry.providerId.trim()) {
        result[key] = {
          providerId: entry.providerId,
          model: typeof entry.model === 'string' ? entry.model.trim() : '',
          effort: typeof entry.effort === 'string' ? entry.effort.trim() : '',
          mode: entry.mode === 'default' || entry.mode === 'plan' ? entry.mode : undefined,
          agent: typeof entry.agent === 'string' ? entry.agent.trim() : '',
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveAiSelection(useCase: AiUseCase, selection: AiSelection | null) {
  const preferences = readAiPreferences();
  if (selection?.providerId) preferences[useCase] = { ...selection, model: selection.model.trim() };
  else delete preferences[useCase];
  localStorage.setItem(aiPreferencesKey, JSON.stringify(preferences));
  window.dispatchEvent(new Event(aiPreferencesEvent));
}

/** Explicit unavailable choices must never silently send context to another provider. */
export function configuredAiProvider(
  providers: AiChatProvider[],
  origin: ConversationOrigin,
  preferences = readAiPreferences(),
): AiChatProvider | null {
  const selection = preferences[origin] ?? preferences.default;
  if (!selection) return null;
  const provider = providers.find((entry) => entry.id === selection.providerId);
  if (!provider || !canUseChatProvider(provider)) {
    throw new Error(
      i18n.t(
        'The AI provider selected for this use case is unavailable. Update its selection in Settings → AI providers.',
      ),
    );
  }
  return {
    ...provider,
    ...aiGenerationSettings(selection),
    model: selection.model || provider.model,
  };
}
