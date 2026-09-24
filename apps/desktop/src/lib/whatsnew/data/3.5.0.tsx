import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { DocumentRelease } from '../types';

export const release_3_5_0: DocumentRelease = {
  kind: 'document',
  version: '3.5.0',
  releasedAt: '2026-09-24',
  changelogUrl: 'https://github.com/erdembas/runhq/releases/tag/v3.5.0',
  get headline() {
    return i18n.t('Long coding workflows, under your control.');
  },
  get intro() {
    return (
      <p>
        {i18n.t(
          'RunHQ 3.5 imports complete workflow packages, verifies each stage and keeps approvals, review rounds and recovery in one place.',
        )}
      </p>
    );
  },
  hooks: [],
  sections: [
    {
      id: 'highlight-1',
      get title() {
        return i18n.t('Open a package as a one-time workflow');
      },
      subsections: [
        {
          id: 'highlight-1-details',
          badge: 'new',
          get title() {
            return i18n.t('Open a package as a one-time workflow');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Import JSON or ZIP packages with prompt files, scripts and up to 512 steps. Inspect the target repositories and agents before starting; saving a reusable recipe is optional.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'highlight-2',
      get title() {
        return i18n.t('Verify, review and correct with clear limits');
      },
      subsections: [
        {
          id: 'highlight-2-details',
          badge: 'new',
          get title() {
            return i18n.t('Verify, review and correct with clear limits');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Combine agent tasks, terminal checks, human approvals and dependency gates. Use conditions, resource locks and bounded correction rounds; independent reviews use captured read-only copies and retain their reports.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'highlight-3',
      get title() {
        return i18n.t('Recover long runs with their history intact');
      },
      subsections: [
        {
          id: 'highlight-3-details',
          badge: 'new',
          get title() {
            return i18n.t('Recover long runs with their history intact');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Set step deadlines and inspect recorded attempts, command output and review decisions. Failed checks stop new work; interrupted runs wait for your decision before retrying.',
                )}
              </p>
            );
          },
        },
      ],
    },
    {
      id: 'highlight-4',
      get title() {
        return i18n.t('Pause supported agents and continue');
      },
      subsections: [
        {
          id: 'highlight-4-details',
          badge: 'new',
          get title() {
            return i18n.t('Pause supported agents and continue');
          },
          get body() {
            return (
              <p>
                {i18n.t(
                  'Pause Claude and OpenCode at supported checkpoints, then continue the same conversation. Codex and Cursor keep their existing stop controls.',
                )}
              </p>
            );
          },
        },
      ],
    },
  ],
};
