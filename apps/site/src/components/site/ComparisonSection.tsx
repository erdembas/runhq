import { Check, Minus, X } from 'lucide-react';
import { CockpitChrome, StatusDot, cn } from '@runhq/cockpit-ui';

/**
 * "How RunHQ compares to {Foreman, Overmind, …}" section.
 *
 * Why this section exists:
 *   - "Foreman alternative", "Overmind alternative", "Docker
 *     Compose alternative for local dev", "Concurrently
 *     alternative", "mprocs alternative" are *high-intent* SEO
 *     queries — every visitor reaching them is comparison-shopping
 *     for a process manager. Owning the answer = owning the
 *     conversion.
 *   - Google ranks a structured comparison table extremely well
 *     for "X vs Y" queries (it's the format the SERP wants to
 *     show). We render real semantic <table> markup so the crawler
 *     reads the cell-level signal — not a div soup.
 *   - Re-using `<CockpitChrome />` framing means the table feels
 *     like a piece of the actual product, not a marketing
 *     afterthought.
 *
 * Visual design:
 *   - First row is RunHQ, accent-tinted, with a `running` StatusDot
 *     so it reads like the "selected" service in the cockpit.
 *   - Other tools render as "stopped" rows — the metaphor is
 *     intentional: "all tools work, this one's the one I'm
 *     running".
 *   - Cells use `Check / Minus / X` icons (same lucide set the
 *     dashboard uses for actions) so the row colour follows the
 *     status colour we already publish for the running-hot table.
 *
 * Accessibility: the `<table>` is a real data table — header row
 * with `<th scope="col">` and a `<caption>` for screen readers.
 * Each cell carries a hidden `<span class="sr-only">` value so
 * "yes / partial / no" is announced explicitly instead of relying
 * on the icon alone.
 */

type Support = 'yes' | 'partial' | 'no';

interface ToolRow {
  /** Display name. Markdown not allowed — flow into <th> directly. */
  name: string;
  /** "Foreman" → "Procfile-style runner" — sub-text rendered under
   *  the name so the user can pattern-match without knowing every
   *  tool. */
  category: string;
  highlight?: boolean;
  /** Note rendered under the name on the highlight row only. */
  note?: string;
  cells: Record<FeatureKey, Support>;
}

type FeatureKey = 'multi' | 'runtimes' | 'logs' | 'ports' | 'cves' | 'git' | 'ai' | 'gui';

interface Feature {
  key: FeatureKey;
  label: string;
  /** One-line tooltip / sub-label rendered under the column head. */
  hint: string;
}

const FEATURES: Feature[] = [
  { key: 'multi', label: 'Multi-process', hint: 'Run many services at once' },
  {
    key: 'runtimes',
    label: 'Multi-runtime',
    hint: 'Node, Go, Rust, Python, …',
  },
  { key: 'logs', label: 'Searchable logs', hint: 'ANSI, ring buffer, follow' },
  { key: 'ports', label: 'Port watchdog', hint: 'See & kill stuck ports' },
  { key: 'cves', label: 'CVE / outdated', hint: 'Per-project audit' },
  { key: 'git', label: 'Git status', hint: 'Across all repos' },
  { key: 'ai', label: 'AI triage', hint: 'BYO endpoint, local-first' },
  { key: 'gui', label: 'Native GUI', hint: 'macOS · Linux · Windows' },
];

const TOOLS: ToolRow[] = [
  {
    name: 'RunHQ',
    category: 'Local dev cockpit · Tauri + Rust',
    highlight: true,
    note: 'MIT · &lt; 100 MB RAM · zero telemetry',
    cells: {
      multi: 'yes',
      runtimes: 'yes',
      logs: 'yes',
      ports: 'yes',
      cves: 'yes',
      git: 'yes',
      ai: 'yes',
      gui: 'yes',
    },
  },
  {
    name: 'Foreman',
    category: 'Procfile runner · Ruby CLI',
    cells: {
      multi: 'yes',
      runtimes: 'partial',
      logs: 'partial',
      ports: 'no',
      cves: 'no',
      git: 'no',
      ai: 'no',
      gui: 'no',
    },
  },
  {
    name: 'Overmind / Hivemind',
    category: 'tmux-backed Procfile runner',
    cells: {
      multi: 'yes',
      runtimes: 'partial',
      logs: 'yes',
      ports: 'no',
      cves: 'no',
      git: 'no',
      ai: 'no',
      gui: 'no',
    },
  },
  {
    name: 'mprocs',
    category: 'TUI process manager · Rust',
    cells: {
      multi: 'yes',
      runtimes: 'partial',
      logs: 'yes',
      ports: 'no',
      cves: 'no',
      git: 'no',
      ai: 'no',
      gui: 'no',
    },
  },
  {
    name: 'Concurrently / npm-run-all',
    category: 'npm script multiplexer',
    cells: {
      multi: 'yes',
      runtimes: 'no',
      logs: 'partial',
      ports: 'no',
      cves: 'no',
      git: 'no',
      ai: 'no',
      gui: 'no',
    },
  },
  {
    name: 'VSCode tasks / launch.json',
    category: 'Editor task runner',
    cells: {
      multi: 'partial',
      runtimes: 'yes',
      logs: 'partial',
      ports: 'partial',
      cves: 'no',
      git: 'partial',
      ai: 'partial',
      gui: 'no',
    },
  },
];

const SUPPORT_META: Record<
  Support,
  {
    label: string;
    icon: typeof Check;
    iconClass: string;
    cellClass: string;
    srLabel: string;
  }
> = {
  yes: {
    label: '',
    icon: Check,
    iconClass: 'text-status-running',
    cellClass: 'bg-status-running/8',
    srLabel: 'Yes',
  },
  partial: {
    label: 'partial',
    icon: Minus,
    iconClass: 'text-status-starting',
    cellClass: 'bg-status-starting/8',
    srLabel: 'Partial',
  },
  no: {
    label: '',
    icon: X,
    iconClass: 'text-fg-dim/60',
    cellClass: '',
    srLabel: 'No',
  },
};

function SupportCell({ value }: { value: Support }) {
  const meta = SUPPORT_META[value];
  const Icon = meta.icon;
  return (
    <td className={cn('border-border/40 border-b p-0 text-center', meta.cellClass)}>
      <span className="flex items-center justify-center gap-1 px-3 py-2.5">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconClass)} />
        {meta.label && (
          <span
            className={cn('font-mono text-[10px] tracking-wider uppercase', meta.iconClass)}
            aria-hidden
          >
            {meta.label}
          </span>
        )}
        <span className="sr-only">{meta.srLabel}</span>
      </span>
    </td>
  );
}

export function ComparisonSection() {
  return (
    <section
      id="alternatives"
      aria-labelledby="alternatives-heading"
      className="border-border/60 border-t py-24"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-3">
          <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
            Alternatives · Comparison
          </span>
          <h2
            id="alternatives-heading"
            className="text-fg max-w-3xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
          >
            How RunHQ compares to Foreman, Overmind, mprocs and Concurrently.
          </h2>
          <p className="text-fg-muted max-w-2xl text-[15px] leading-relaxed">
            Procfile runners cover one process file. Editor task runners cover one workspace. RunHQ
            covers the whole machine — every service, every port, every repo&rsquo;s git and CVE
            state, in one local-first cockpit.
          </p>
        </div>

        <div className="mt-10">
          <CockpitChrome
            title={
              <>
                <b className="text-fg">RunHQ</b> · process-manager comparison
              </>
            }
            statusPill={
              <span className="text-fg-muted inline-flex items-center gap-1.5 text-[11px]">
                <span className="bg-accent h-1.5 w-1.5 rounded-full" />6 tools · 8 capabilities
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-[12.5px]">
                <caption className="sr-only">
                  Capability matrix comparing RunHQ to other developer process managers and local
                  service runners. Columns are capabilities, rows are tools.
                </caption>
                <thead>
                  <tr className="border-border bg-surface-muted/40 border-b">
                    <th
                      scope="col"
                      className="text-fg-muted sticky left-0 bg-[rgb(var(--surface-muted)/0.95)] px-4 py-3 font-semibold tracking-tight backdrop-blur"
                    >
                      Tool
                    </th>
                    {FEATURES.map((f) => (
                      <th
                        key={f.key}
                        scope="col"
                        className="text-fg-muted px-3 py-3 text-center font-semibold tracking-tight"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span>{f.label}</span>
                          <span className="text-fg-dim text-[10.5px] font-normal">{f.hint}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TOOLS.map((tool) => (
                    <tr
                      key={tool.name}
                      className={cn(
                        'transition',
                        tool.highlight
                          ? 'bg-accent/[0.06]'
                          : 'bg-surface hover:bg-surface-muted/30',
                      )}
                    >
                      <th
                        scope="row"
                        className={cn(
                          'border-border/40 border-b px-4 py-3 align-middle font-normal',
                          tool.highlight && 'border-l-accent border-l-2',
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          {tool.highlight ? (
                            // Real RunHQ brand mark on the highlight
                            // row — the same `icon.png` the hero +
                            // nav + footer + final-cta render. Other
                            // rows fall back to the cockpit
                            // StatusDot so the visual hierarchy
                            // reads at a glance: "icon = us, dot =
                            // them".
                            <img
                              src="/icon.png"
                              alt=""
                              width={28}
                              height={28}
                              className="h-7 w-7 shrink-0"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <StatusDot status="stopped" size="sm" />
                          )}
                          <div className="flex flex-col">
                            <span
                              className={cn(
                                'text-[13px] font-semibold',
                                tool.highlight ? 'text-accent' : 'text-fg',
                              )}
                            >
                              {tool.name}
                            </span>
                            <span className="text-fg-dim text-[11px]">{tool.category}</span>
                            {tool.note && (
                              <span
                                className="text-accent/80 mt-0.5 font-mono text-[10px]"
                                dangerouslySetInnerHTML={{ __html: tool.note }}
                              />
                            )}
                          </div>
                        </div>
                      </th>
                      {FEATURES.map((f) => (
                        <SupportCell key={f.key} value={tool.cells[f.key]} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CockpitChrome>

          <p className="text-fg-dim mx-auto mt-5 max-w-3xl text-center text-[12px] italic">
            Capability data sourced from each project&rsquo;s public README / docs as of{' '}
            <time dateTime="2026-05-05">May 2026</time>. Open a PR if a row is out of date —{' '}
            <a className="text-accent hover:underline" href="https://github.com/erdembas/runhq">
              github.com/erdembas/runhq
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
