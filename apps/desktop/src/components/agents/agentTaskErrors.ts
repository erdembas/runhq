import * as i18n from '@runhq/cockpit-ui/i18n/core';

/**
 * Explain the backend's task create/start refusals in the interface language. Any other error keeps
 * its original technical text.
 */
export function agentTaskError(value: string): string {
  switch (value.replace(/^(?:Error: )?invalid input: /i, '')) {
    case 'Another agent owns this checkout. Wait for it to finish.':
      return i18n.t('Another agent owns this checkout. Wait for it to finish.');
    case 'Isolated worktrees are no longer supported.':
      return i18n.t('Isolated worktrees are no longer supported.');
    default:
      return value;
  }
}
