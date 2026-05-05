import type { ResourceSample, Section, ServiceDef, ServiceId, Status } from '@runhq/cockpit-types';

const MB = 1024 * 1024;

/**
 * Dashboard fixtures driving the full-fidelity `<DesktopDashboard />`
 * mockup. Picked to mirror the actual dashboard the founder shipped a
 * screenshot of: three sections (Acme Projects / Tooling /
 * Unassigned), seven services, three running, one in `attention` mood.
 *
 * Section / service identity is stable so per-card resource data,
 * runtime hints, and command lists can be looked up by `service.id`
 * across files without ad-hoc magic strings sprinkled into each
 * component.
 */

export const DASH_SECTIONS: Section[] = [
  { id: 'sec-acme', name: 'Acme Projects', color: 'orange' },
  { id: 'sec-tooling', name: 'Tooling', color: 'yellow' },
  // The "Unassigned" section is rendered as a synthetic catch-all
  // when DesktopDashboard receives services without a sectionId. We
  // keep it out of this array so the SidebarSectionLayout doesn't
  // mistake it for a user-defined section in tests.
];

export const DASH_SERVICES: ServiceDef[] = [
  {
    id: 'svc-acme-api',
    name: 'acme-api',
    cwd: '~/code/acme-platform/apps/api',
    cmds: [
      { name: 'run', cmd: 'go run ./cmd/api' },
      { name: 'main', cmd: 'go run main.go' },
    ],
    env: [],
    port: 8080,
    tags: ['backend', 'go'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-acme-compose',
    name: 'acme-compose',
    cwd: '~/code/acme-platform/infra',
    cmds: [
      { name: 'compose-up', cmd: 'docker compose up' },
      { name: 'compose-down', cmd: 'docker compose down' },
    ],
    env: [],
    port: null,
    tags: ['infra', 'docker'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-acme-web',
    name: 'acme-web',
    cwd: '~/code/acme-platform/apps/web',
    cmds: [
      { name: 'dev', cmd: 'pnpm dev' },
      { name: 'lint', cmd: 'pnpm lint' },
    ],
    env: [],
    port: 3000,
    tags: ['frontend', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-billing-worker',
    name: 'billing-worker',
    cwd: '~/code/acme-platform/apps/worker',
    cmds: [{ name: 'main', cmd: 'python main.py' }],
    env: [],
    port: null,
    tags: ['worker', 'python'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-internal-cli',
    name: 'internal-cli',
    cwd: '~/code/internal-cli',
    cmds: [{ name: 'run', cmd: 'cargo run' }],
    env: [],
    port: null,
    tags: ['tooling', 'rust'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-design-system',
    name: 'design-system',
    cwd: '~/code/design-system',
    cmds: [{ name: 'storybook', cmd: 'pnpm storybook' }],
    env: [],
    port: 6006,
    tags: ['frontend', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-docs-site',
    name: 'docs-site',
    cwd: '~/code/docs-site',
    cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
    env: [],
    port: 4000,
    tags: ['frontend', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
];

/** Section assignment per service. Services not present here render
 *  under the synthetic "Unassigned" section. */
export const DASH_SECTION_BY_SERVICE: Record<ServiceId, string | null> = {
  'svc-acme-api': 'sec-acme',
  'svc-acme-compose': 'sec-acme',
  'svc-acme-web': 'sec-acme',
  'svc-billing-worker': 'sec-acme',
  'svc-internal-cli': 'sec-tooling',
  'svc-design-system': null,
  'svc-docs-site': null,
};

export const DASH_STATUSES: Record<ServiceId, Status> = {
  'svc-acme-api': 'running',
  'svc-acme-compose': 'running',
  'svc-acme-web': 'running',
  'svc-billing-worker': 'stopped',
  'svc-internal-cli': 'stopped',
  'svc-design-system': 'stopped',
  'svc-docs-site': 'stopped',
};

export const DASH_SAMPLES: Record<ServiceId, ResourceSample | undefined> = {
  'svc-acme-api': { cpu_percent: 0, memory_bytes: 29 * MB },
  'svc-acme-compose': { cpu_percent: 0, memory_bytes: 80 * MB },
  'svc-acme-web': { cpu_percent: 0, memory_bytes: 178 * MB },
  'svc-billing-worker': undefined,
  'svc-internal-cli': undefined,
  'svc-design-system': undefined,
  'svc-docs-site': undefined,
};

/** Runtime label shown on the service row + dashboard card. Mirrors
 *  apps/desktop's `runtimeMeta` lookup but inlined here since cockpit-ui
 *  doesn't (yet) ship the runtime registry. */
export const DASH_RUNTIME_BY_SERVICE: Record<ServiceId, RuntimeKey> = {
  'svc-acme-api': 'go',
  'svc-acme-compose': 'docker',
  'svc-acme-web': 'node',
  'svc-billing-worker': 'python',
  'svc-internal-cli': 'rust',
  'svc-design-system': 'node',
  'svc-docs-site': 'node',
};

export type RuntimeKey =
  | 'node'
  | 'bun'
  | 'deno'
  | 'go'
  | 'rust'
  | 'dotnet'
  | 'python'
  | 'java'
  | 'ruby'
  | 'php'
  | 'docker';

/** Branch + commit info per service for the "main · 0.0% · ↗" chip
 *  row inside DashboardServiceCard. */
export const DASH_BRANCH_BY_SERVICE: Record<ServiceId, string> = {
  'svc-acme-api': 'main',
  'svc-acme-compose': 'main',
  'svc-acme-web': 'main',
  'svc-billing-worker': 'main',
  'svc-internal-cli': 'main',
  'svc-design-system': 'main',
  'svc-docs-site': 'main',
};

/** "Last scan" pill text per card. */
export const DASH_LAST_SCAN_BY_SERVICE: Record<ServiceId, string> = {
  'svc-acme-api': '1h ago',
  'svc-acme-compose': '1h ago',
  'svc-acme-web': '1h ago',
  'svc-billing-worker': '1h ago',
  'svc-internal-cli': '1h ago',
  'svc-design-system': '1h ago',
  'svc-docs-site': '1h ago',
};

/** Tail of recent log lines surfaced as the card's preview pane.
 *  Three lines per running service, drawn from the actual format the
 *  desktop logs emit (`[2026-05-05T13:18:24.860]  background…`). */
export const DASH_LOG_PREVIEW: Record<ServiceId, string[]> = {
  'svc-acme-api': [
    '[2026-05-05T13:18:24.860] background scan complete',
    '[2026-05-05T13:18:18.740] background scan complete',
    '[2026-05-05T13:18:14.560] background scan complete',
  ],
  'svc-acme-compose': [
    '[1 t e n a c e - p o s t g r e s | 1] db migrations · idle',
    '[1 t e n a c e - p o s t g r e s | 1] checkpoint · 217 frames',
    '[1 t e n a c e - p o s t g r e s | 1] autovacuum · 0 dead rows',
  ],
  'svc-acme-web': [
    '[2026-05-05T13:18:17.792] [vite] page reload (build)',
    '[2026-05-05T13:18:14.382] [vite] hmr update src/...',
    '[2026-05-05T13:18:13.301] [vite] dev server ready',
  ],
};

/** Per-section running counts driving the sidebar pills. Computed from
 *  DASH_STATUSES + DASH_SECTION_BY_SERVICE so adding a service in
 *  fixtures never desynchronises the UI. */
export function dashSectionRunning(sectionId: string | null): { running: number; total: number } {
  const ids = (Object.keys(DASH_SECTION_BY_SERVICE) as ServiceId[]).filter(
    (id) => DASH_SECTION_BY_SERVICE[id] === sectionId,
  );
  const running = ids.filter((id) => DASH_STATUSES[id] === 'running').length;
  return { running, total: ids.length };
}
