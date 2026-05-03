import type { BumpGroup, DetailTab, Severity } from './model';
import { bumpTone, severityTone } from './model';
import { TabButton } from './TabButton';

export function TabRow({
  tab,
  setTab,
  advisoryCounts,
  outdatedCounts,
}: {
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  advisoryCounts: Record<Severity, number>;
  outdatedCounts: Record<BumpGroup, number>;
}) {
  const advTotal =
    advisoryCounts.critical +
    advisoryCounts.high +
    advisoryCounts.medium +
    advisoryCounts.low +
    advisoryCounts.info;
  const outTotal =
    outdatedCounts.major + outdatedCounts.minor + outdatedCounts.patch + outdatedCounts.other;

  // Pick the strongest tone each tab deserves. Critical > high > medium
  // for advisories; major > minor > patch for outdated. The tab
  // underline colour matches so "where should I look first?" is visible
  // peripherally, without reading counts.
  const advTone =
    advisoryCounts.critical > 0
      ? severityTone('critical')
      : advisoryCounts.high > 0
        ? severityTone('high')
        : advisoryCounts.medium > 0
          ? severityTone('medium')
          : advTotal > 0
            ? severityTone('low')
            : null;

  const outTone =
    outdatedCounts.major > 0
      ? bumpTone('major')
      : outdatedCounts.minor > 0
        ? bumpTone('minor')
        : outTotal > 0
          ? bumpTone('patch')
          : null;

  return (
    <div className="border-border/70 flex shrink-0 border-b">
      <TabButton
        label="Advisories"
        count={advTotal}
        active={tab === 'advisories'}
        onClick={() => setTab('advisories')}
        tone={advTone}
      />
      <TabButton
        label="Outdated"
        count={outTotal}
        active={tab === 'outdated'}
        onClick={() => setTab('outdated')}
        tone={outTone}
      />
    </div>
  );
}
