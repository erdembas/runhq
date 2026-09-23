import * as i18n from '@runhq/cockpit-ui/i18n';
import { agentUsageSummary } from './agentLibraryModel';

const count = (value: number | null) =>
  value === null ? i18n.t('Unknown') : value.toLocaleString(i18n.getFormatLocale());
const scopeLabels = {
  get thread() {
    return i18n.t('Thread totals reported by the provider');
  },
  get turn() {
    return i18n.t('Latest turn reported by the provider');
  },
  get message() {
    return i18n.t('Latest message reported by the provider');
  },
  get context() {
    return i18n.t('Current context reported by the provider');
  },
  get reported() {
    return i18n.t('Latest provider report');
  },
  get unknown() {
    return i18n.t('No usage reported by the provider');
  },
};

export function AgentUsageCard({ usage }: { usage: unknown }) {
  i18n.useLocale();
  const summary = agentUsageSummary(usage);
  const cost =
    summary.cost === null
      ? i18n.t('Unknown')
      : `${summary.cost.toLocaleString(i18n.getFormatLocale(), { maximumFractionDigits: 6 })}${summary.currency ? ` ${summary.currency}` : i18n.t(' (currency not supplied)')}`;
  return (
    <section
      aria-label={i18n.t('Reported task usage')}
      className="border-border bg-surface rounded-xl border p-4"
    >
      <h3 className="text-fg text-[12px] font-medium">{i18n.t('Reported usage')}</h3>
      <p className="text-fg-dim mt-1 text-[11px]">{scopeLabels[summary.scope]}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-[12px] sm:grid-cols-4">
        {[
          [i18n.t('Input tokens'), count(summary.input)],
          [i18n.t('Output tokens'), count(summary.output)],
          [i18n.t('Total tokens'), count(summary.total)],
          [i18n.t('Reported cost'), cost],
          ...(summary.cachedInput !== null
            ? [[i18n.t('Cache read tokens'), count(summary.cachedInput)]]
            : []),
          ...(summary.cacheWrite !== null
            ? [[i18n.t('Cache write tokens'), count(summary.cacheWrite)]]
            : []),
          ...(summary.reasoning !== null
            ? [[i18n.t('Reasoning tokens'), count(summary.reasoning)]]
            : []),
          ...(summary.contextUsed !== null || summary.contextSize !== null
            ? [
                [
                  i18n.t('Context tokens'),
                  `${count(summary.contextUsed)} / ${count(summary.contextSize)}`,
                ],
              ]
            : []),
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-fg-dim text-[10px]">{label}</dt>
            <dd className="text-fg mt-1 break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-fg-dim mt-3 text-[10px]">
        {i18n.t(
          'Provider reports can cover different periods. Values are not an account invoice or an estimated charge.',
        )}
      </p>
    </section>
  );
}
