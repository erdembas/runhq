import * as i18n from '../i18n/core';
import type { AgentStatus } from '@runhq/cockpit-types';

export const agentIsActive = (status: AgentStatus) =>
  ['starting', 'running', 'waiting_input', 'waiting_permission', 'cancelling'].includes(status);
export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  get idle() {
    return i18n.t('Ready');
  },
  get starting() {
    return i18n.t('Starting');
  },
  get running() {
    return i18n.t('Working');
  },
  get waiting_input() {
    return i18n.t('Needs your answer');
  },
  get waiting_permission() {
    return i18n.t('Needs approval');
  },
  get cancelling() {
    return i18n.t('Stopping');
  },
  get completed() {
    return i18n.t('Response ready');
  },
  get failed() {
    return i18n.t('Failed');
  },
  get cancelled() {
    return i18n.t('Stopped');
  },
  get interrupted() {
    return i18n.t('Interrupted');
  },
};
