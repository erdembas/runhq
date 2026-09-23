import * as i18n from '../i18n/core';
import type { AgentBackend, AgentCatalog } from '@runhq/cockpit-types';

export function agentDetectionStatus(tool: AgentBackend): 'available' | 'not_found' | 'blocked' {
  return (
    tool.detection_status ??
    (tool.available ? 'available' : tool.executable ? 'blocked' : 'not_found')
  );
}

export function enabledAgentBackends(backends: readonly AgentBackend[]): AgentBackend[] {
  const rank = { available: 0, blocked: 1, not_found: 2 };
  return backends
    .filter((tool) => tool.enabled !== false && tool.adapter !== 'terminal')
    .sort((a, b) => rank[agentDetectionStatus(a)] - rank[agentDetectionStatus(b)]);
}

export function chooseAgentBackend({
  backends,
  current,
  ready,
  userSelected,
  executable,
  locked,
}: {
  backends: readonly AgentBackend[];
  current: string;
  ready: boolean;
  userSelected: boolean;
  executable: string;
  locked: boolean;
}): string {
  if (!ready || userSelected || executable.trim() || locked) return current;
  const installed = enabledAgentBackends(backends).filter(
    (tool) => agentDetectionStatus(tool) === 'available',
  );
  if (installed.some((tool) => tool.id === current)) return current;
  return installed.find((tool) => tool.id === 'codex')?.id ?? installed[0]?.id ?? '';
}

export interface AgentConnectionState {
  stage:
    | 'checking'
    | 'discovery_error'
    | 'no_agents'
    | 'disabled'
    | 'not_found'
    | 'blocked'
    | 'project_required'
    | 'connecting'
    | 'authentication'
    | 'catalog_error'
    | 'ready';
  title: string;
  detail: string;
  canStart: boolean;
  canUseDefaultModel: boolean;
  action: 'discovery' | 'catalog' | 'settings' | 'manage' | null;
}

/** Discovery confirms the CLI; a successful catalog confirms the selected connection. */
export function agentConnectionState({
  tool,
  discoveryReady,
  discoveryError,
  executable,
  projectId,
  catalog,
  catalogError,
  availableAgents = 0,
  model = '',
}: {
  tool?: AgentBackend;
  discoveryReady: boolean;
  discoveryError: string | null;
  executable: string;
  projectId: string;
  catalog: AgentCatalog | null;
  catalogError: string | null;
  availableAgents?: number;
  model?: string;
}): AgentConnectionState {
  const state = (
    stage: AgentConnectionState['stage'],
    title: string,
    detail: string,
    action: AgentConnectionState['action'],
  ): AgentConnectionState => ({
    stage,
    title,
    detail,
    action,
    canStart: stage === 'ready',
    canUseDefaultModel: !!model.trim() && (stage === 'catalog_error' || stage === 'authentication'),
  });
  if (discoveryError)
    return state(
      'discovery_error',
      i18n.t('Could not check installed agents'),
      discoveryError,
      'discovery',
    );
  if (!discoveryReady)
    return state(
      'checking',
      i18n.t('Finding your installed agents…'),
      i18n.t('Checking local CLI installations.'),
      null,
    );
  if (!tool)
    return state(
      'no_agents',
      availableAgents ? i18n.t('Choose an installed agent') : i18n.t('No local agent is ready'),
      availableAgents
        ? i18n.t('Select an installed agent above to connect it to this project.')
        : i18n.t(
            'Install or enable an agent in Agent tools, then recheck. You can also choose an agent below and set its executable.',
          ),
      'manage',
    );
  if (tool.enabled === false || tool.adapter === 'terminal')
    return state(
      'disabled',
      i18n.t('{value1} is not enabled for tasks', { value1: tool.name }),
      i18n.t('Choose an installed agent or update its settings in Agent tools.'),
      'manage',
    );
  const override = executable.trim();
  if (!override && agentDetectionStatus(tool) !== 'available') {
    return agentDetectionStatus(tool) === 'blocked'
      ? state(
          'blocked',
          i18n.t('{value1} needs attention', { value1: tool.name }),
          tool.error ||
            'The CLI was found but could not be started. Check its installation or use another executable.',
          'settings',
        )
      : state(
          'not_found',
          i18n.t('{value1} CLI was not found', { value1: tool.name }),
          tool.error ||
            'Install this agent or choose its executable in Task settings, then recheck.',
          'settings',
        );
  }
  if (!projectId)
    return state(
      'project_required',
      i18n.t('Choose a project for {value1}', { value1: tool.name }),
      i18n.t('RunHQ will check its connection and load models in that project.'),
      null,
    );
  if (catalogError) {
    const authentication =
      /auth|log[ -]?in|sign[ -]?in|credential|api[ _-]?key|unauthorized|\b40[13]\b/i.test(
        catalogError,
      );
    return state(
      authentication ? 'authentication' : 'catalog_error',
      authentication
        ? i18n.t('{value1} needs authentication', { value1: tool.name })
        : i18n.t('Could not connect to {value1}', { value1: tool.name }),
      catalogError,
      'catalog',
    );
  }
  if (!catalog)
    return state(
      'connecting',
      override
        ? i18n.t('Checking {value1} executable…', { value1: tool.name })
        : i18n.t('Connecting to {value1}…', { value1: tool.name }),
      override || 'Loading the models and modes offered by your agent.',
      null,
    );
  const models = catalog.models.length
    ? i18n.t('{value1} model{plural2} available', {
        value1: catalog.models.length,
        plural2: catalog.models.length === 1 ? '' : 's',
      })
    : i18n.t('Uses your agent’s configured model');
  return state(
    'ready',
    i18n.t('{value1} is ready', { value1: tool.name }),
    `${models}${override || tool.executable ? ` · ${override || tool.executable}` : ''}`,
    'discovery',
  );
}
