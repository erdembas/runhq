import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_7_0: DocumentRelease = {
  kind: 'document',
  version: '3.7.0',
  releasedAt: '2026-09-25',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.7.0',
  get headline() {
    return i18n.t('Choose models for a whole workflow at once.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.7 lets you set the agent, model and reasoning level for every step of the same type in one place.',
        )}
      </p>
    );
  },
  hooks: [],
  sections: [
    {
      id: 'role-models',
      get title() {
        return i18n.t('Models by step type');
      },
      subsections: [
        {
          id: 'role-models-details',
          badge: 'new',
          get title() {
            return i18n.t('Models by step type');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'In the Workflow editor, choose settings for implementation, review, revision, planning or validation steps and apply them to every step of that type that has not started yet.',
                  )}
                </p>
                <p>
                  {i18n.t(
                    'Commands, gates and review policies stay unchanged. Steps that switch to a different agent start a new conversation instead of continuing another agent’s session.',
                  )}
                </p>
              </>
            );
          },
        },
      ],
    },
  ],
};
