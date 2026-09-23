import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { Status } from '@/types';

export const STATUS_DOT: Record<Status, string> = {
  running: 'bg-status-running',
  starting: 'bg-status-starting animate-pulse',
  stopping: 'bg-status-starting animate-pulse',
  crashed: 'bg-status-error',
  stopped: 'bg-surface-muted',
  exited: 'bg-surface-muted',
};

export const STATUS_LABEL: Record<Status, string> = {
  get running() {
    return i18n.t('Running');
  },
  get starting() {
    return i18n.t('Starting…');
  },
  get stopping() {
    return i18n.t('Stopping…');
  },
  get crashed() {
    return i18n.t('Crashed');
  },
  get stopped() {
    return i18n.t('Stopped');
  },
  get exited() {
    return i18n.t('Exited');
  },
};
