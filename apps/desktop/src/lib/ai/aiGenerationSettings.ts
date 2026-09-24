import type { AgentBackend } from '@/types';

/** Stored per use case and copied onto a conversation's provider selection. */
export interface AiGenerationSettings {
  model: string;
  effort?: string;
  mode?: 'default' | 'plan';
  agent?: string;
}

export type AiGenerationChange =
  | { kind: 'model'; value: string }
  | { kind: 'effort'; value: string }
  | { kind: 'mode'; value: 'default' | 'plan' }
  | { kind: 'agent'; value: string }
  | { kind: 'reset' };

export function defaultCliChatMode(backend: Pick<AgentBackend, 'id' | 'adapter'>) {
  return ['codex', 'claude', 'opencode'].includes(backend.adapter ?? backend.id)
    ? ('plan' as const)
    : ('default' as const);
}

export function aiGenerationSettings(value: AiGenerationSettings): AiGenerationSettings {
  return { model: value.model, effort: value.effort, mode: value.mode, agent: value.agent };
}

/** The same transitions as New conversation, applied atomically for ACP's two callbacks. */
export function changeAiGenerationSettings<T extends AiGenerationSettings>(
  current: T,
  change: AiGenerationChange,
  adapter?: string,
): T {
  switch (change.kind) {
    case 'model':
      return { ...current, model: change.value, effort: '' };
    case 'effort':
      return { ...current, effort: change.value };
    case 'mode':
      return { ...current, mode: change.value, agent: '' };
    case 'agent':
      return {
        ...current,
        agent: change.value,
        ...((adapter === 'opencode' || adapter === 'acp') && change.value
          ? { mode: change.value === 'plan' ? ('plan' as const) : ('default' as const) }
          : {}),
      };
    case 'reset':
      return { ...current, model: '', effort: '', mode: undefined, agent: '' };
  }
}
