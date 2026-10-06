export interface AgentUsageSummary {
  input: number | null;
  output: number | null;
  total: number | null;
  cost: number | null;
  currency: string | null;
  cachedInput: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  contextUsed: number | null;
  contextSize: number | null;
  scope: 'thread' | 'turn' | 'message' | 'context' | 'reported' | 'unknown';
}
const numeric = (...values: unknown[]) => {
  const value = values.find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return typeof value === 'number' ? value : null;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Keep missing provider values unknown. These are reported snapshots, never billing totals. */
export function agentUsageSummary(raw: unknown): AgentUsageSummary {
  const source = object(raw);
  const usage = object(source.usage);
  const tokens = object(source.tokens);
  const total = object(source.total);
  const cache = object(tokens.cache);
  const cost = object(source.cost);
  const claude = 'usage' in source && ('cost_usd' in source || 'model_usage' in source);
  const input = numeric(
    total.inputTokens,
    usage.input_tokens,
    tokens.input,
    source.inputTokens,
    source.input_tokens,
  );
  const output = numeric(
    total.outputTokens,
    usage.output_tokens,
    tokens.output,
    source.outputTokens,
    source.output_tokens,
  );
  const cachedInput = numeric(
    total.cachedInputTokens,
    usage.cache_read_input_tokens,
    cache.read,
    source.cachedInputTokens,
  );
  const cacheWrite = numeric(usage.cache_creation_input_tokens, cache.write);
  const reportedCost = numeric(source.total_cost_usd, source.cost_usd, source.cost, cost.amount);
  // Claude reports cache reads/writes separately from input_tokens. Codex cached and
  // reasoning counts are subsets of input/output, so adding them would double count.
  const derivedTotal =
    !Object.keys(tokens).length && input !== null && output !== null
      ? input + output + (claude ? (cachedInput ?? 0) + (cacheWrite ?? 0) : 0)
      : null;
  return {
    input,
    output,
    total:
      numeric(
        total.totalTokens,
        usage.total_tokens,
        tokens.total,
        source.totalTokens,
        source.total_tokens,
      ) ?? derivedTotal,
    cost: reportedCost,
    currency:
      numeric(source.total_cost_usd, source.cost_usd) !== null
        ? 'USD'
        : typeof cost.currency === 'string'
          ? cost.currency
          : null,
    cachedInput,
    cacheWrite,
    reasoning: numeric(total.reasoningOutputTokens, tokens.reasoning, source.reasoningOutputTokens),
    contextUsed: source.sessionUpdate === 'usage_update' ? numeric(source.used) : null,
    contextSize:
      source.sessionUpdate === 'usage_update'
        ? numeric(source.size)
        : numeric(source.modelContextWindow),
    scope: Object.keys(total).length
      ? 'thread'
      : claude
        ? 'turn'
        : Object.keys(tokens).length
          ? 'message'
          : source.sessionUpdate === 'usage_update'
            ? 'context'
            : input !== null || output !== null || reportedCost !== null
              ? 'reported'
              : 'unknown',
  };
}
