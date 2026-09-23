'use client';

import * as i18n from '../i18n';
import { ChevronDown, FolderGit2, GitBranch, Terminal, X } from 'lucide-react';
import type { AgentBackend, AgentBackendId } from '@runhq/cockpit-types';
import { AgentProviderLogo } from './AgentProviderLogo';
import { agentDetectionStatus } from '../lib/agentDiscovery';

const inputClass =
  'bg-fg/3 border-fg/8 text-fg placeholder:text-fg-dim focus:border-fg/25 w-full min-w-0 rounded-xl border px-3 py-2.5 text-[12px] transition-colors';

export function AgentTaskSettings({
  title,
  onTitle,
  executable,
  onExecutable,
  isolated,
  onIsolated,
  backend,
  detected,
  projectPath,
  commands,
  disabled,
  onClose,
  connectionError,
  checkingConnection = false,
}: {
  title: string;
  onTitle: (value: string) => void;
  executable: string;
  onExecutable: (value: string) => void;
  isolated: boolean;
  onIsolated: (value: boolean) => void;
  backend: AgentBackendId;
  detected?: AgentBackend;
  projectPath?: string;
  commands: string[];
  disabled?: boolean;
  onClose: () => void;
  connectionError?: string | null;
  checkingConnection?: boolean;
}) {
  i18n.useLocale();
  return (
    <div className="border-fg/8 rounded-b-[20px] border-t px-4 pt-3 pb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-fg-muted text-[11px] font-medium">{i18n.t('Task settings')}</span>
        <button
          type="button"
          aria-label={i18n.t('Close task settings')}
          onClick={onClose}
          className="text-fg-dim hover:text-fg hover:bg-fg/5 rounded-lg p-1.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <fieldset disabled={disabled} className="min-w-0 space-y-4 disabled:opacity-50">
        <label className="block">
          <span className="text-fg-muted mb-1.5 flex items-center gap-2 text-[11px]">
            {i18n.rich('Task name{value1}', {
              value1: <span className="text-fg-dim text-[10px]">{i18n.t('Optional')}</span>,
            })}
          </span>
          <input
            aria-label={i18n.t('Task name')}
            className={inputClass}
            style={{ outline: 'none' }}
            maxLength={200}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder={i18n.t('Automatically summarize your task')}
          />
        </label>
        <div>
          <div className="text-fg-muted mb-2 text-[11px]">{i18n.t('Workspace')}</div>
          <div role="group" aria-label={i18n.t('Workspace')} className="grid grid-cols-2 gap-2">
            {[
              {
                value: false,
                label: i18n.t('Local'),
                description: i18n.t('Current project directory'),
                icon: FolderGit2,
              },
              {
                value: true,
                label: i18n.t('Worktree'),
                description: i18n.t('Isolated branch & directory'),
                icon: GitBranch,
              },
            ].map(({ value, label, description, icon: Icon }) => (
              <button
                key={label}
                type="button"
                aria-pressed={isolated === value}
                onClick={() => onIsolated(value)}
                style={{ outline: 'none' }}
                className={`focus-visible:ring-fg/25 min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 ${isolated === value ? 'border-fg/20 bg-fg/5 text-fg' : 'border-fg/8 text-fg-muted hover:bg-fg/3'}`}
              >
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                  <span
                    aria-hidden="true"
                    className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${isolated === value ? 'bg-fg/70' : 'bg-transparent'}`}
                  />
                </span>
                <span className="text-fg-dim mt-1.5 block text-[10px] leading-relaxed">
                  {description}
                </span>
              </button>
            ))}
          </div>
          {isolated && (
            <p className="text-fg-muted mt-2 text-[10px] leading-relaxed">
              {i18n.t(
                'Starts from committed HEAD. Local changes, dependencies and environment files are not copied.',
              )}
            </p>
          )}
          {projectPath && (
            <p title={projectPath} className="text-fg-dim mt-2 truncate text-[10px]">
              {projectPath}
            </p>
          )}
        </div>
        <details
          className="group/connection border-fg/8 rounded-xl border"
          open={!!executable || (!!detected && !detected.available)}
        >
          <summary className="text-fg-muted flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[11px]">
            {i18n.rich('{value1}Agent connection{value2}{value3}', {
              value1: <AgentProviderLogo backend={backend} className="h-3.5 w-3.5" />,
              value2: (
                <span className="text-fg-dim ml-auto max-w-[50%] truncate text-[10px]">
                  {checkingConnection
                    ? i18n.t('Checking…')
                    : executable
                      ? i18n.t('Custom executable')
                      : detected?.available
                        ? detected.version || i18n.t('Detected locally')
                        : i18n.t('Setup')}
                </span>
              ),
              value3: (
                <ChevronDown className="text-fg-dim h-3 w-3 shrink-0 transition-transform group-open/connection:rotate-180" />
              ),
            })}
          </summary>
          <div className="border-fg/8 space-y-2.5 border-t p-3">
            <label className="block">
              <span className="text-fg-muted mb-1.5 block text-[11px]">
                {i18n.rich('CLI executable {value1}', {
                  value1: <span className="text-fg-dim">{i18n.t('· optional override')}</span>,
                })}
              </span>
              <input
                aria-label={i18n.t('CLI executable')}
                className={inputClass}
                style={{ outline: 'none' }}
                value={executable}
                disabled={!backend}
                onChange={(e) => onExecutable(e.target.value)}
                placeholder={
                  !backend
                    ? i18n.t('Choose an agent first')
                    : detected?.executable ||
                      i18n.t('Absolute path to {value1}', { value1: detected?.command || backend })
                }
              />
            </label>
            <p className="text-fg-dim text-[10px] leading-relaxed break-all">
              {executable.trim()
                ? i18n.t('This path applies to the new task. RunHQ checks it before starting.')
                : detected?.executable
                  ? `${detected.detection_source === 'known_location' ? i18n.t('Found in a standard install location') : detected.detection_source === 'explicit' ? i18n.t('Configured executable') : i18n.t('Detected executable')}: ${detected.executable}`
                  : i18n.t(
                      'RunHQ checks your PATH and common install locations automatically. Use an override for a different installation.',
                    )}
            </p>
            {(connectionError ||
              (!executable.trim() &&
                detected &&
                agentDetectionStatus(detected) !== 'available' &&
                detected.error)) && (
              <p className="text-accent text-[10px] leading-relaxed break-words">
                {connectionError || detected?.error}
              </p>
            )}
            {backend === 'claude' && (
              <p className="text-fg-dim text-[10px] leading-relaxed">
                {i18n.t(
                  'Uses your installed CLI through the Claude Agent SDK with supported API authentication.',
                )}
              </p>
            )}
          </div>
        </details>
      </fieldset>
      {!!commands.length && (
        <details className="mt-3">
          <summary className="text-fg-dim flex cursor-pointer items-center gap-2 py-1 text-[11px]">
            {i18n.rich('{value1}Available commands{value2}', {
              value1: <Terminal className="h-3 w-3" />,
              value2: (
                <span className="bg-fg/5 rounded px-1.5 py-0.5 text-[9px]">{commands.length}</span>
              ),
            })}
          </summary>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-auto">
            {commands.map((command) => (
              <code
                key={command}
                className="bg-fg/4 text-fg-muted rounded-md px-2 py-1 text-[10px]"
              >
                /{command}
              </code>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
