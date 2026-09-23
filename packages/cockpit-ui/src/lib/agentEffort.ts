import * as i18n from '../i18n/core';
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const labels: Record<string, string> = {
  get none() {
    return i18n.t('None');
  },
  get minimal() {
    return i18n.t('Minimal');
  },
  get low() {
    return i18n.t('Low');
  },
  get medium() {
    return i18n.t('Medium');
  },
  get high() {
    return i18n.t('High');
  },
  get xhigh() {
    return i18n.t('Extra high');
  },
  get max() {
    return i18n.t('Max');
  },
  get ultra() {
    return i18n.t('Ultra');
  },
};

/** Provider variants can be arbitrary names; only known reasoning levels have an order. */
export function agentEffortLevels(values: string[]) {
  const levels = [...new Set(values.filter(Boolean))];
  const ordered = levels.length > 0 && levels.every((value) => effortOrder.includes(value));
  return {
    ordered,
    levels: ordered
      ? levels.sort((a, b) => effortOrder.indexOf(a) - effortOrder.indexOf(b))
      : levels,
  };
}
export function effortLabel(value: string) {
  return value ? (labels[value] ?? value) : i18n.t('Auto');
}
