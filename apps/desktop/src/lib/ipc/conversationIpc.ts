import { invoke } from '@tauri-apps/api/core';
import type { Conversation, ConversationSummary } from '@/types';

export const conversationIpc = {
  listConversations: (
    input: {
      limit?: number;
      include_archived?: boolean;
      favorites_only?: boolean;
      query?: string | null;
    } = {},
  ) =>
    invoke<ConversationSummary[]>('list_conversations', {
      input: {
        limit: input.limit ?? null,
        include_archived: input.include_archived ?? false,
        favorites_only: input.favorites_only ?? false,
        query: input.query ?? null,
      },
    }),
  getConversation: (id: string) => invoke<Conversation>('get_conversation', { id }),
  createConversation: (input: { title: string; origin: string; context_json?: string | null }) =>
    invoke<string>('create_conversation', {
      input: {
        title: input.title,
        origin: input.origin,
        context_json: input.context_json ?? null,
      },
    }),
  appendConversationMessage: (input: {
    conversation_id: string;
    client_id?: string | null;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string | null;
    provider_id?: string | null;
    provider_name?: string | null;
    model_name?: string | null;
    finish_reason?: string | null;
    partial?: boolean;
    error?: string | null;
  }) =>
    invoke<string>('append_conversation_message', {
      input: {
        conversation_id: input.conversation_id,
        client_id: input.client_id ?? null,
        role: input.role,
        content: input.content,
        reasoning: input.reasoning ?? null,
        provider_id: input.provider_id ?? null,
        provider_name: input.provider_name ?? null,
        model_name: input.model_name ?? null,
        finish_reason: input.finish_reason ?? null,
        partial: input.partial ?? false,
        error: input.error ?? null,
      },
    }),
  renameConversation: (id: string, title: string) =>
    invoke<void>('rename_conversation', { input: { id, title } }),
  pinConversation: (id: string, pinned: boolean) =>
    invoke<void>('pin_conversation', { input: { id, pinned } }),
  favoriteConversation: (id: string, favorite: boolean) =>
    invoke<void>('favorite_conversation', { input: { id, favorite } }),
  archiveConversation: (id: string, archived: boolean) =>
    invoke<void>('archive_conversation', { input: { id, archived } }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),
};
