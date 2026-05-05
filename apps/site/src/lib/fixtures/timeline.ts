import type { TimelineEvent } from '@runhq/cockpit-types';

/** Curated activity feed for the marketing surface — five events
 *  spanning the canonical surfaces (start, commit, port crash, push,
 *  AI triage) so the visitor sees the full breadth of what the
 *  cockpit remembers about a workspace. */
export const MOCK_TIMELINE: TimelineEvent[] = [
  {
    id: 1,
    timestamp: '12:04',
    service_id: 'svc-acme-web',
    service_name: 'acme-web',
    event_type: 'service_started',
    description: 'Started · pnpm dev (port 3000)',
    run_id: 'r-001',
  },
  {
    id: 2,
    timestamp: '11:58',
    service_id: 'svc-acme-api',
    service_name: 'acme-api',
    event_type: 'git_commit',
    description: 'feat(billing): handle proration on annual upgrade',
    run_id: null,
  },
  {
    id: 3,
    timestamp: '11:42',
    service_id: 'svc-acme-api',
    service_name: 'acme-api',
    event_type: 'service_crashed',
    description: 'Exited 1 · "address already in use :8080"',
    run_id: 'r-000',
  },
  {
    id: 4,
    timestamp: '11:21',
    service_id: 'svc-acme-web',
    service_name: 'acme-web',
    event_type: 'git_push',
    description: 'Pushed 3 commits · feature/log-tabs → origin',
    run_id: null,
  },
  {
    id: 5,
    timestamp: '10:55',
    service_id: null,
    service_name: null,
    event_type: 'log_warning',
    description: "AI triage: 3 repos haven't moved in 90d",
    run_id: null,
  },
];
