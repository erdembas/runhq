import type { GitStatus, ResourceSample, ServiceId } from '@runhq/cockpit-types';

const MB = 1024 * 1024;

/** CPU/RAM samples shown next to each service card. Tuned so the
 *  card layout exercises every tone (low / mid / high) without
 *  exaggerating numbers — visitors recognise their own dev workloads. */
export const MOCK_SAMPLES: Record<ServiceId, ResourceSample> = {
  'svc-acme-web': { cpu_percent: 14, memory_bytes: 380 * MB },
  'svc-acme-api': { cpu_percent: 42, memory_bytes: 96 * MB },
  'svc-acme-postgres': { cpu_percent: 3, memory_bytes: 220 * MB },
  'svc-acme-worker': { cpu_percent: 28, memory_bytes: 64 * MB },
  'svc-internal-cli': { cpu_percent: 1, memory_bytes: 28 * MB },
  'svc-runhq-docs': { cpu_percent: 9, memory_bytes: 180 * MB },
};

/** Trailing CPU history per service — feeds the `<Sparkline>` slot. */
export const MOCK_CPU_HISTORY: Record<ServiceId, number[]> = {
  'svc-acme-web': [4, 6, 8, 12, 22, 28, 24, 18, 14],
  'svc-acme-api': [12, 18, 22, 28, 36, 44, 41, 38, 42],
  'svc-acme-postgres': [1, 2, 1, 3, 2, 4, 3, 2, 3],
  'svc-acme-worker': [0, 0, 0, 18, 32, 36, 30, 28, 28],
  'svc-internal-cli': [0, 0, 1, 0, 1, 0, 1, 1, 1],
  'svc-runhq-docs': [3, 5, 4, 8, 12, 10, 8, 6, 9],
};

const FRESH_GIT: GitStatus = {
  branch: 'main',
  head_short: 'a3f1b9c',
  head_full: 'a3f1b9cdeadbeef0123456789abcdef012345678',
  is_dirty: false,
  dirty_count: 0,
  ahead: 0,
  behind: 0,
  upstream: 'origin/main',
  last_commit: null,
};

const DIRTY_GIT: GitStatus = {
  branch: 'feature/log-tabs',
  head_short: '7d2c41e',
  head_full: '7d2c41efeedface0123456789abcdef012345678',
  is_dirty: true,
  dirty_count: 4,
  ahead: 2,
  behind: 0,
  upstream: 'origin/feature/log-tabs',
  last_commit: null,
};

const STALE_GIT: GitStatus = {
  branch: 'main',
  head_short: 'b9c0e51',
  head_full: 'b9c0e51deadbeef0123456789abcdef012345678',
  is_dirty: false,
  dirty_count: 0,
  ahead: 0,
  behind: 12,
  upstream: 'origin/main',
  last_commit: null,
};

export const MOCK_GIT: Record<ServiceId, GitStatus | null> = {
  'svc-acme-web': DIRTY_GIT,
  'svc-acme-api': FRESH_GIT,
  'svc-acme-postgres': null,
  'svc-acme-worker': STALE_GIT,
  'svc-internal-cli': FRESH_GIT,
  'svc-runhq-docs': DIRTY_GIT,
};
