'use client';

import { useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { CockpitChrome, LogTerminalMock, WorkspaceSidebar, cn } from '@runhq/cockpit-ui';
import {
  LOOP_DISCOVER_SERVICES,
  LOOP_DISCOVER_STATUSES,
  LOOP_ORCHESTRATE_SERVICES,
  LOOP_ORCHESTRATE_STATUSES,
  LOOP_TRIAGE_SERVICES,
  LOOP_TRIAGE_STATUSES,
  ORCH_LOG,
  TRIAGE_TERM_LOG,
} from '@/lib/fixtures';

type LoopTabId = 'discover' | 'orchestrate' | 'heal';

interface LoopTabContent {
  id: LoopTabId;
  num: string;
  label: string;
  heading: string;
  body: string;
  bullets: Array<{ strong: string; rest: ReactNode }>;
  cockpit: ReactNode;
}

const TABS: LoopTabContent[] = [
  {
    id: 'discover',
    num: '01',
    label: 'Discover',
    heading: 'One scan, no memory tax.',
    body: 'RunHQ walks your dev folders, infers runtimes and start commands from manifest files, and keeps the registry local. Open the app and your projects are already a workspace, not a directory hunt.',
    bullets: [
      {
        strong: '10 runtime families',
        rest: ' · Node, Bun, Deno, Go, Rust, .NET, Python, Java, Ruby, PHP, Docker',
      },
      {
        strong: 'Manifest-aware commands',
        rest: ' · package.json, go.mod, Cargo.toml, pyproject.toml, compose.yaml',
      },
      {
        strong: 'Persistent local registry',
        rest: ' · ~/.runhq/config.json plus SQLite snapshots',
      },
    ],
    cockpit: (
      <CockpitChrome
        title={
          <>
            <b className="text-fg">RunHQ</b> · ~/code · scanning…
          </>
        }
        statusPill={
          <span className="text-fg-muted inline-flex items-center gap-1.5 text-[11px]">
            <span className="bg-status-starting h-1.5 w-1.5 animate-pulse rounded-full" />
            Walking ~/code
          </span>
        }
      >
        <div className="bg-surface flex h-[420px]">
          <WorkspaceSidebar services={LOOP_DISCOVER_SERVICES} statuses={LOOP_DISCOVER_STATUSES} />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="border-border bg-surface-muted/40 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
              <strong className="text-fg text-[13px]">7 projects indexed</strong>
              <span className="text-fg-dim text-[11px]">·</span>
              <span className="text-fg-muted text-[12px]">cached to ~/.runhq/config.json</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {['3 node', '1 go', '1 rust', '1 .net', '1 docker'].map((chip) => (
                  <span
                    key={chip}
                    className="bg-surface text-fg-muted rounded-md px-2 py-0.5 font-mono text-[10.5px]"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <ul className="flex flex-col gap-1.5 overflow-y-auto pr-1">
              {LOOP_DISCOVER_SERVICES.map((svc, idx) => {
                const runtime =
                  svc.tags.find(
                    (t) =>
                      t !== 'frontend' &&
                      t !== 'backend' &&
                      t !== 'tooling' &&
                      t !== 'worker' &&
                      t !== 'database' &&
                      t !== 'infra',
                  ) ??
                  svc.tags[0] ??
                  '';
                return (
                  <li
                    key={svc.id}
                    className="border-border bg-surface-overlay/40 flex items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <span className="text-fg-dim w-6 font-mono text-[10.5px] tabular-nums">
                      00:0{idx}
                    </span>
                    <span className="text-fg text-[12.5px] font-medium">{svc.name}</span>
                    <span className="bg-surface-muted text-fg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
                      {runtime}
                    </span>
                    <span className="text-fg-dim font-mono text-[11px]">
                      {svc.cmds[0]?.cmd ?? ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </CockpitChrome>
    ),
  },
  {
    id: 'orchestrate',
    num: '02',
    label: 'Run',
    heading: 'Start the stack, logs included.',
    body: 'Group services into named stacks and start them together. Each command gets its own log tab, terminal-grade ANSI output, graceful shutdown, and the same port watchdog when something else is holding :5432.',
    bullets: [
      { strong: 'Play all', rest: ' · multi-command services and stacks' },
      { strong: 'Command log tabs', rest: ' · follow, search, copy, AI triage' },
      { strong: 'Port watchdog', rest: ' · live TCP list and one-click kill' },
      { strong: 'Cmd+K palette', rest: ' · cross-project fuzzy search' },
    ],
    cockpit: (
      <CockpitChrome
        title={
          <>
            <b className="text-fg">RunHQ</b> · acme-platform stack
          </>
        }
        statusPill={
          <span className="text-status-running inline-flex items-center gap-1.5 text-[11px]">
            <span className="bg-status-running h-1.5 w-1.5 rounded-full" />3 / 4 running
          </span>
        }
      >
        <div className="bg-surface flex h-[420px]">
          <WorkspaceSidebar
            services={LOOP_ORCHESTRATE_SERVICES}
            statuses={LOOP_ORCHESTRATE_STATUSES}
            selectedServiceId="svc-orch-api"
          />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="border-border bg-surface-muted/40 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
              <strong className="text-fg text-[13px]">acme-platform</strong>
              <span className="text-fg-dim text-[11px]">·</span>
              <span className="text-fg-muted text-[12px]">go · pg · node · redis</span>
              <span className="bg-status-running/15 text-status-running ml-auto rounded-md px-2 py-0.5 text-[10.5px] font-semibold tracking-wider uppercase">
                Stack live
              </span>
            </div>
            <LogTerminalMock
              title="api · go run ./cmd/api"
              rightSlot={
                <span className="text-status-running font-mono text-[10.5px]">RUNNING</span>
              }
              lines={ORCH_LOG}
              className="flex-1"
            />
          </div>
        </div>
      </CockpitChrome>
    ),
  },
  {
    id: 'heal',
    num: '03',
    label: 'Triage',
    heading: 'Turn workspace noise into next actions.',
    body: 'Every dependency scan, git signal, port, process and command failure becomes part of the same local picture. AI can use that workspace context — local model or cloud, your call — to write a triage plan you can act on.',
    bullets: [
      { strong: 'Health snapshot', rest: ' · CVEs, outdated packages, stale scans, dirty git' },
      { strong: 'Per-project rescan', rest: ' · fix one repo without sweeping everything' },
      { strong: 'Workspace AI', rest: ' · "what should I fix first?" with real context' },
      { strong: 'Local-first', rest: ' · BYO endpoint, no telemetry, no account' },
    ],
    cockpit: (
      <CockpitChrome
        title={
          <>
            <b className="text-fg">RunHQ</b> · acme-platform · port collision
          </>
        }
        statusPill={
          <span className="text-status-error inline-flex items-center gap-1.5 text-[11px]">
            <span className="bg-status-error h-1.5 w-1.5 rounded-full" />
            api crashed
          </span>
        }
      >
        <div className="bg-surface flex h-[420px]">
          <WorkspaceSidebar
            services={LOOP_TRIAGE_SERVICES}
            statuses={LOOP_TRIAGE_STATUSES}
            selectedServiceId="svc-orch-api"
          />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="border-status-error/30 bg-status-error/8 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
              <strong className="text-status-error text-[13px]">api exited 1</strong>
              <span className="text-fg-dim text-[11px]">·</span>
              <span className="text-fg-muted text-[12px]">
                port :8080 held by next-dev (pid 7421)
              </span>
              <button
                type="button"
                className="bg-status-error/15 text-status-error hover:bg-status-error/25 ml-auto rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
              >
                Kill :8080
              </button>
            </div>
            <LogTerminalMock
              title="api · cargo run"
              rightSlot={<span className="text-status-error font-mono text-[10.5px]">CRASHED</span>}
              lines={TRIAGE_TERM_LOG}
              className="flex-1"
            />
            <div className="border-accent/30 bg-accent/5 flex items-start gap-2 rounded-lg border p-3">
              <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="text-fg text-[12px] leading-relaxed">
                <span className="text-accent font-semibold">AI triage:</span> kill pid 7421, then
                restart <code className="text-accent font-mono">api</code>. The cached build is
                still warm — restart should land in &lt;500ms.
              </div>
            </div>
          </div>
        </div>
      </CockpitChrome>
    ),
  },
];

export function LoopSection() {
  const [active, setActive] = useState<LoopTabId>('discover');
  const tab = TABS.find((t) => t.id === active) ?? TABS[0]!;

  return (
    <section id="loop" aria-labelledby="loop-heading" className="mx-auto max-w-6xl px-6 py-24">
      <div className="flex flex-col gap-3">
        <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
          Product loop · Discover · Run · Triage
        </span>
        <h2
          id="loop-heading"
          className="text-fg max-w-2xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
        >
          The daily loop RunHQ compresses.
        </h2>
        <p className="text-fg-muted max-w-2xl text-[15px] leading-relaxed">
          Find the repo, remember how it boots, start the stack, chase logs, check ports, then
          decide what deserves attention. RunHQ turns that routine into one persistent local
          cockpit.
        </p>
      </div>

      <div role="tablist" className="mt-8 flex flex-wrap items-center gap-2">
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
                isActive
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-border text-fg-muted hover:text-fg hover:border-border-strong',
              )}
            >
              <span className="font-mono text-[10.5px] opacity-70">{t.num}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <h3 className="text-fg text-[24px] leading-tight font-semibold tracking-[-0.015em]">
            {tab.heading}
          </h3>
          <p className="text-fg-muted text-[15px] leading-relaxed">{tab.body}</p>
          <ul className="text-fg-muted flex flex-col gap-2 text-[13.5px]">
            {tab.bullets.map((b, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="bg-accent mt-1.5 h-1 w-1 shrink-0 rounded-full" />
                <span>
                  <strong className="text-fg">{b.strong}</strong>
                  {b.rest}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:sticky lg:top-24">{tab.cockpit}</div>
      </div>
    </section>
  );
}
