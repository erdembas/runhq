'use client';

import { Bot, CircleHelp, ListChecks, Loader2, RefreshCw, UserRound } from 'lucide-react';
import type { AgentCatalog } from '@runhq/cockpit-types';
import { useMemo } from 'react';
import { agentModelEfforts, agentModelOptions, customModelOption } from '../lib/agentModelOptions';
import { SearchableSelect } from './SearchableSelect';
import { AgentEffortPicker } from './AgentEffortPicker';

export function AgentModelControls({
  catalog,
  loading,
  refresh,
  model,
  effort,
  mode,
  onModel,
  onEffort,
  onMode,
  disabled,
  agent = '',
  onAgent,
}: {
  catalog: AgentCatalog | null;
  loading: boolean;
  refresh: () => void;
  model: string;
  effort: string;
  mode: string;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onMode: (mode: 'default' | 'plan') => void;
  disabled?: boolean;
  agent?: string;
  onAgent?: (agent: string) => void;
}) {
  const efforts = agentModelEfforts(catalog?.models ?? [], model);
  const models = useMemo(() => agentModelOptions(catalog?.models ?? [], model), [catalog, model]);
  const acp = catalog?.connection === 'acp';
  const nativeModes = !catalog
    ? []
    : acp
      ? catalog.agents
      : ['agent', ...(catalog.modes.includes('plan') ? ['plan'] : [])];
  const selectedMode = acp
    ? agent || (mode === 'plan' ? 'plan' : 'agent')
    : mode === 'plan'
      ? 'plan'
      : 'agent';
  const extraProfiles = acp
    ? (catalog?.agents ?? []).filter((id) => !['agent', 'plan', 'ask'].includes(id))
    : (catalog?.agents ?? []);
  const showProfiles =
    !!onAgent && (extraProfiles.length > 0 || (!!agent && (!acp || !nativeModes.includes(agent))));
  return (
    <>
      <span className="bg-border mx-0.5 h-4 w-px" />
      {catalog ? (
        <SearchableSelect
          label="Model"
          value={model}
          onChange={onModel}
          disabled={disabled}
          compact
          className="max-w-48"
          searchPlaceholder="Search models or providers…"
          menuWidth={420}
          options={models}
          createOption={customModelOption}
          hint="Auto follows your provider’s configuration. To pin another version, paste its exact model ID in search."
        />
      ) : (
        <span role="status" className="text-fg-dim flex h-8 items-center gap-1.5 px-2 text-[11px]">
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {loading ? 'Loading models…' : model || 'Models not connected'}
        </span>
      )}
      <button
        type="button"
        aria-label="Refresh models"
        title={loading ? 'Loading models…' : 'Refresh models'}
        disabled={disabled || loading}
        onClick={refresh}
        className="text-fg-dim hover:text-fg rounded-md p-1.5 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </button>
      {(efforts.length > 0 || effort) && (
        <AgentEffortPicker
          efforts={efforts}
          value={effort}
          onChange={onEffort}
          disabled={disabled}
        />
      )}
      {(!acp || !!onAgent) && nativeModes.some((id) => ['agent', 'plan', 'ask'].includes(id)) && (
        <div
          role="group"
          aria-label="Work mode"
          className="bg-fg/4 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-xl p-0.5"
        >
          {(
            [
              {
                value: 'agent',
                label: 'Agent',
                icon: Bot,
                description: 'Implement changes with your configured permissions',
              },
              {
                value: 'plan',
                label: 'Plan',
                icon: ListChecks,
                description: 'Explore the code and prepare a plan before implementation',
              },
              {
                value: 'ask',
                label: 'Ask',
                icon: CircleHelp,
                description: 'Explore and ask questions using the provider’s read-only mode',
              },
            ] as const
          )
            .filter(({ value }) => nativeModes.includes(value))
            .map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                type="button"
                aria-label={`${label} mode`}
                aria-pressed={selectedMode === value}
                disabled={disabled}
                title={description}
                onClick={() => {
                  onMode(value === 'plan' ? 'plan' : 'default');
                  if (acp) onAgent?.(value);
                }}
                style={{ outline: 'none' }}
                className={`focus-visible:ring-fg/25 inline-flex h-7 items-center gap-1.5 rounded-[10px] px-2.5 text-[11px] font-medium transition-colors focus-visible:ring-2 disabled:opacity-40 ${selectedMode === value ? (value === 'plan' ? 'bg-violet-400/12 text-violet-600 shadow-sm dark:text-violet-400' : 'bg-surface-raised text-fg shadow-sm') : 'text-fg-dim hover:text-fg'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
        </div>
      )}
      {showProfiles && (
        <SearchableSelect
          label={catalog?.connection === 'acp' ? 'Agent mode' : 'Agent profile'}
          value={agent}
          onChange={(value) => {
            if (acp) onMode(value === 'plan' ? 'plan' : 'default');
            onAgent?.(value);
          }}
          disabled={disabled}
          compact
          className="max-w-40"
          leading={<UserRound className="h-3.5 w-3.5 shrink-0" />}
          searchPlaceholder="Search agent profiles…"
          hint={
            acp
              ? 'Modes and permissions are reported by the connected agent.'
              : 'A custom profile may define its own tools and permissions. Choose Default for mode to follow Agent / Plan.'
          }
          options={[
            { value: '', label: 'Default profile', description: 'Default for mode' },
            ...[...new Set([...(catalog?.agents ?? []), ...(agent ? [agent] : [])])].map(
              (name) => ({ value: name, label: name }),
            ),
          ]}
        />
      )}
    </>
  );
}
