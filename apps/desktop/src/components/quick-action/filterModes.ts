import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { FilterMode } from './types';

export const QUICK_ACTION_FILTERS: Array<{ key: FilterMode; label: string }> = [
  {
    key: 'all',
    get label() {
      return i18n.t('All');
    },
  },
  {
    key: 'running',
    get label() {
      return i18n.t('Running');
    },
  },
  {
    key: 'stopped',
    get label() {
      return i18n.t('Stopped');
    },
  },
  {
    key: 'frontend',
    get label() {
      return i18n.t('Frontend');
    },
  },
  {
    key: 'backend',
    get label() {
      return i18n.t('Backend');
    },
  },
  {
    key: 'database',
    get label() {
      return i18n.t('Database');
    },
  },
  {
    key: 'infra',
    get label() {
      return i18n.t('Infra');
    },
  },
  {
    key: 'worker',
    get label() {
      return i18n.t('Worker');
    },
  },
  {
    key: 'tooling',
    get label() {
      return i18n.t('Tooling');
    },
  },
];
