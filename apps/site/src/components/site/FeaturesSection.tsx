import { Activity, BrainCircuit, Check, type LucideIcon, Stethoscope } from 'lucide-react';
import {
  AiPromptMock,
  DashboardServiceCard,
  LogTerminalMock,
  ResourceBadge,
  Sparkline,
  StatusDot,
  type LogLineFixture,
} from '@runhq/cockpit-ui';
import type { ReactNode } from 'react';
import { MOCK_SERVICES } from '@/lib/fixtures';

interface FeatureCard {
  icon: LucideIcon;
  title: string;
  sub: string;
  bullets: string[];
  foot: string;
  /** Visual snippet rendered above the bullet list. Built out of
   *  real cockpit-ui primitives (DashboardServiceCard,
   *  LogTerminalMock, ResourceBadge, Sparkline, AiPromptMock) so
   *  every card mirrors what visitors see in the desktop app
   *  rather than a marketing reproduction. */
  visual: ReactNode;
}

const OBSERVE_LOG: LogLineFixture[] = [
  {
    kind: 'stdout',
    ts: '14:02',
    segments: [
      { tone: 'accent', text: 'GET' },
      { text: ' /healthz · ' },
      { tone: 'success', text: '200' },
    ],
  },
  {
    kind: 'stderr',
    ts: '14:02',
    segments: [
      { tone: 'error', text: 'WARN' },
      { text: ' n+1 query · ' },
      { tone: 'dim', text: 'orders.handler' },
    ],
  },
  {
    kind: 'stdout',
    ts: '14:03',
    segments: [
      { tone: 'accent', text: 'POST' },
      { text: ' /orders · ' },
      { tone: 'success', text: '201' },
    ],
  },
];

/** Sparkline data for the Triage card pulse — same seeded RNG style
 *  as WhySection so SSR + hydration agree. */
const TRIAGE_PULSE = (() => {
  let seed = 0x1f86_3a18;
  const out: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    seed = (seed * 16807) % 2147483647;
    out.push(15 + (seed % 65));
  }
  return out;
})();

/** Pulled from the workspace fixture so the Run card paints the
 *  same `acme-api` row visitors see in `<DesktopDashboard />` —
 *  reinforces the "this is the actual product surface" message
 *  across sections instead of inventing a card-shaped clone. */
const RUN_FEATURE_SERVICE = MOCK_SERVICES.find((s) => s.id === 'svc-acme-api') ?? MOCK_SERVICES[0]!;

const CARDS: FeatureCard[] = [
  {
    icon: Check,
    title: 'Run',
    sub: 'Start services, stacks and custom commands without reopening the same terminal tabs every morning.',
    bullets: [
      'SIGTERM → grace → SIGKILL',
      'Multi-command per service',
      'Port watchdog',
      'One-click kill port',
      'Embedded xterm.js',
      'Open in 8 IDEs',
      '⌘K palette',
      '⌘⇧K global hotkey',
    ],
    foot: 'Graceful shutdown, multi-command services, one-click IDE launch.',
    visual: (
      // The real `<DashboardServiceCard />` from cockpit-ui — same
      // primitive the full dashboard renders. Sized down via the
      // wrapper's text scale so it stays compact inside the
      // four-column grid.
      <DashboardServiceCard
        service={RUN_FEATURE_SERVICE}
        status="running"
        runtime="rust"
        branch="main"
        sample={{ cpu_percent: 4.2, memory_bytes: 29 * 1024 * 1024 }}
        attention={{ count: 1, tone: 'warning' }}
      />
    ),
  },
  {
    icon: Activity,
    title: 'Observe',
    sub: 'Command logs open as tabs, render like a real terminal, and stay searchable while services run.',
    bullets: [
      'Ring buffer · 10k/svc',
      'Virtualized list',
      'ANSI color · live filter',
      'Activity timeline',
      'Daily / weekly rollups',
      'Standup export',
      'Right-click → AI triage',
      'SQLite persistence',
    ],
    foot: 'Search, follow, copy lines, and send suspicious output to AI.',
    visual: (
      <LogTerminalMock
        title="api · go run ./cmd/api"
        rightSlot={<span className="text-status-running font-mono text-[9.5px]">RUN</span>}
        lines={OBSERVE_LOG}
        caret={false}
        className="text-[10.5px]"
      />
    ),
  },
  {
    icon: Stethoscope,
    title: 'Triage',
    sub: 'See stale scans, outdated packages, CVEs and dirty git across the whole local portfolio before they become surprises.',
    bullets: [
      'npm · cargo · pip audit',
      'Persistent scan cache',
      'Per-card freshness',
      'Per-project rescan',
      'Scan delta badges',
      '"N stale" pill',
      'Worst-offenders panel',
      'Triage drawer',
    ],
    foot: 'Cold start paints chips in < 100 ms from SQLite.',
    visual: (
      <div className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase">
          <span className="bg-status-error/15 text-status-error inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <StatusDot status="crashed" size="xs" /> 1 cve
          </span>
          <span className="bg-status-starting/15 text-status-starting inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <StatusDot status="starting" size="xs" /> 3 stale
          </span>
          <span className="bg-surface-muted text-fg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <StatusDot status="stopped" size="xs" /> 2 dirty
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkline data={TRIAGE_PULSE} width={120} height={28} />
          <ResourceBadge
            sample={{ cpu_percent: 12, memory_bytes: 287 * 1024 * 1024 }}
            compact
            className="ml-auto"
          />
        </div>
        <div className="text-fg-dim flex items-center justify-between font-mono text-[9.5px]">
          <span className="text-status-error">↑ axios CVE blocks deploy</span>
          <span>12 outdated</span>
        </div>
      </div>
    ),
  },
  {
    icon: BrainCircuit,
    title: 'Think',
    sub: 'Ask questions against the whole workspace with your own OpenAI-compatible endpoint, local or cloud.',
    bullets: [
      'Project · Why?',
      'Workspace report',
      'Per-CVE deep-dive',
      'In-place commit gen',
      'Diff explain',
      'Log triage',
      '5-tab chat · SQLite',
      'tiktoken-rs token meter',
    ],
    foot: 'Point it at a local model — code, diffs, logs never leave the machine.',
    visual: (
      <AiPromptMock
        compact
        prompt="what should I fix first?"
        answer={
          <>
            <b>acme-api</b> · axios CVE blocks deploy. Patch first.
          </>
        }
        model="local · qwen2.5-coder"
        tokens="128 tok"
      />
    ),
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="mx-auto max-w-7xl px-6 py-24"
    >
      <div className="flex flex-col gap-3">
        <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
          Features · Run · Observe · Triage · Think
        </span>
        <h2
          id="features-heading"
          className="text-fg max-w-3xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
        >
          Everything outside the editor, finally in one place.
        </h2>
        <p className="text-fg-muted max-w-2xl text-[15px] leading-relaxed">
          RunHQ is the local dev cockpit: launch the stack, watch the logs, clear port conflicts,
          read workspace health and ask AI for next actions without leaving the same surface.
        </p>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              className="border-border bg-surface-overlay/50 hover:border-accent/30 flex flex-col gap-3 rounded-2xl border p-5 transition"
            >
              <div className="flex items-center gap-2">
                <div className="bg-accent/15 text-accent flex h-9 w-9 items-center justify-center rounded-lg">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-fg text-[18px] font-semibold">{card.title}</h3>
              </div>
              {card.visual}
              <p className="text-fg-muted text-[13px] leading-relaxed">{card.sub}</p>
              <ul className="text-fg-muted/90 mt-1 flex flex-col gap-1 text-[12px]">
                {card.bullets.map((b) => (
                  <li key={b} className="flex items-baseline gap-1.5">
                    <span className="bg-accent/60 mt-1.5 h-1 w-1 shrink-0 rounded-full" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="text-fg-dim border-border/60 mt-2 border-t pt-3 text-[11.5px] italic">
                {card.foot}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
