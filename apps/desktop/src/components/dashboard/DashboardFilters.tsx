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
              title="Reset every filter"
            >
              <X className="h-3 w-3" />
              Clear
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
            ariaLabel="Group cards by"
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
            ariaLabel="Sort cards by"
            leading={<ArrowDownWideNarrow size={11} />}
          />
        </div>
      </div>
    </div>
  );
}

function AttentionDropdown({ model }: Props) {
  const opts = buildAttentionOptions(model);
  return (
    <LabeledFilterDropdown label="Attention" active={model.attentionFilter !== 'all'}>
      <Select<AttentionFilter>
        value={model.attentionFilter}
        onChange={(v) => model.setAttentionFilterDeferred(v)}
        options={opts}
        ariaLabel="Filter by attention bucket"
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
  const opts = buildGitOptions(model);
  return (
    <LabeledFilterDropdown label="Git" active={model.gitFilter !== 'all'}>
      <Select<GitFilter>
        value={model.gitFilter}
        onChange={(v) => model.setGitFilterDeferred(v)}
        options={opts}
        ariaLabel="Filter by git state"
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
  return (
    <button
      type="button"
      onClick={() => model.setShowHidden(!model.showHidden)}
      aria-pressed={model.showHidden}
      title={
        model.showHidden
          ? `Hide ${model.hiddenCount} workspace-only project${model.hiddenCount === 1 ? '' : 's'}`
          : `Show ${model.hiddenCount} workspace-only project${model.hiddenCount === 1 ? '' : 's'}`
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
      <span>Hidden</span>
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
      label: `All (${model.total})`,
      description: 'Show projects regardless of attention bucket',
    },
  ];
  if (!stats) return opts;
  if (stats.stale > 0) {
    opts.push({
      value: 'stale',
      label: `Stale (${stats.stale})`,
      description: `${stats.stale} project${stats.stale === 1 ? '' : 's'} with no recent activity`,
    });
  }
  if (stats.risk > 0) {
    opts.push({
      value: 'risk',
      label: `Risk (${stats.risk})`,
      description: `${stats.risk} project${stats.risk === 1 ? '' : 's'} with critical or high CVEs`,
    });
  }
  if (stats.outdated > 0) {
    opts.push({
      value: 'outdated',
      label: `Outdated (${stats.outdated})`,
      description: `${stats.outdated} project${stats.outdated === 1 ? '' : 's'} with outdated dependencies`,
    });
  }
  if (stats.licenseRisk > 0) {
    opts.push({
      value: 'license',
      label: `License (${stats.licenseRisk})`,
      description: `${stats.licenseRisk} project${
        stats.licenseRisk === 1 ? '' : 's'
      } with copyleft / proprietary contamination`,
    });
  }
  return opts;
}

function buildGitOptions(model: DashboardModel) {
  const stats = model.gitStats;
  const opts: { value: GitFilter; label: string; description: string }[] = [
    {
      value: 'all',
      label: `All (${stats.dirty + stats.clean})`,
      description: 'Show projects regardless of git state',
    },
  ];
  if (stats.dirty > 0) {
    opts.push({
      value: 'dirty',
      label: `Dirty (${stats.dirty})`,
      description: 'Projects with uncommitted changes',
    });
  }
  if (stats.clean > 0) {
    opts.push({
      value: 'clean',
      label: `Clean (${stats.clean})`,
      description: 'Projects with no uncommitted changes',
    });
  }
  if (stats.ahead > 0) {
    opts.push({
      value: 'ahead',
      label: `Ahead (${stats.ahead})`,
      description: 'Projects with unpushed commits',
    });
  }
  if (stats.behind > 0) {
    opts.push({
      value: 'behind',
      label: `Behind (${stats.behind})`,
      description: 'Projects whose remote has new commits',
    });
  }
  if (stats.noUpstream > 0) {
    opts.push({
      value: 'no-upstream',
      label: `No upstream (${stats.noUpstream})`,
      description: 'Projects without a tracking branch',
    });
  }
  return opts;
}
