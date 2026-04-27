import type { AiActionHook } from '@/store/useAppStore';

/**
 * Cross-component event names dispatched by the AI chat panel when the
 * user clicks an action button on an assistant turn. The owning
 * surface (CommitPanel, ActivityTimeline, …) listens for these on
 * `window` and consumes the payload.
 *
 * Why an event bus and not direct store calls?
 *
 *   - The chat panel shouldn't have to know that "use_as_commit"
 *     means "find the CommitPanel mounted for this service id and
 *     call setCommitDraft on it". That mapping lives with the
 *     surface, not the chat.
 *   - Tauri's main thread is single-process: events fire
 *     synchronously, no deserialisation cost vs. wiring a Zustand
 *     reducer for every new action surface.
 *   - Decoupling means a future "Insert into terminal" hook is
 *     literally one new event name + one listener, no chat-panel
 *     knowledge required.
 */
export const AI_ACTION_EVENTS = {
  /** Fired when the user clicks "Use as commit message" under an
   *  assistant turn whose hook is `use_as_commit`. Payload carries
   *  the assistant content + the resolved service id so the
   *  CommitPanel can match its own mounted instance. */
  useAsCommit: 'runhq:ai-action:use-as-commit',
  /** Fired for the standup hook. The ActivityTimeline picks it up
   *  and prepends the message into its current draft. */
  insertStandup: 'runhq:ai-action:insert-standup',
} as const;

export interface UseAsCommitDetail {
  service_id: string;
  content: string;
}

export interface InsertStandupDetail {
  content: string;
}

/**
 * Dispatch the right event for an action hook. Returns `true` if a
 * dispatch happened (i.e. the hook had a meaningful kind). Centralised
 * so future hook kinds are added in one place.
 */
export function dispatchAiAction(hook: AiActionHook, content: string): boolean {
  switch (hook.kind) {
    case 'use_as_commit':
      window.dispatchEvent(
        new CustomEvent<UseAsCommitDetail>(AI_ACTION_EVENTS.useAsCommit, {
          detail: { service_id: hook.service_id, content },
        }),
      );
      return true;
    case 'insert_standup':
      window.dispatchEvent(
        new CustomEvent<InsertStandupDetail>(AI_ACTION_EVENTS.insertStandup, {
          detail: { content },
        }),
      );
      return true;
    case 'none':
      return false;
  }
}

/**
 * Human-readable label for an action hook button. Kept out of the
 * TurnView component so a future locale layer has a single place to
 * touch. The "none" kind returns null — call sites should null-guard
 * before rendering.
 */
export function actionHookLabel(hook: AiActionHook): string | null {
  switch (hook.kind) {
    case 'use_as_commit':
      return 'Use as commit message';
    case 'insert_standup':
      return 'Insert into standup draft';
    case 'none':
      return null;
  }
}
