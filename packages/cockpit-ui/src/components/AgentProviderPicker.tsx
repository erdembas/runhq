'use client';
import * as i18n from '../i18n';
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
  extraOptions,
}: {
  value: AgentBackendId;
  onChange?: (id: AgentBackendId) => void;
  backends?: AgentBackend[];
  disabled?: boolean;
  name?: string;
  loading?: boolean;
  /**
   * Targets that are not connections themselves, listed after them. The caller decides what they
   * mean and resolves the chosen value; this component keeps no opinion about them.
   */
  extraOptions?: { value: string; label: string; group: string; description?: string }[];
}) {
  i18n.useLocale();
  const label =
    name || backends?.find((b) => b.id === value)?.name || agentProviderNames[value] || value;
  const options = enabledAgentBackends(backends ?? []).map((b) => ({
    value: b.id,
    label: b.name,
    group:
      agentDetectionStatus(b) === 'available' ? i18n.t('Installed agents') : i18n.t('Needs setup'),
    description:
      agentDetectionStatus(b) === 'available'
        ? b.version || i18n.t('Installed locally')
        : agentDetectionStatus(b) === 'blocked'
          ? i18n.t('CLI found · needs attention')
          : i18n.t('CLI not found'),
  }));
  for (const extra of extraOptions ?? [])
    options.push({ ...extra, description: extra.description ?? '' });
  if (!onChange)
    return (
      <span
        title={i18n.t('Tool for this conversation')}
        className="text-fg flex h-8 items-center gap-2 px-2 text-[12px] font-medium"
      >
        <AgentProviderLogo backend={value} />
        {label}
      </span>
    );
  return (
    <SearchableSelect
      label={i18n.t('Agent tool')}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled || !options.length}
      compact
      leading={<AgentProviderLogo backend={value} />}
      placeholder={
        loading && !options.length
          ? i18n.t('Finding agents…')
          : options.length
            ? i18n.t('Choose an agent')
            : i18n.t('No enabled agents')
      }
      searchPlaceholder={i18n.t('Find an agent…')}
      menuWidth={300}
    />
  );
}
