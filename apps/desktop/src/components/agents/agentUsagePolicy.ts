import { agentUsageSummary, type AgentUsageSummary } from './agentLibraryModel';

export interface AgentUsageThresholds {
  tokenWarning?: number;
  tokenPause?: number;
  usdWarning?: number;
  usdPause?: number;
}
export interface AgentUsagePreferences {
  notifications: boolean;
  providers: Record<string, AgentUsageThresholds>;
}
export interface AgentUsageAlert {
  metric: 'tokens' | 'USD';
  level: 'warning' | 'pause';
  actual: number;
  threshold: number;
  scope: AgentUsageSummary['scope'];
}
export const AGENT_USAGE_THRESHOLD_FIELDS = [
  'tokenWarning',
  'tokenPause',
  'usdWarning',
  'usdPause',
] as const;

export function agentUsagePreferences(value: unknown): AgentUsagePreferences {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const providers: Record<string, AgentUsageThresholds> = {};
  if (
    source.providers &&
    typeof source.providers === 'object' &&
    !Array.isArray(source.providers)
  ) {
    for (const [id, raw] of Object.entries(source.providers)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const rule: AgentUsageThresholds = {};
      for (const field of AGENT_USAGE_THRESHOLD_FIELDS) {
        const value = (raw as Record<string, unknown>)[field];
        if (
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value > 0 &&
          (!field.startsWith('token') || Number.isSafeInteger(value))
        )
          rule[field] = value;
      }
      providers[id] = rule;
    }
  }
  return { notifications: source.notifications !== false, providers };
}

/** Compare one saved provider report. No accumulating snapshots or converting currencies. */
export function evaluateAgentUsage(raw: unknown, rule: AgentUsageThresholds = {}) {
  const summary = agentUsageSummary(raw);
  const alerts: AgentUsageAlert[] = [];
  const unsupported: string[] = [];
  const check = (
    metric: AgentUsageAlert['metric'],
    actual: number | null,
    warning?: number,
    pause?: number,
  ) => {
    if (!warning && !pause) return;
    if (actual === null) {
      unsupported.push(
        metric === 'tokens'
          ? 'Token rule unsupported until the tool reports a total token count.'
          : 'Cost rule unsupported until the tool reports an explicit USD amount.',
      );
      return;
    }
    if (pause !== undefined && actual >= pause)
      alerts.push({ metric, actual, threshold: pause, level: 'pause', scope: summary.scope });
    else if (warning !== undefined && actual >= warning)
      alerts.push({ metric, actual, threshold: warning, level: 'warning', scope: summary.scope });
  };
  check('tokens', summary.total, rule.tokenWarning, rule.tokenPause);
  check('USD', summary.currency === 'USD' ? summary.cost : null, rule.usdWarning, rule.usdPause);
  const paused = alerts.filter((alert) => alert.level === 'pause');
  return {
    summary,
    alerts,
    unsupported,
    pauseReason: paused.length
      ? `Queue paused by reported usage: ${paused.map((alert) => `${alert.actual.toLocaleString()} ${alert.metric} ≥ ${alert.threshold.toLocaleString()}`).join('; ')}. Adjust this tool’s rules in Usage to continue.`
      : null,
  };
}

export function validateAgentUsagePreferences(preferences: AgentUsagePreferences): string | null {
  for (const [id, rule] of Object.entries(preferences.providers)) {
    for (const field of AGENT_USAGE_THRESHOLD_FIELDS) {
      const value = rule[field];
      if (
        value !== undefined &&
        (!Number.isFinite(value) ||
          value <= 0 ||
          (field.startsWith('token') && !Number.isSafeInteger(value)))
      )
        return `${id}: thresholds must be positive${field.startsWith('token') ? ' whole token counts' : ' amounts'}.`;
    }
    if (
      (rule.tokenWarning !== undefined &&
        rule.tokenPause !== undefined &&
        rule.tokenWarning > rule.tokenPause) ||
      (rule.usdWarning !== undefined &&
        rule.usdPause !== undefined &&
        rule.usdWarning > rule.usdPause)
    )
      return `${id}: the warning threshold must be no higher than the queue pause threshold.`;
  }
  return null;
}
