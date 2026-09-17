'use client';

import { Check, CircleAlert, KeyRound, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import type { AgentBackend } from '@runhq/cockpit-types';
import {
  agentDetectionStatus,
  enabledAgentBackends,
  type AgentConnectionState,
} from '../lib/agentDiscovery';
import { AgentProviderLogo } from './AgentProviderLogo';

export function AgentProviderChips({
  backends,
  selected,
  disabled,
  onSelect,
  selectedExecutable,
}: {
  backends: readonly AgentBackend[];
  selected: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  selectedExecutable?: string;
}) {
  const tools = enabledAgentBackends(backends).filter(
    (tool) => agentDetectionStatus(tool) === 'available' || tool.id === selected,
  );
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Agent selection">
      {tools.map((tool) => {
        const custom = tool.id === selected && !!selectedExecutable;
        const available = custom || agentDetectionStatus(tool) === 'available';
        return (
          <button
            type="button"
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            disabled={disabled}
            aria-pressed={selected === tool.id}
            title={(custom ? selectedExecutable : tool.executable) || tool.error || tool.name}
            className={`focus-visible:ring-accent/40 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 ${selected === tool.id ? 'border-accent/30 bg-accent/7 text-fg' : 'border-border bg-surface-raised text-fg-muted hover:border-fg/20 hover:text-fg'}`}
          >
            <AgentProviderLogo backend={tool.id} className="h-4 w-4" />
            <span className="font-medium">{tool.name}</span>
            <span
              className={`flex items-center gap-1 text-[10px] ${available ? 'text-status-running' : 'text-accent'}`}
            >
              {available ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <CircleAlert className="h-3 w-3" aria-hidden />
              )}
              {custom
                ? 'Custom path'
                : available
                  ? 'Installed'
                  : agentDetectionStatus(tool) === 'not_found'
                    ? 'Missing'
                    : 'Setup'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AgentConnectionStatus({
  state,
  refreshing,
  disabled,
  onRecheck,
  onRetryCatalog,
  onSettings,
  onManage,
  onUseDefaultModel,
}: {
  state: AgentConnectionState;
  refreshing?: boolean;
  disabled?: boolean;
  onRecheck: () => void;
  onRetryCatalog: () => void;
  onSettings: () => void;
  onManage: () => void;
  onUseDefaultModel?: () => void;
}) {
  const loading = state.stage === 'checking' || state.stage === 'connecting';
  const ready = state.stage === 'ready';
  const Icon = loading
    ? Loader2
    : ready
      ? Check
      : state.stage === 'authentication'
        ? KeyRound
        : CircleAlert;
  const action =
    state.action === 'catalog'
      ? onRetryCatalog
      : state.action === 'settings'
        ? onSettings
        : state.action === 'manage'
          ? onManage
          : onRecheck;
  const actionLabel =
    state.action === 'catalog'
      ? 'Retry connection'
      : state.action === 'settings'
        ? 'Connection settings'
        : state.action === 'manage'
          ? 'Agent tools'
          : 'Recheck';
  return (
    <div
      className="border-border/70 bg-surface-muted/40 mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3"
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${loading ? 'text-fg-dim animate-spin' : ready ? 'text-status-running' : 'text-accent'}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-fg text-[11px] font-medium">{state.title}</p>
        <p
          className="text-fg-dim mt-0.5 line-clamp-3 text-[10px] leading-relaxed break-words"
          title={state.detail}
        >
          {state.detail}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {state.canUseDefaultModel && onUseDefaultModel && (
          <button
            type="button"
            disabled={disabled}
            onClick={onUseDefaultModel}
            className="text-accent hover:bg-accent/5 rounded-md px-1.5 py-1 text-[10px] font-medium disabled:opacity-40"
          >
            Use agent default
          </button>
        )}
        {state.action && (
          <button
            type="button"
            disabled={disabled || refreshing}
            onClick={action}
            className="text-fg-muted hover:text-fg flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium disabled:opacity-40"
          >
            {state.action === 'settings' || state.action === 'manage' ? (
              <Settings2 className="h-3 w-3" />
            ) : (
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            )}
            {actionLabel}
          </button>
        )}
        {state.action !== 'discovery' && state.action !== null && (
          <button
            type="button"
            disabled={disabled || refreshing}
            onClick={onRecheck}
            className="text-fg-dim hover:text-fg rounded-md px-1.5 py-1 text-[10px] disabled:opacity-40"
          >
            Recheck
          </button>
        )}
        {(ready || loading) && (
          <button
            type="button"
            disabled={disabled}
            onClick={onManage}
            className="text-fg-dim hover:text-fg rounded-md px-1.5 py-1 text-[10px] disabled:opacity-40"
          >
            Manage
          </button>
        )}
      </div>
    </div>
  );
}
