import * as i18n from '@runhq/cockpit-ui/i18n';
import { ArrowDownWideNarrow, Eye, EyeOff, Flame, GitBranch, Layers, X } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { GROUP_OPTIONS, SORT_OPTIONS, type AttentionFilter, type GitFilter } from './model';
import { DashboardSearchBar, LabeledFilterDropdown } from './DashboardSearchBar';
import type { DashboardModel } from './useDashboardModel';

interface Props {
  model: DashboardModel;
}

export function DashboardFilters({ model }: Props) {
  i18n.useLocale();
  const hasAttentionFilters = attentionTotal(model) > 0;
  const hasGitFilters = model.gitStats.dirty + model.gitStats.clean > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <DashboardSearchBar inputRef={model.searchInputRef} onCommit={model.setCommittedQuery} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hasAttentionFilters && <AttentionDropdown model={model} />}
          {hasGitFilters && <GitDropdown model={model} />}
          {(model.gitFilter !== 'all' || model.attentionFilter !== 'all') && (
            <button
              type="button"
              onClick={model.clearFilters}
              className="text-fg-dim hover:text-accent inline-flex items-center gap-1 text-[11px] transition"
              title={i18n.t('Reset every filter')}
            >
              {i18n.rich('{value1}Clear', { value1: <X className="h-3 w-3" /> })}
            </button>
          )}
          {hasAttentionFilters || hasGitFilters ? (
            <span aria-hidden className="bg-border/60 mx-1 hidden h-5 w-px sm:block" />
          ) : null}
          {model.hiddenCount > 0 && <HiddenToggle model={model} />}
          <Select
            value={model.groupBy}
            onChange={(v) => model.setGroupBy(v)}
            options={GROUP_OPTIONS.map((o) => ({
              value: o.key,
              label: o.label,
              description: o.description,
            }))}
            ariaLabel={i18n.t('Group cards by')}
            leading={<Layers size={11} />}
          />
          <Select
            value={model.sortBy}
            onChange={(v) => model.setSortBy(v)}
            options={SORT_OPTIONS.map((o) => ({
              value: o.key,
              label: o.label,
              description: o.description,
            }))}
            ariaLabel={i18n.t('Sort cards by')}
            leading={<ArrowDownWideNarrow size={11} />}
          />
        </div>
      </div>
    </div>
  );
}

function AttentionDropdown({ model }: Props) {
  i18n.useLocale();
  const opts = buildAttentionOptions(model);
  return (
    <LabeledFilterDropdown label={i18n.t('Attention')} active={model.attentionFilter !== 'all'}>
      <Select<AttentionFilter>
        value={model.attentionFilter}
        onChange={(v) => model.setAttentionFilterDeferred(v)}
        options={opts}
        ariaLabel={i18n.t('Filter by attention bucket')}
        leading={<Flame size={11} />}
        className={cn(
          'rounded-l-none border-l-0',
          model.attentionFilter !== 'all' && 'border-accent/50 text-accent bg-accent/5',
        )}
      />
    </LabeledFilterDropdown>
  );
}

function GitDropdown({ model }: Props) {
  i18n.useLocale();
  const opts = buildGitOptions(model);
  return (
    <LabeledFilterDropdown label={i18n.t('Git')} active={model.gitFilter !== 'all'}>
      <Select<GitFilter>
        value={model.gitFilter}
        onChange={(v) => model.setGitFilterDeferred(v)}
        options={opts}
        ariaLabel={i18n.t('Filter by git state')}
        leading={<GitBranch size={11} />}
        className={cn(
          'rounded-l-none border-l-0',
          model.gitFilter !== 'all' && 'border-accent/50 text-accent bg-accent/5',
        )}
      />
    </LabeledFilterDropdown>
  );
}

function HiddenToggle({ model }: Props) {
  i18n.useLocale();
  return (
    <button
      type="button"
      onClick={() => model.setShowHidden(!model.showHidden)}
      aria-pressed={model.showHidden}
      title={
        model.showHidden
          ? i18n.t('Hide {value1} workspace-only project{plural2}', {
              value1: model.hiddenCount,
              plural2: model.hiddenCount === 1 ? '' : 's',
            })
          : i18n.t('Show {value1} workspace-only project{plural2}', {
              value1: model.hiddenCount,
              plural2: model.hiddenCount === 1 ? '' : 's',
            })
      }
      className={cn(
        'border-border bg-surface-raised text-fg-muted rounded-app-sm inline-flex h-7 items-center gap-1.5 border px-2.5 text-[11px] font-medium tabular-nums transition',
        'hover:border-fg-dim/45 hover:text-fg',
        model.showHidden && 'border-fg-dim/45 text-fg',
      )}
    >
      {model.showHidden ? (
        <Eye className="text-fg h-3.5 w-3.5" />
      ) : (
        <EyeOff className="text-fg-dim h-3.5 w-3.5" />
      )}
      <span>{i18n.t('Hidden')}</span>
      <span
        className={cn(
          'rounded-sm px-1 text-[10px] tabular-nums',
          model.showHidden ? 'bg-fg-dim/25 text-fg' : 'bg-fg-dim/15 text-fg-dim',
        )}
      >
        {model.hiddenCount}
      </span>
    </button>
  );
}

function attentionTotal(model: DashboardModel) {
  const stats = model.attentionStats;
  return stats ? stats.stale + stats.risk + stats.outdated + stats.licenseRisk : 0;
}

function buildAttentionOptions(model: DashboardModel) {
  const stats = model.attentionStats;
  const opts: { value: AttentionFilter; label: string; description: string }[] = [
    {
      value: 'all',
      label: i18n.t('All ({value1})', { value1: model.total }),
      description: i18n.t('Show projects regardless of attention bucket'),
    },
  ];
  if (!stats) return opts;
  if (stats.stale > 0) {
    opts.push({
      value: 'stale',
      label: i18n.t('Stale ({value1})', { value1: stats.stale }),
      description: i18n.t('{value1} project{plural2} with no recent activity', {
        value1: stats.stale,
        plural2: stats.stale === 1 ? '' : 's',
      }),
    });
  }
  if (stats.risk > 0) {
    opts.push({
      value: 'risk',
      label: i18n.t('Risk ({value1})', { value1: stats.risk }),
      description: i18n.t('{value1} project{plural2} with critical or high CVEs', {
        value1: stats.risk,
        plural2: stats.risk === 1 ? '' : 's',
      }),
    });
  }
  if (stats.outdated > 0) {
    opts.push({
      value: 'outdated',
      label: i18n.t('Outdated ({value1})', { value1: stats.outdated }),
      description: i18n.t('{value1} project{plural2} with outdated dependencies', {
        value1: stats.outdated,
        plural2: stats.outdated === 1 ? '' : 's',
      }),
    });
  }
  if (stats.licenseRisk > 0) {
    opts.push({
      value: 'license',
      label: i18n.t('License ({value1})', { value1: stats.licenseRisk }),
      description: i18n.t('{value1} project{plural2} with copyleft / proprietary contamination', {
        value1: stats.licenseRisk,
        plural2: stats.licenseRisk === 1 ? '' : 's',
      }),
    });
  }
  return opts;
}

function buildGitOptions(model: DashboardModel) {
  const stats = model.gitStats;
  const opts: { value: GitFilter; label: string; description: string }[] = [
    {
      value: 'all',
      label: i18n.t('All ({value1})', { value1: stats.dirty + stats.clean }),
      description: i18n.t('Show projects regardless of git state'),
    },
  ];
  if (stats.dirty > 0) {
    opts.push({
      value: 'dirty',
      label: i18n.t('Dirty ({value1})', { value1: stats.dirty }),
      description: i18n.t('Projects with uncommitted changes'),
    });
  }
  if (stats.clean > 0) {
    opts.push({
      value: 'clean',
      label: i18n.t('Clean ({value1})', { value1: stats.clean }),
      description: i18n.t('Projects with no uncommitted changes'),
    });
  }
  if (stats.ahead > 0) {
    opts.push({
      value: 'ahead',
      label: i18n.t('Ahead ({value1})', { value1: stats.ahead }),
      description: i18n.t('Projects with unpushed commits'),
    });
  }
  if (stats.behind > 0) {
    opts.push({
      value: 'behind',
      label: i18n.t('Behind ({value1})', { value1: stats.behind }),
      description: i18n.t('Projects whose remote has new commits'),
    });
  }
  if (stats.noUpstream > 0) {
    opts.push({
      value: 'no-upstream',
      label: i18n.t('No upstream ({value1})', { value1: stats.noUpstream }),
      description: i18n.t('Projects without a tracking branch'),
    });
  }
  return opts;
}
