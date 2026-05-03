import type { FilterMode } from './types';

export const QUICK_ACTION_FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'stopped', label: 'Stopped' },
  { key: 'frontend', label: 'Frontend' },
  { key: 'backend', label: 'Backend' },
  { key: 'database', label: 'Database' },
  { key: 'infra', label: 'Infra' },
  { key: 'worker', label: 'Worker' },
  { key: 'tooling', label: 'Tooling' },
];
