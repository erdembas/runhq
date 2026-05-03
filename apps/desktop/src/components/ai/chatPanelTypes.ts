import type { AiActionHook } from '@/store/useAppStore';

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  reasoningStartedAtMs?: number;
  reasoningEndedAtMs?: number;
  streamStartedAtMs?: number;
  streaming?: boolean;
  error?: string;
  finishReason?: string | null;
  partial?: boolean;
  providerName?: string;
  modelName?: string;
  actionHook?: AiActionHook;
}
