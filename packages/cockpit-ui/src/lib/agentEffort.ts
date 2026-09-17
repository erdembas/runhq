const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const labels: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
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
  return value ? (labels[value] ?? value) : 'Auto';
}
