import {
  AiPromptMock,
  ResourceBadge,
  RunningHotPanel,
  RuntimeBadge,
  Sparkline,
  StatusDot,
  type RunningHotRow,
} from '@runhq/cockpit-ui';
import { GitBranch } from 'lucide-react';

/**
 * Card 2 — "RunHQ" — uses the same `RunningHotPanel` fixture you see
 * in the full dashboard above, deliberately, so the eye recognises
 * the visual language one section into the page. We hand-pick the
 * three running services + a synthetic memory ceiling rather than
 * importing the full dashboard fixture so the bars feel proportional
 * inside a 320px-wide card. */
const RUNNING_ROWS: RunningHotRow[] = [
  { name: 'acme-web', memoryBytes: 178 * 1024 * 1024, cpuPercent: 0, fill: 1 },
  {
    name: 'acme-compose',
    memoryBytes: 80 * 1024 * 1024,
    cpuPercent: 0,
    fill: 80 / 178,
  },
  { name: 'acme-api', memoryBytes: 29 * 1024 * 1024, cpuPercent: 0, fill: 29 / 178 },
];

/** Sparkline samples for the RunHQ snapshot — 24 evenly-spaced
 *  pseudo-random values seeded so each build paints the same
 *  silhouette (no hydration mismatch). */
const PULSE = (() => {
  let seed = 0x6c078965;
  const out: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    seed = (seed * 16807) % 2147483647;
    out.push(20 + (seed % 70));
  }
  return out;
})();

/**
 * "Chaos" mock for Card 1 — three loose terminal-tab placeholders
 * with mismatched runtimes and ad-hoc colors. Intentionally visually
 * unaligned to evoke the feeling of "everything lives in different
 * windows". Mirrors the raw chaos a developer juggles before RunHQ.
 */
const CHAOS_TABS: Array<{
  label: string;
  port: string;
  runtime: 'node' | 'go' | 'docker' | 'python';
  state: 'idle' | 'busy' | 'crashed';
  rotate: string;
}> = [
  { label: 'acme-web :3000', port: 'iTerm', runtime: 'node', state: 'busy', rotate: '-rotate-1' },
  { label: 'acme-api :8080', port: 'Warp', runtime: 'go', state: 'crashed', rotate: 'rotate-2' },
  {
    label: 'docker compose',
    port: 'Hyper',
    runtime: 'docker',
    state: 'busy',
    rotate: '-rotate-2',
  },
  {
    label: 'data-jobs train',
    port: 'tmux',
    runtime: 'python',
    state: 'idle',
    rotate: 'rotate-1',
  },
];

const CHAOS_DOT: Record<(typeof CHAOS_TABS)[number]['state'], string> = {
  busy: 'bg-status-running',
  crashed: 'bg-status-error',
  idle: 'bg-fg-dim',
};

/** "Why RunHQ" — three-column comparison. The middle card now
 *  re-uses the actual `<RunningHotPanel/>` from cockpit-ui so the
 *  reader sees the same surface the dashboard renders, sized down. */
export function WhySection() {
  return (
    <section
      id="why"
      aria-labelledby="why-heading"
      className="border-border/60 border-t bg-[rgb(var(--surface-muted)/0.4)] py-24"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-3">
          <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
            Why · The local-first dev cockpit
          </span>
          <h2
            id="why-heading"
            className="text-fg max-w-2xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
          >
            Your editor edits code. RunHQ coordinates the environment.
          </h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Card 01 — chaos */}
          <article className="border-border bg-surface-overlay/50 flex flex-col gap-3 rounded-2xl border p-6">
            <div className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              01 · The status quo
            </div>
            <h3 className="text-fg text-[18px] font-semibold">Terminal tabs are hidden state.</h3>
            <p className="text-fg-muted text-[13.5px] leading-relaxed">
              Foreman runs one Procfile. Your IDE remembers recents. Docker Desktop shows
              containers. The rest is a pile of terminal tabs, shell history and memory.
            </p>
            <div className="bg-surface-muted/40 border-border/60 mt-2 flex h-44 items-center justify-center overflow-hidden rounded-lg border">
              <div className="relative h-full w-full">
                {CHAOS_TABS.map((tab, i) => (
                  <div
                    key={tab.label}
                    className={`border-border bg-surface absolute flex w-44 items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-md transition ${tab.rotate}`}
                    style={{
                      top: `${10 + i * 30}px`,
                      left: `${i % 2 === 0 ? 16 : 96}px`,
                    }}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${CHAOS_DOT[tab.state]}`}
                      aria-hidden
                    />
                    <span className="text-fg truncate text-[11px] font-medium">{tab.label}</span>
                    <RuntimeBadge runtime={tab.runtime} className="ml-auto text-[9px]" />
                  </div>
                ))}
              </div>
            </div>
            <p className="text-fg-dim text-[11.5px] italic">
              4 terminals, 3 runtimes, 1 broken port, zero shared state.
            </p>
          </article>

          {/* Card 02 — RunHQ snapshot using real cockpit-ui pieces */}
          <article className="border-accent/30 bg-accent/[0.04] flex flex-col gap-3 rounded-2xl border p-6">
            <div className="text-accent text-[11px] font-semibold tracking-[0.12em] uppercase">
              02 · RunHQ
            </div>
            <h3 className="text-fg text-[18px] font-semibold">
              RunHQ gives local dev one surface.
            </h3>
            <p className="text-fg-muted text-[13.5px] leading-relaxed">
              Projects, services, logs, ports, git state, CVEs and stale scans live together. The
              cockpit answers &ldquo;what is happening on this machine?&rdquo;
            </p>

            <div className="bg-surface border-border/80 mt-2 flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-[11px]">
                <StatusDot status="running" size="xs" />
                <span className="text-fg font-semibold">acme-platform</span>
                <RuntimeBadge runtime="docker" />
                <span className="text-fg-dim ml-auto inline-flex items-center gap-1 font-mono text-[10px]">
                  <GitBranch className="h-3 w-3" /> main
                </span>
              </div>

              <RunningHotPanel
                rows={RUNNING_ROWS}
                totalMemoryBytes={287 * 1024 * 1024}
                totalCpuPercent={0}
                className="mx-0 px-3 py-2.5"
              />

              <div className="flex items-center gap-1.5">
                <span className="bg-status-running/15 text-status-running rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                  <StatusDot status="running" size="xs" /> 3 on
                </span>
                <span className="bg-surface-muted text-fg-muted rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                  <StatusDot status="stopped" size="xs" /> 4 idle
                </span>
                <ResourceBadge
                  sample={{ cpu_percent: 0, memory_bytes: 287 * 1024 * 1024 }}
                  compact
                />
                <Sparkline data={PULSE} width={80} height={24} className="ml-auto" />
              </div>
            </div>
          </article>

          {/* Card 03 — AI */}
          <article className="border-border bg-surface-overlay/50 flex flex-col gap-3 rounded-2xl border p-6">
            <div className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              03 · The AI difference
            </div>
            <h3 className="text-fg text-[18px] font-semibold">AI gets the missing context.</h3>
            <p className="text-fg-muted text-[13.5px] leading-relaxed">
              File-level AI can write code. RunHQ can explain the workspace around that code: which
              project is stale, which command failed, which CVE should go first.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="bg-status-error/15 text-status-error rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                <StatusDot status="crashed" size="xs" /> 1 cve
              </span>
              <span className="bg-status-starting/15 text-status-starting rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                <StatusDot status="starting" size="xs" /> 3 stale
              </span>
              <span className="bg-surface-muted text-fg-muted rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                <StatusDot status="stopped" size="xs" /> 2 dirty
              </span>
              <span className="text-fg-dim ml-auto font-mono text-[10.5px]">workspace pulse</span>
            </div>

            <AiPromptMock
              className="mt-1"
              prompt="which projects need me this week?"
              answer={
                <>
                  <b>3</b> repos haven&rsquo;t moved in 90d. <b>acme-api</b> has a critical CVE in
                  axios. <b>internal-cli</b> is 12 packages outdated.
                </>
              }
            />
          </article>
        </div>
      </div>
    </section>
  );
}
