import { invoke } from '@tauri-apps/api/core';
import type {
  AiProvider,
  AiProviderInput,
  AiTestResult,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  GenerateCommitResult,
  ServiceId,
  StreamChunk,
} from '@/types';
import { invokeStream } from './streamIpc';

export const aiIpc = {
  listAiProviders: () => invoke<AiProvider[]>('list_ai_providers'),
  upsertAiProvider: (input: AiProviderInput) => invoke<AiProvider>('upsert_ai_provider', { input }),
  removeAiProvider: (id: string) => invoke<boolean>('remove_ai_provider', { id }),
  setDefaultAiProvider: (id: string) => invoke<boolean>('set_default_ai_provider', { id }),
  testAiProvider: (id: string) => invoke<AiTestResult>('test_ai_provider', { id }),
  aiChatCompletion: (input: {
    provider_id?: string | null;
    messages: ChatMessage[];
    options?: ChatOptions;
  }) => invoke<ChatResponse>('ai_chat_completion', { input }),
  aiGenerateCommitMessage: (input: {
    service_id: ServiceId;
    provider_id?: string | null;
    hint?: string | null;
  }) => invoke<GenerateCommitResult>('ai_generate_commit_message', { input }),
  aiCommitChatContext: (input: { service_id: ServiceId }) =>
    invoke<{
      branch: string | null;
      diff: string;
      recent_subjects: string[];
      diff_truncated: boolean;
    }>('ai_commit_chat_context', { input }),

  aiChatCompletionStream: (
    input: {
      provider_id?: string | null;
      messages: ChatMessage[];
      options?: ChatOptions;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_chat_completion_stream', input, onChunk),

  aiExplainDiff: (
    input: {
      diff: string;
      file_path?: string | null;
      selection_only?: boolean;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_explain_diff', input, onChunk),

  aiExplainLog: (
    input: {
      line: string;
      context_lines?: string[];
      runtime?: string | null;
      service_name?: string | null;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_explain_log', input, onChunk),

  aiPolishStandup: (
    input: {
      raw_markdown: string;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_polish_standup', input, onChunk),

  aiTriageAdvisories: (
    input: {
      advisories: {
        id: string | null;
        package: string;
        severity: string;
        title: string;
        vulnerable_range: string | null;
        fix_version: string | null;
      }[];
      project_name?: string | null;
      runtime?: string | null;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_triage_advisories', input, onChunk),

  aiCountTokens: async (texts: string[]): Promise<number> => {
    const out = await invoke<{ tokens: number }>('ai_count_tokens', {
      input: { texts },
    });
    return out.tokens;
  },

  aiAnalyzeWorkspace: (
    input: {
      facts: Record<string, unknown>;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_analyze_workspace', input, onChunk),

  aiExplainProjectState: (
    input: {
      headline: string;
      facts: Record<string, unknown>;
      provider_id?: string | null;
    },
    onChunk: (chunk: StreamChunk) => void,
  ) => invokeStream('ai_explain_project_state', input, onChunk),
};
