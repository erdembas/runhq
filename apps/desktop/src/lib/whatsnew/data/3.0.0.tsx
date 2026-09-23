import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_0_0: DocumentRelease = {
  kind: 'document',
  version: '3.0.0',
  releasedAt: '2026-09-23',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.0.0',
  get headline() {
    return i18n.t('Your workspace, in your language.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.0 brings Turkish and English to the desktop, a project-wide agent dashboard, and more control over prompt queues and reviews.',
        )}
      </p>
    );
  },
  hooks: [
    {
      href: '#desktop-language',
      get label() {
        return i18n.t('Turkish and English');
      },
      get detail() {
        return i18n.t(
          'Switch the desktop language instantly, including menus, hints and notifications.',
        );
      },
    },
    {
      href: '#agent-dashboard',
      get label() {
        return i18n.t('All your agents in one view');
      },
      get detail() {
        return i18n.t(
          'Find active tasks across projects and jump straight into their conversations.',
        );
      },
    },
    {
      href: '#prompt-queues',
      get label() {
        return i18n.t('Prompt queues you can control');
      },
      get detail() {
        return i18n.t('Choose when work starts, edit waiting prompts and set the review policy.');
      },
    },
  ],
  sections: [
    {
      id: 'interface',
      get title() {
        return i18n.t('A desktop that speaks your language');
      },
      subsections: [
        {
          id: 'desktop-language',
          badge: 'new',
          get title() {
            return i18n.t('Turkish and English');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'Choose Turkish or English in Settings → General. Your choice is saved and applies immediately across the main window, quick actions and tray menus. Dates, numbers and durations follow the selected language.',
                  )}
                </p>
                <p>
                  {i18n.t(
                    'Changing language keeps your drafts and open tasks. Agent responses, your own writing, project names, code and logs keep their original content. AI response and commit-message languages remain separate settings.',
                  )}
                </p>
              </>
            );
          },
        },
      ],
    },
    {
      id: 'agents',
      get title() {
        return i18n.t('All your agents in one view');
      },
      subsections: [
        {
          id: 'agent-dashboard',
          badge: 'new',
          get title() {
            return i18n.t('Follow work across projects');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'The agent dashboard groups tasks by what needs attention, what is working, what is ready and what is complete. Search tasks, agents and models, filter by project or status, and open a conversation to answer or continue.',
                  )}
                </p>
              </>
            );
          },
        },
        {
          id: 'prompt-queues',
          badge: 'new',
          get title() {
            return i18n.t('Build and adjust a prompt queue');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'Write a sequence of prompts, keep them in one conversation or use separate tasks, and choose a model and reasoning level for each step. Add review steps where you need them and follow dependencies on the workflow map.',
                  )}
                </p>
                <p>
                  {i18n.t(
                    'Start immediately or wait for an active task to finish. You can edit waiting steps while keeping work that has already started intact, then save the queue and resume.',
                  )}
                </p>
              </>
            );
          },
        },
        {
          id: 'review-policy',
          badge: 'new',
          get title() {
            return i18n.t('Decide what happens after a review');
          },
          get body() {
            return (
              <>
                <p>
                  {i18n.t(
                    'Pause when issues are found, always wait for your approval, try one correction and review again, or pass findings to the next prompt. Unclear verdicts wait for your decision when the selected policy requires it. Applying changes to your project still requires your approval.',
                  )}
                </p>
              </>
            );
          },
        },
        {
          id: 'permission-preferences',
          badge: 'new',
          get title() {
            return i18n.t('Permission preferences');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'In Settings → General, choose whether agents ask for tool permissions or automatically approve recognized requests. Always ask remains the default. Questions still need your response, and plan mode and independent reviews keep their approval boundaries. Automatic decisions appear in the conversation.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
