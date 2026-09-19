import { formatAgentDuration } from './agentDuration';

export interface AgentSubagentDetails {
  /** What the provider asked this subagent to do, when it reported a prompt. */
  prompt: string | null;
  /** Provider-side identifiers and model, shown as evidence rather than as controls. */
  type: string | null;
  model: string | null;
  agentId: string | null;
  duration: string | null;
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * Read a subagent transcript item. The payload comes from a provider, so every field is optional
 * and a malformed body degrades to "no details" instead of hiding the item.
 */
export function parseAgentSubagent(body: string): AgentSubagentDetails {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { prompt: text(body), type: null, model: null, agentId: null, duration: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { prompt: text(body), type: null, model: null, agentId: null, duration: null };
  const record = raw as Record<string, unknown>;
  return {
    prompt: text(record.prompt),
    type: text(record.subagentType),
    model: text(record.model),
    agentId: text(record.agentId),
    duration: typeof record.durationMs === 'number' ? formatAgentDuration(record.durationMs) : null,
  };
}

/** Compact, human-readable summary of what the provider reported about this subagent. */
export function agentSubagentSummary(details: AgentSubagentDetails): string[] {
  return [details.type, details.model, details.duration].filter(
    (value): value is string => !!value,
  );
}
