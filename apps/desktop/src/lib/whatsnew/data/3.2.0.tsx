import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_2_0: DocumentRelease = {
  kind: 'document',
  version: '3.2.0',
  releasedAt: '2026-09-24',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.2.0',
  get headline() {
    return i18n.t('Visual workflows, on your schedule.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.2 makes the workflow map the default editor and lets new agent tasks wait for active work to finish.',
        )}
      </p>
    );
  },
  hooks: [
    {
      href: '#workflow-map',
      get label() {
        return i18n.t('Build your workflow on the map');
      },
      get detail() {
        return i18n.t('Drag steps, connect dependencies and adjust the workflow in one place.');
      },
    },
    {
      href: '#task-timing',
      get label() {
        return i18n.t('Choose when a new task starts');
      },
      get detail() {
        return i18n.t(
          'Start alongside active work or wait for a selected task to finish successfully.',
        );
      },
    },
    {
      href: '#workflow-controls',
      get label() {
        return i18n.t('Controls that fit your workspace');
      },
      get detail() {
        return i18n.t('Consistent menus, checkboxes and forms in English and Turkish.');
      },
    },
  ],
  sections: [
    {
      id: 'workflows',
      get title() {
        return i18n.t('Workflows');
      },
      subsections: [
        {
          id: 'workflow-map',
          badge: 'improved',
          get title() {
            return i18n.t('Build your workflow on the map');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Workflows now open on the interactive map. Move steps, connect their ports, remove connections, zoom and arrange the graph. Dragged positions stay in place when you switch views, edit connections or change language.',
                )}
              </p>
            );
          },
        },
        {
          id: 'task-timing',
          badge: 'new',
          get title() {
            return i18n.t('Choose when a new task starts');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'When a project has active work, choose whether a new task starts now or waits for a selected task to finish successfully. Waiting keeps the new task’s own workspace, model and context. You can open the preceding task or start the queued task immediately.',
                  )}
                </p>
                <p>
                  {i18n.t(
                    'Failed or deleted preceding tasks pause the queue for your decision. Saved queues remain available after restarting RunHQ and wait for you to review and resume them.',
                  )}
                </p>
              </>
            );
          },
        },
        {
          id: 'workflow-controls',
          badge: 'improved',
          get title() {
            return i18n.t('Controls that fit your workspace');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Workflow selections now use themed dropdowns, with matching radio buttons, checkboxes and text fields. A compact project form leaves more room for the map, and all new controls support English and Turkish.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
