import type { ReactNode } from 'react';
import type { ServiceDef, ServiceId, Status } from '@runhq/cockpit-types';
import type { LogLineFixture } from '@runhq/cockpit-ui';

export type LoopTabId = 'discover' | 'orchestrate' | 'heal';

export interface LoopTabContent {
  id: LoopTabId;
  num: string;
  label: string;
  /** Headline rendered above the body copy in the left column. */
  heading: string;
  /** Body copy. */
  body: string;
  /** Bullet list of supporting facts. */
  bullets: Array<{ strong: string; rest: ReactNode }>;
  /** Cockpit state shown on the right column. */
  cockpit: LoopCockpitFixture;
}

export interface LoopCockpitFixture {
  /** Title shown in the chrome — typically a cwd. */
  title: ReactNode;
  /** Status pill on the right of the chrome. */
  statusPill: ReactNode;
  /** Sidebar service list state. */
  services: ServiceDef[];
  statuses: Record<ServiceId, Status>;
  /** Selected sidebar item — drives the highlight. */
  selectedServiceId?: ServiceId | null;
  /** Stage headline above the cockpit body (one line summary). */
  stageHeadline: ReactNode;
  /** Sub-line under the stage headline. */
  stageSub: ReactNode;
  /** Chips shown next to the stage summary. */
  stageChips: Array<{ label: string; tone?: 'accent' | 'success' | 'warn' | 'dim' }>;
  /** Right-column body — the visual payload (terminal mock, list, etc.). */
  body: ReactNode;
  /** Lower AI/triage callout, rendered under the body. */
  aiCallout?: { title: string; body: ReactNode };
}

const DISCOVERY_SERVICES: ServiceDef[] = [
  {
    id: 'svc-discover-acme-web',
    name: 'acme-web',
    cwd: '~/code/acme-web',
    cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
    env: [],
    port: 3000,
    tags: ['frontend', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-discover-acme-api',
    name: 'acme-api',
    cwd: '~/code/acme-api',
    cmds: [{ name: 'dev', cmd: 'go run ./cmd/api' }],
    env: [],
    port: 8080,
    tags: ['backend', 'go'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-discover-internal-cli',
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
    id: 'svc-discover-finsel-billing',
    name: 'finsel-billing',
    cwd: '~/code/finsel-billing',
    cmds: [{ name: 'run', cmd: 'dotnet run' }],
    env: [],
    port: 5050,
    tags: ['backend', 'dotnet'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-discover-data-jobs',
    name: 'data-jobs',
    cwd: '~/code/data-jobs',
    cmds: [{ name: 'train', cmd: 'uv run train.py' }],
    env: [],
    port: null,
    tags: ['worker', 'python'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-discover-design-system',
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
    id: 'svc-discover-acme-stack',
    name: 'acme-stack',
    cwd: '~/code/acme-stack',
    cmds: [{ name: 'up', cmd: 'docker compose up' }],
    env: [],
    port: null,
    tags: ['infra', 'docker'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
];

const ORCHESTRATE_SERVICES: ServiceDef[] = [
  {
    id: 'svc-orch-postgres',
    name: 'postgres',
    cwd: '~/code/acme-platform',
    cmds: [{ name: 'up', cmd: 'docker compose up postgres' }],
    env: [],
    port: 5432,
    tags: ['database'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-orch-redis',
    name: 'redis',
    cwd: '~/code/acme-platform',
    cmds: [{ name: 'up', cmd: 'docker compose up redis' }],
    env: [],
    port: 6379,
    tags: ['database'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-orch-api',
    name: 'api',
    cwd: '~/code/acme-platform/apps/api',
    cmds: [{ name: 'dev', cmd: 'go run ./cmd/api' }],
    env: [],
    port: 8080,
    tags: ['backend', 'go'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
  {
    id: 'svc-orch-web',
    name: 'web',
    cwd: '~/code/acme-platform/apps/web',
    cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
    env: [],
    port: 3000,
    tags: ['frontend', 'node'],
    auto_start: false,
    open_browser: false,
    grace_ms: 5000,
  },
];

const ORCHESTRATE_LOG: LogLineFixture[] = [
  { kind: 'prompt', ts: '12:00', segments: [{ tone: 'dim', text: 'rhq stack up acme-platform' }] },
  {
    kind: 'system',
    ts: '12:00',
    segments: [
      { tone: 'success', text: '✓' },
      { text: ' postgres ready · ' },
      { tone: 'dim', text: ':5432' },
    ],
  },
  {
    kind: 'system',
    ts: '12:00',
    segments: [
      { tone: 'success', text: '✓' },
      { text: ' redis ready · ' },
      { tone: 'dim', text: ':6379' },
    ],
  },
  {
    kind: 'system',
    ts: '12:01',
    segments: [
      { tone: 'success', text: '✓' },
      { text: ' api listening · ' },
      { tone: 'dim', text: ':8080' },
    ],
  },
  {
    kind: 'stdout',
    ts: '12:01',
    segments: [{ tone: 'accent', text: '→' }, { text: ' web · ready in 412ms' }],
  },
];

const TRIAGE_LOG: LogLineFixture[] = [
  { kind: 'prompt', ts: '11:42', segments: [{ tone: 'dim', text: 'cargo run' }] },
  {
    kind: 'stderr',
    ts: '11:42',
    segments: [
      { tone: 'error', text: 'error' },
      { text: ': address already in use ' },
      { tone: 'dim', text: '(os error 48)' },
    ],
  },
  {
    kind: 'system',
    ts: '11:42',
    segments: [
      { tone: 'warn', text: 'RunHQ' },
      { text: ' detected another process on :8080 — ' },
      { tone: 'accent', text: 'pid 7421' },
    ],
  },
  {
    kind: 'system',
    ts: '11:42',
    segments: [
      { tone: 'dim', text: '↳ click ' },
      { tone: 'accent', text: 'Kill :8080' },
      { tone: 'dim', text: ' to free the port and restart' },
    ],
  },
];

export const LOOP_DISCOVER_SERVICES = DISCOVERY_SERVICES;
export const LOOP_DISCOVER_STATUSES: Record<ServiceId, Status> = Object.fromEntries(
  DISCOVERY_SERVICES.map((svc) => [svc.id, 'stopped' as const]),
);
export const LOOP_ORCHESTRATE_SERVICES = ORCHESTRATE_SERVICES;
export const LOOP_ORCHESTRATE_STATUSES: Record<ServiceId, Status> = {
  'svc-orch-postgres': 'running',
  'svc-orch-redis': 'running',
  'svc-orch-api': 'running',
  'svc-orch-web': 'starting',
};
export const LOOP_TRIAGE_SERVICES = ORCHESTRATE_SERVICES;
export const LOOP_TRIAGE_STATUSES: Record<ServiceId, Status> = {
  'svc-orch-postgres': 'running',
  'svc-orch-redis': 'running',
  'svc-orch-api': 'crashed',
  'svc-orch-web': 'stopped',
};

export const ORCH_LOG = ORCHESTRATE_LOG;
export const TRIAGE_TERM_LOG = TRIAGE_LOG;
