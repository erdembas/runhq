import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentItem, AgentSession } from '@runhq/cockpit-types';

/** A new task that continues another task's work, prepared for the composer before it starts. */
export interface AgentHandoffDraft {
  id: string;
  sourceSessionId: string;
  projectId: string;
  title: string;
  prompt: string;
  /** The connection the composer opens on; empty leaves the choice to the user. */
  backend: string;
}

/** Summarize the source task's recent conversation into the next task's first message. */
export function agentHandoffDraft(
  source: AgentSession,
  items: AgentItem[],
  backend: string,
): AgentHandoffDraft {
  return {
    id: crypto.randomUUID(),
    sourceSessionId: source.id,
    projectId: source.project_id,
    title: i18n.t('Follow up · {value1}', { value1: source.title }),
    // Instructions for the agent, not interface text: they stay in English like other prompts.
    prompt: `Continue the work described below in a new agent session. Inspect the current files before making changes.\n\nSource task: ${source.title}\nWorkspace: ${source.cwd}\nBranch: ${source.branch || 'local checkout'}\n\nRecent conversation:\n${items
      .filter((item) => ['user', 'assistant', 'plan'].includes(item.kind))
      .slice(-6)
      .map((item) => `${item.kind}: ${item.text}`)
      .join('\n\n')
      .slice(-60000)}\n\nNext objective: `,
    backend,
  };
}
