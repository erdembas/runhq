import { Callout, KbdChip } from '@/components/whatsnew/inline';
import type { DocumentRelease } from '../types';

export const release_2_0_0: DocumentRelease = {
  kind: 'document',
  version: '2.0.0',
  releasedAt: '2026-09-17',
  headline: 'Your agents, plans and prototypes join the project workspace.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md',
  intro: (
    <p>
      RunHQ 2.0 brings coding agents alongside your services. Follow tasks across projects, review a
      plan before building, and try generated prototypes in Canvas. Agent setup is clearer, while
      streaming conversations, busy terminals and large log backlogs do less work on the interface.
    </p>
  ),
  hooks: [
    {
      href: '#agent-workspace',
      label: 'Agent workspace',
      detail: 'Codex, OpenCode, Claude and Cursor tasks in one project-aware view.',
    },
    {
      href: '#plans-canvas-queue',
      label: 'Plan, preview and continue',
      detail: 'Editable plans, interactive Canvas artifacts and queued follow-ups.',
    },
    {
      href: '#agent-connections',
      label: 'Clearer agent connections',
      detail: 'Installed agents first, real model discovery and actionable setup errors.',
    },
    {
      href: '#workspace-responsiveness',
      label: 'Less background work',
      detail: 'Focused updates for conversations, logs, terminals and hidden views.',
    },
  ],
  sections: [
    {
      id: 'agents-in-your-workspace',
      title: 'Agents in your workspace',
      subsections: [
        {
          id: 'agent-workspace',
          title: 'Every project has a place for agent tasks',
          badge: 'new',
          body: (
            <>
              <p>
                Run <strong>Codex, OpenCode and Claude</strong> sessions, connect{' '}
                <strong>Cursor through ACP</strong>, or configure another ACP-compatible tool. The
                global <strong>Agents</strong> workspace brings your tasks together; each project
                also has its own Agents tab.
              </p>
              <p>
                Mission Control groups tasks into <strong>Needs attention</strong>,{' '}
                <strong>Working</strong>, <strong>Ready</strong> and <strong>Completed</strong>.
                Filter by project, search conversations, answer questions and approvals, and open
                changes or a workspace terminal from the same session. New tasks can use the current
                checkout or an isolated Git worktree.
              </p>
              <Callout tone="tip" title="Start with a direction">
                Choose a planning, bug-fix, review or Canvas template, then edit the prompt. Press{' '}
                <KbdChip>Cmd/Ctrl+Enter</KbdChip> when you are ready to start.
              </Callout>
            </>
          ),
        },
      ],
    },
    {
      id: 'from-plan-to-result',
      title: 'From plan to result',
      subsections: [
        {
          id: 'plans-canvas-queue',
          title: 'Review the approach and work with the output',
          badge: 'new',
          body: (
            <>
              <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li>
                  <strong>Plans:</strong> use the modes supported by your agent, review and edit its
                  plan, then choose <strong>Build this plan</strong> to start implementation in the
                  same conversation. Cursor exposes its advertised Agent, Plan and Ask modes.
                </li>
                <li>
                  <strong>Canvas:</strong> open complete HTML, SVG and Markdown code blocks from
                  agent responses. Preview interactive HTML, edit the source, compare desktop and
                  mobile widths, and save the result as a file. Edits stay local to RunHQ.
                </li>
                <li>
                  <strong>Follow-up queue:</strong> add the next message while an agent works,
                  reorder or remove queued messages, and retry a failed send. The queue continues
                  across tabs while RunHQ is open and pauses after a stopped or failed turn.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      id: 'connecting-your-tools',
      title: 'Connecting your tools',
      subsections: [
        {
          id: 'agent-connections',
          title: 'Installed agents first, with clear connection status',
          badge: 'improved',
          body: (
            <>
              <p>
                RunHQ checks installed CLIs and common installation locations, prioritizes available
                agents, and preserves your explicit selection and executable override. A single
                connection row distinguishes a missing CLI, a blocked installation and an
                authentication or model-discovery error, with actions to recheck or configure the
                connection.
              </p>
              <p>
                Model and mode choices come from the connected agent. New tasks wait for a
                successful connection, an empty model catalog can use the provider&apos;s default,
                and <strong>Use agent default</strong> recovers from an invalid pinned model. Failed
                first messages retain their conversation and draft for retry.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'a-more-responsive-workspace',
      title: 'A more responsive workspace',
      subsections: [
        {
          id: 'workspace-responsiveness',
          title: 'Focused updates for streaming work',
          badge: 'improved',
          body: (
            <>
              <p>
                Hidden panels pause polling and subscriptions while projects retain their drafts,
                scroll positions and terminal sessions. Streaming agent messages update the affected
                content, and overlapping workspace and model requests share their results.
              </p>
              <p>
                Large log backlogs are processed in smaller batches so the interface can handle
                other work between updates. Terminal input and restart handling preserve input
                order, and an old paste cannot spill into a newly started shell. Blocking Git and
                filesystem operations also move away from the window&apos;s execution thread.
              </p>
            </>
          ),
        },
      ],
    },
  ],
};
