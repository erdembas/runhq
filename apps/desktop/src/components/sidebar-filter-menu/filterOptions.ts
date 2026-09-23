import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/useAppStore';

export const STATUS_OPTIONS: Array<{ key: SidebarStatusFilter; label: string; hint: string }> = [
  {
    key: 'all',
    get label() {
      return i18n.t('All');
    },
    get hint() {
      return i18n.t('Show everything');
    },
  },
  {
    key: 'running',
    get label() {
      return i18n.t('Running');
    },
    get hint() {
      return i18n.t('Live processes only');
    },
  },
  {
    key: 'stopped',
    get label() {
      return i18n.t('Stopped');
    },
    get hint() {
      return i18n.t('Idle services only');
    },
  },
];

export const GROUP_OPTIONS: Array<{ key: SidebarGroupBy; label: string }> = [
  {
    key: 'none',
    get label() {
      return i18n.t('None');
    },
  },
  {
    key: 'category',
    get label() {
      return i18n.t('Category');
    },
  },
  {
    key: 'runtime',
    get label() {
      return i18n.t('Runtime');
    },
  },
  {
    key: 'status',
    get label() {
      return i18n.t('Status');
    },
  },
];
