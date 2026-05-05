import type { ServiceDef, ServiceId, Status } from '@runhq/cockpit-types';

/**
 * Mock workspace fixtures driving every cockpit demo on the
 * marketing surface. Picked to mirror a realistic small-to-mid-size
 * dev workspace (one app, one api, one DB, one worker, one
 * deployment shell) so the cards in the hero look like something
 * the visitor's own machine would produce.
 *
 * Edit guidance: keep names short — the sidebar truncates anything
 * over ~16 chars and the hero stage is intentionally narrow.
 */
export const MOCK_SERVICES: ServiceDef[] = [
  {
    id: 'svc-acme-web',
    name: 'acme-web',
    cwd: '~/code/acme-platform/apps/web',
    cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
    env: [],
    port: 3000,
    tags: ['frontend', 'next'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-acme-api',
    name: 'acme-api',
    cwd: '~/code/acme-platform/apps/api',
    cmds: [{ name: 'dev', cmd: 'cargo run' }],
    env: [],
    port: 8080,
    tags: ['backend', 'rust'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-acme-postgres',
    name: 'postgres',
    cwd: '~/code/acme-platform/infra',
    cmds: [{ name: 'up', cmd: 'docker compose up postgres' }],
    env: [],
    port: 5432,
    tags: ['database', 'docker'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-acme-worker',
    name: 'jobs-worker',
    cwd: '~/code/acme-platform/apps/worker',
    cmds: [{ name: 'dev', cmd: 'go run ./cmd/worker' }],
    env: [],
    port: null,
    tags: ['worker', 'go'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-internal-cli',
    name: 'internal-cli',
    cwd: '~/code/internal-cli',
    cmds: [{ name: 'build', cmd: 'pnpm build:watch' }],
    env: [],
    port: null,
    tags: ['tooling', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-runhq-docs',
    name: 'runhq-docs',
    cwd: '~/code/runhq/apps/site',
    cmds: [{ name: 'dev', cmd: 'pnpm site:dev' }],
    env: [],
    port: 4318,
    tags: ['frontend', 'next'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
];

/**
 * "Healthy workspace" status snapshot — most services running, one
 * stopped to demonstrate the muted dot, one in `starting` to show the
 * pulse animation.
 */
export const MOCK_STATUSES_HEALTHY: Record<ServiceId, Status> = {
  'svc-acme-web': 'running',
  'svc-acme-api': 'running',
  'svc-acme-postgres': 'running',
  'svc-acme-worker': 'starting',
  'svc-internal-cli': 'stopped',
  'svc-runhq-docs': 'running',
};

/**
 * "Triage" snapshot — surfaced by the loop section's third tab. A
 * crashed service plus a port conflict is the canonical "what
 * deserves attention" story the cockpit was built for.
 */
export const MOCK_STATUSES_TRIAGE: Record<ServiceId, Status> = {
  'svc-acme-web': 'running',
  'svc-acme-api': 'crashed',
  'svc-acme-postgres': 'running',
  'svc-acme-worker': 'stopped',
  'svc-internal-cli': 'stopped',
  'svc-runhq-docs': 'running',
};

/**
 * "Discovery" snapshot — services exist in config but nothing is
 * running yet because RunHQ just walked the disk. Drives the loop
 * section's first tab.
 */
export const MOCK_STATUSES_DISCOVER: Record<ServiceId, Status> = {
  'svc-acme-web': 'stopped',
  'svc-acme-api': 'stopped',
  'svc-acme-postgres': 'stopped',
  'svc-acme-worker': 'stopped',
  'svc-internal-cli': 'stopped',
  'svc-runhq-docs': 'stopped',
};
