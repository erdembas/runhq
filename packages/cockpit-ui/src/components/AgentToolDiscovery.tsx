'use client';

import * as i18n from '../i18n';
import { Check, ChevronDown, CircleAlert, Loader2, Search } from 'lucide-react';
import type { AgentBackend } from '@runhq/cockpit-types';
import { agentDetectionStatus } from '../lib/agentDiscovery';

export function AgentDiscoverySummary({
  tools,
  loading,
  ready,
  error,
  checkedAt,
}: {
  tools: readonly AgentBackend[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  checkedAt: number | null;
}) {
  i18n.useLocale();
  const counts = { available: 0, blocked: 0, not_found: 0 };
  for (const tool of tools) counts[agentDetectionStatus(tool)]++;
  return (
    <div className="space-y-2.5" aria-live="polite">
      <div className="text-fg-muted flex items-center gap-2 text-[11px]">
        {loading ? (
          <Loader2 className="text-accent h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : error ? (
          <CircleAlert className="text-accent h-3.5 w-3.5 shrink-0" />
        ) : (
          <Search className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {loading
            ? i18n.t('Checking installed agents…')
            : error
              ? i18n.t('Could not complete detection')
              : ready
                ? i18n.t('Local installations checked')
                : i18n.t('Preparing agent detection…')}
        </span>
        {!loading && !!checkedAt && (
          <time
            dateTime={new Date(checkedAt).toISOString()}
            title={new Date(checkedAt).toLocaleString(i18n.getFormatLocale())}
            className="text-fg-dim ml-auto text-[10px]"
          >
            {new Date(checkedAt).toLocaleTimeString(i18n.getFormatLocale(), {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="border-accent/20 bg-accent/5 text-fg-muted rounded-lg border px-3 py-2 text-[11px] leading-relaxed break-words"
        >
          {error}
          {ready && tools.length > 0 ? i18n.t(' Showing the last detected results.') : ''}
        </p>
      )}
      {(ready || tools.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['available', i18n.t('Installed'), 'text-status-running'],
              ['blocked', i18n.t('Needs setup'), 'text-accent'],
              ['not_found', i18n.t('Missing'), 'text-fg-dim'],
            ] as const
          ).map(([status, label, tone]) => (
            <div
              key={status}
              className="border-fg/8 bg-surface-raised rounded-lg border px-2.5 py-2"
            >
              <span className={`font-mono text-[14px] font-medium ${tone}`}>{counts[status]}</span>
              <span className="text-fg-dim mt-0.5 block text-[9px]">{label}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-fg-dim text-[10px] leading-relaxed">
        {i18n.t(
          'Checks your PATH and standard install locations. Project connections load when you use an agent.',
        )}
      </p>
    </div>
  );
}

export function AgentToolDetectionBadge({ tool }: { tool: AgentBackend }) {
  i18n.useLocale();
  const status = agentDetectionStatus(tool);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium ${status === 'available' ? 'bg-status-running/8 text-status-running' : status === 'blocked' ? 'bg-accent/8 text-accent' : 'bg-fg/5 text-fg-dim'}`}
    >
      {status === 'available' ? (
        <Check className="h-2.5 w-2.5" />
      ) : status === 'blocked' ? (
        <CircleAlert className="h-2.5 w-2.5" />
      ) : null}
      {status === 'available'
        ? i18n.t('Installed')
        : status === 'blocked'
          ? i18n.t('Setup required')
          : i18n.t('Missing')}
    </span>
  );
}

export function AgentToolDetectionDetails({ tool }: { tool: AgentBackend }) {
  i18n.useLocale();
  const status = agentDetectionStatus(tool);
  const source =
    tool.detection_source === 'known_location'
      ? i18n.t('Standard install location')
      : tool.detection_source === 'explicit'
        ? i18n.t('Configured path')
        : tool.detection_source === 'path'
          ? i18n.t('Shell PATH')
          : null;
  const error =
    tool.error ||
    (status === 'blocked'
      ? i18n.t(
          'The CLI is installed but could not be started. Check its setup or configure another executable.',
        )
      : status === 'not_found'
        ? i18n.t('The CLI was not found. Install this tool or configure its executable path.')
        : null);
  return (
    <div className="mt-2.5 space-y-2">
      {error && (
        <p
          className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed break-words ${status === 'blocked' ? 'bg-accent/6 text-fg-muted' : 'bg-fg/3 text-fg-dim'}`}
        >
          {error}
        </p>
      )}
      <details className="group/discovery-details">
        <summary className="text-fg-dim hover:text-fg-muted flex cursor-pointer items-center gap-1.5 py-1 text-[10px]">
          <ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open/discovery-details:rotate-0" />
          {tool.executable
            ? i18n.t('Executable & detection details')
            : i18n.t('Configuration details')}
        </summary>
        <dl className="border-fg/8 mt-1 space-y-2 border-l pl-3 text-[10px]">
          {tool.executable && (
            <div>
              <dt className="text-fg-dim">{i18n.t('Detected executable')}</dt>
              <dd className="text-fg-muted mt-0.5 font-mono break-all select-text">
                {tool.executable}
              </dd>
            </div>
          )}
          {source && (
            <div>
              <dt className="text-fg-dim">{i18n.t('Found through')}</dt>
              <dd className="text-fg-muted mt-0.5">{source}</dd>
            </div>
          )}
          {tool.version && (
            <div>
              <dt className="text-fg-dim">{i18n.t('Version')}</dt>
              <dd className="text-fg-muted mt-0.5 font-mono break-all select-text">
                {tool.version}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-fg-dim">{i18n.t('Configured command')}</dt>
            <dd className="text-fg-muted mt-0.5 font-mono break-all select-text">
              {tool.command || tool.id}
              {tool.args?.length ? ` ${tool.args.join(' ')}` : ''}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
