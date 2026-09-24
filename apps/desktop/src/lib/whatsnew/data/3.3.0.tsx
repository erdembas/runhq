import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_3_0: DocumentRelease = {
  kind: 'document',
  version: '3.3.0',
  releasedAt: '2026-09-24',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.3.0',
  get headline() {
    return i18n.t('Your next message, on your terms.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.3 fixes immediate task starts, lets queued messages take over the current conversation and makes Enter the default send key.',
        )}
      </p>
    );
  },
  hooks: [
    {
      href: '#parallel-start',
      get label() {
        return i18n.t('Start independent tasks together');
      },
      get detail() {
        return i18n.t(
          'Start now works in your selected local workspace, even with another task running.',
        );
      },
    },
    {
      href: '#send-now',
      get label() {
        return i18n.t('Send a queued message now');
      },
      get detail() {
        return i18n.t(
          'Stop the current turn and continue with the next message in the same context.',
        );
      },
    },
    {
      href: '#send-shortcut',
      get label() {
        return i18n.t('Press Enter to send');
      },
      get detail() {
        return i18n.t(
          'Choose your send key in Keyboard Shortcuts; use Shift+Enter for a new line.',
        );
      },
    },
    {
      href: '#chat-defaults',
      get label() {
        return i18n.t('Keep your preferred chat settings');
      },
      get detail() {
        return i18n.t('Save the agent and options you want new chats to start with.');
      },
    },
  ],
  sections: [
    {
      id: 'tasks-and-messages',
      get title() {
        return i18n.t('Tasks and messages');
      },
      subsections: [
        {
          id: 'parallel-start',
          badge: 'fix',
          get title() {
            return i18n.t('Start independent tasks together');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Choose Start now to run independent tasks alongside each other in the selected local workspace. Saved first messages can be retried with their original workspace, model and context, without creating duplicate tasks.',
                )}
              </p>
            );
          },
        },
        {
          id: 'send-now',
          badge: 'new',
          get title() {
            return i18n.t('Send a queued message now');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Use Send now on a queued follow-up to stop the current turn and continue with that message in the same conversation. Your previous context is kept, and the other queued messages keep their order.',
                )}
              </p>
            );
          },
        },
        {
          id: 'send-shortcut',
          badge: 'improved',
          get title() {
            return i18n.t('Press Enter to send');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Enter now sends messages in agent conversations and AI chat. Use Shift+Enter for a new line, or choose Command/Ctrl+Enter in Settings → Keyboard Shortcuts if you prefer the previous behavior.',
                )}
              </p>
            );
          },
        },
        {
          id: 'chat-defaults',
          badge: 'new',
          get title() {
            return i18n.t('Keep your preferred chat settings');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Save your preferred agent, model, effort, mode and workspace for new agent chats in Settings. These defaults apply across projects while open drafts keep their choices and task recipes keep their own settings.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
