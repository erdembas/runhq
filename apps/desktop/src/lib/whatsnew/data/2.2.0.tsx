import { Callout, KbdChip } from '@/components/whatsnew/inline';
import type { DocumentRelease } from '../types';

export const release_2_2_0: DocumentRelease = {
  kind: 'document',
  version: '2.2.0',
  releasedAt: '2026-09-23',
  headline: 'Run agent tasks in parallel, then review one combined result.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md',
  intro: (
    <p>
      RunHQ 2.2 lets a workflow carry separate tasks with their own instructions, agents and
      dependencies. Follow parallel work on a task board, bring the results together for review, and
      read agent activity with less scrolling and a larger diff viewer.
    </p>
  ),
  hooks: [
    {
      href: '#parallel-workflow-tasks',
      label: 'Parallel workflow tasks',
      detail: 'Give each task an instruction, an agent and the work it depends on.',
    },
    {
      href: '#workflow-task-board',
      label: 'A board for every workflow',
      detail: 'See what needs you, what is running and what is waiting.',
    },
    {
      href: '#reusable-task-graphs',
      label: 'Reusable task recipes',
      detail: 'Save instructions, dependencies and worktree choices together.',
    },
    {
      href: '#agent-activity-and-diffs',
      label: 'Clearer activity and diffs',
      detail: 'Fold completed tool calls into a summary and open edits full screen.',
    },
  ],
  sections: [
    {
      id: 'coordinating-agent-work',
      title: 'Coordinating agent work',
      subsections: [
        {
          id: 'parallel-workflow-tasks',
          title: 'Separate tasks, one reviewed result',
          badge: 'new',
          body: (
            <>
              <p>
                Build workflows with up to <strong>64 tasks</strong>. Each task has its own
                instruction, role, account or pool, model and dependencies. Independent tasks can
                run together within your capacity limits; give tasks that change code their own
                worktrees to keep parallel edits separate.
              </p>
              <p>
                Results come together in the workflow&apos;s checkout in the declared order.
                Conflicts show the affected paths and pause progress. A final independent review
                must see the combined result before checks and integration can proceed.
              </p>
              <Callout tone="note" title="You choose when to integrate">
                Automatic progression runs eligible tasks and recorded checks. Applying the reviewed
                result to your project remains an explicit action.
              </Callout>
            </>
          ),
        },
        {
          id: 'workflow-task-board',
          title: 'See what is moving and what is blocked',
          badge: 'new',
          body: (
            <p>
              Follow tasks across <strong>Needs you</strong>, <strong>Working</strong>,{' '}
              <strong>Ready</strong>, <strong>Waiting</strong> and <strong>Done</strong>. Cards show
              their account, dependencies and how many tasks they hold up. Start one task or choose{' '}
              <strong>Start unblocked</strong> to launch everything ready to run, then open a
              conversation directly to answer an agent or inspect its result.
            </p>
          ),
        },
        {
          id: 'reusable-task-graphs',
          title: 'Keep the whole workflow in a recipe',
          badge: 'improved',
          body: (
            <p>
              Recipes now preserve each task&apos;s instruction, dependencies and worktree choice.
              Use parameters in task instructions to adapt a saved workflow to the next job.
              Existing recipes and workflows retain their sequential order.
            </p>
          ),
        },
      ],
    },
    {
      id: 'reading-agent-work',
      title: 'Reading agent work',
      subsections: [
        {
          id: 'agent-activity-and-diffs',
          title: 'Compact activity, roomier change review',
          badge: 'improved',
          body: (
            <>
              <p>
                Tool calls and reasoning steps form one activity block. It shows the current step
                while work runs and folds into a readable summary when finished; failed steps stay
                visible. File paths are relative to the task, and Codex and OpenCode tool calls
                retain useful labels when a provider sends an empty title.
              </p>
              <p>
                Expand a file edit for an inline diff or open it full screen with{' '}
                <strong>Split</strong> and <strong>Inline</strong> views. Press{' '}
                <KbdChip>Escape</KbdChip> to return to the conversation. Activity counts describe
                the edits requested by the agent; the <strong>Changes</strong> tab shows the current
                workspace changes.
              </p>
            </>
          ),
        },
      ],
    },
  ],
};
