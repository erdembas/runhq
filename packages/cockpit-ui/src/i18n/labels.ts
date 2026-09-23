import { t, type MessageKey } from './core';

// Only application-owned enum values belong here. Never pass provider/user prose to this helper.
const labels = {
  severity: {
    critical: 'Critical',
    high: 'High',
    moderate: 'Medium',
    medium: 'Medium',
    low: 'Low',
    unknown: 'Unknown',
  },
  usageScope: {
    thread: 'Thread',
    turn: 'Turn',
    message: 'Message',
    context: 'Context',
    unknown: 'Unknown',
  },
  stepRole: {
    plan: 'Plan',
    implement: 'Implement',
    review: 'Review',
    revise: 'Revise',
    validate: 'Validate',
    integrate: 'Apply',
  },
  shortcutScope: { global: 'Global', window: 'Window' },
} satisfies Record<string, Record<string, MessageKey>>;

export function enumLabel(kind: keyof typeof labels, value: string): string {
  const key = (labels[kind] as Record<string, MessageKey>)[value];
  return key ? t(key) : value;
}
