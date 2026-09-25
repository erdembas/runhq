import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_6_0: DocumentRelease = {
  kind: 'document',
  version: '3.6.0',
  releasedAt: '2026-09-25',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.6.0',
  get headline() {
    return i18n.t('Every workflow, in one editor.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.6 replaces the separate package screen with the Workflow editor, bringing imported steps, agent settings and execution into one place.',
        )}
      </p>
    );
  },
  hooks: [],
  sections: [
    {
      id: 'workflow-import',
      get title() {
        return i18n.t('Import packages into the Workflow editor');
      },
      subsections: [
        {
          id: 'workflow-import-details',
          badge: 'improved',
          get title() {
            return i18n.t('Import packages into the Workflow editor');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'JSON and ZIP imports now open as editable Workflow drafts. Change prompts and dependencies in the graph, then create and run the workflow. Package files are captured without starting an agent or script.',
                  )}
                </p>
                <p>
                  {i18n.t(
                    'Reimport an older package’s original JSON or ZIP to open it in the new editor. Stored files are kept, but previous package runs are not converted automatically.',
                  )}
                </p>
              </>
            );
          },
        },
      ],
    },
    {
      id: 'step-agent-settings',
      get title() {
        return i18n.t('Choose agent settings for every step');
      },
      subsections: [
        {
          id: 'step-agent-settings-details',
          badge: 'improved',
          get title() {
            return i18n.t('Choose agent settings for every step');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Select each step’s agent connection, model and reasoning effort from the available options. Implementation steps can also use supported agent profiles. Your choices stay with the workflow when you edit or retry it.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'workflow-controls',
      get title() {
        return i18n.t('Control approvals and review rounds');
      },
      subsections: [
        {
          id: 'workflow-controls-details',
          badge: 'improved',
          get title() {
            return i18n.t('Control approvals and review rounds');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Edit human approvals, conditional gates, shell checks, timeouts and bounded correction rounds alongside your agent tasks. Inspect recorded results and approve the next step from the same workflow.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'review-snapshots',
      get title() {
        return i18n.t('Review the changes that were checked');
      },
      subsections: [
        {
          id: 'review-snapshots-details',
          badge: 'improved',
          get title() {
            return i18n.t('Review the changes that were checked');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Work in the selected repositories and give independent reviewers captured copies of the checked changes. Later edits stay outside that review. An extra review after manual corrections repeats verification before capturing a fresh snapshot.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
