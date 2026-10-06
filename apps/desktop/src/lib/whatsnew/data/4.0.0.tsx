// `rich` lives on the React entry; it keeps the <code> elements inside the translated sentence.
import * as i18n from '@runhq/cockpit-ui/i18n';
import { Callout } from '@/components/whatsnew/inline';
import type { DocumentRelease } from '../types';

export const release_4_0_0: DocumentRelease = {
  kind: 'document',
  version: '4.0.0',
  releasedAt: '2026-10-06',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v4.0.0',
  get headline() {
    return i18n.t('RunHQ 4.0 focuses on individual agent tasks.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'Workflows, isolated worktrees and the Library are removed. Tasks, the decision inbox, Hand off and account pools stay as they were.',
        )}
      </p>
    );
  },
  hooks: [],
  sections: [
    {
      id: 'removed',
      get title() {
        return i18n.t('Removed features');
      },
      subsections: [
        {
          id: 'removed-workflows',
          get title() {
            return i18n.t('Workflows');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'The Workflows view, the Workflow editor, JSON and ZIP workflow packages, review and correction rounds, and approval and gate steps are no longer available. Run each piece of work as its own task, and use Hand off to continue it with another agent.',
                )}
              </p>
            );
          },
        },
        {
          id: 'removed-worktrees',
          get title() {
            return i18n.t('Isolated worktrees');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'New tasks run in the project’s own checkout. Tasks that earlier versions created in an isolated worktree still open in their existing folder.',
                )}
              </p>
            );
          },
        },
        {
          id: 'removed-library',
          get title() {
            return i18n.t('Library');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Task recipes and their schedules, history search, history export, import and retention, and project decisions are no longer available. To give a new task background, attach files, logs or notes from Context.',
                )}
              </p>
            );
          },
        },
        {
          id: 'existing-data',
          get title() {
            return i18n.t('Your existing data');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'Earlier workflow records, workflow run folders and worktree folders stay on disk and are no longer shown. Conversations that workflows started now appear as ordinary tasks. Saved recipes, schedules and project decisions stay in the database but are no longer shown. Conversations imported from history archives still open read-only.',
                  )}
                </p>
                <Callout tone="note">
                  {i18n.rich(
                    'To free disk space, delete the {runs} and {worktrees} folders in the RunHQ data directory once you no longer need their files.',
                    { runs: <code>workflow-runs</code>, worktrees: <code>worktrees</code> },
                  )}
                </Callout>
              </>
            );
          },
        },
      ],
    },
  ],
};
