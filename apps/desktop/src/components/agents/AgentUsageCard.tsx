import { agentUsageSummary } from './agentLibraryModel';

const count = (value: number | null) => (value === null ? 'Unknown' : value.toLocaleString());
const scopeLabels = {
  thread: 'Thread totals reported by the provider',
  turn: 'Latest turn reported by the provider',
  message: 'Latest message reported by the provider',
  context: 'Current context reported by the provider',
  reported: 'Latest provider report',
  unknown: 'No usage reported by the provider',
};

export function AgentUsageCard({ usage }: { usage: unknown }) {
  const summary = agentUsageSummary(usage);
  const cost =
    summary.cost === null
      ? 'Unknown'
      : `${summary.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })}${summary.currency ? ` ${summary.currency}` : ' (currency not supplied)'}`;
  return (
    <section
      aria-label="Reported task usage"
      className="border-border bg-surface rounded-xl border p-4"
    >
      <h3 className="text-fg text-[12px] font-medium">Reported usage</h3>
      <p className="text-fg-dim mt-1 text-[11px]">{scopeLabels[summary.scope]}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-[12px] sm:grid-cols-4">
        {[
          ['Input tokens', count(summary.input)],
          ['Output tokens', count(summary.output)],
          ['Total tokens', count(summary.total)],
          ['Reported cost', cost],
          ...(summary.cachedInput !== null
            ? [['Cache read tokens', count(summary.cachedInput)]]
            : []),
          ...(summary.cacheWrite !== null
            ? [['Cache write tokens', count(summary.cacheWrite)]]
            : []),
          ...(summary.reasoning !== null ? [['Reasoning tokens', count(summary.reasoning)]] : []),
          ...(summary.contextUsed !== null || summary.contextSize !== null
            ? [['Context tokens', `${count(summary.contextUsed)} / ${count(summary.contextSize)}`]]
            : []),
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-fg-dim text-[10px]">{label}</dt>
            <dd className="text-fg mt-1 break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-fg-dim mt-3 text-[10px]">
        Provider reports can cover different periods. Values are not an account invoice or an
        estimated charge.
      </p>
    </section>
  );
}
