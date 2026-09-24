import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_4_0: DocumentRelease = {
  kind: 'document',
  version: '3.4.0',
  releasedAt: '2026-09-24',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.4.0',
  get headline() {
    return i18n.t('Your projects and tasks, together.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.4 brings project tools into one workspace, keeps task conversations beside their changes and connects multiple projects in shared workspaces.',
        )}
      </p>
    );
  },
  hooks: [],
  sections: [
    {
      id: 'project-workspace',
      get title() {
        return i18n.t('A workspace for each project');
      },
      subsections: [
        {
          id: 'project-workspace-details',
          badge: 'new',
          get title() {
            return i18n.t('A workspace for each project');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Move between overview, agents, run commands, Git, docs, notes and health checks within the same project. Preview the README and keep open terminals and task drafts while navigating.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'task-changes',
      get title() {
        return i18n.t('Review changes beside the conversation');
      },
      subsections: [
        {
          id: 'task-changes-details',
          badge: 'new',
          get title() {
            return i18n.t('Review changes beside the conversation');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Browse changed files in a folder tree, inspect diffs and expand the changes view without losing your selection or scroll position. Open a terminal in the task workspace when you need it.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'multi-project',
      get title() {
        return i18n.t('Work across selected projects');
      },
      subsections: [
        {
          id: 'multi-project-details',
          badge: 'new',
          get title() {
            return i18n.t('Work across selected projects');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Create a workspace from projects under a shared folder, choose which projects each task can use and save shared instructions. Configure run groups and inspect changes and recorded checks by project.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'workflow-studio',
      get title() {
        return i18n.t('More room for workflows');
      },
      subsections: [
        {
          id: 'workflow-studio-details',
          badge: 'new',
          get title() {
            return i18n.t('More room for workflows');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Expand the workflow studio, follow execution progress and find tasks that need attention. Section navigation keeps projects and shared workspaces organized.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
