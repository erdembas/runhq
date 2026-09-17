'use client';
import type { AgentBackend, AgentBackendId } from '@runhq/cockpit-types';
import { AgentProviderLogo } from './AgentProviderLogo';
import { SearchableSelect } from './SearchableSelect';
import { agentProviderNames } from './agentProviders';
import { agentDetectionStatus, enabledAgentBackends } from '../lib/agentDiscovery';

export function AgentProviderPicker({
  value,
  onChange,
  backends,
  disabled,
  name,
  loading = false,
}: {
  value: AgentBackendId;
  onChange?: (id: AgentBackendId) => void;
  backends?: AgentBackend[];
  disabled?: boolean;
  name?: string;
  loading?: boolean;
}) {
  const label =
    name || backends?.find((b) => b.id === value)?.name || agentProviderNames[value] || value;
  const options = enabledAgentBackends(backends ?? []).map((b) => ({
    value: b.id,
    label: b.name,
    group: agentDetectionStatus(b) === 'available' ? 'Installed agents' : 'Needs setup',
    description:
      agentDetectionStatus(b) === 'available'
        ? b.version || 'Installed locally'
        : agentDetectionStatus(b) === 'blocked'
          ? 'CLI found · needs attention'
          : 'CLI not found',
  }));
  if (!onChange)
    return (
      <span
        title="Tool for this conversation"
        className="text-fg flex h-8 items-center gap-2 px-2 text-[12px] font-medium"
      >
        <AgentProviderLogo backend={value} />
        {label}
      </span>
    );
  return (
    <SearchableSelect
      label="Agent tool"
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled || !options.length}
      compact
      leading={<AgentProviderLogo backend={value} />}
      placeholder={
        loading && !options.length
          ? 'Finding agents…'
          : options.length
            ? 'Choose an agent'
            : 'No enabled agents'
      }
      searchPlaceholder="Find an agent…"
      menuWidth={300}
    />
  );
}
