import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { StatusDot } from '@runhq/cockpit-ui';

/**
 * FAQ section paired with FAQPage JSON-LD.
 *
 * Why both:
 *   - The visible `<details>` blocks render the answers for humans
 *     and for any crawler that follows DOM text (Bing, DuckDuckGo,
 *     LLM scrapers).
 *   - The `<script type="application/ld+json">` blob feeds Google's
 *     FAQPage rich-result pipeline. Even though Google rolled back
 *     widespread FAQ rich results in 2023, the schema still drives
 *     answer-engine citations in Bard / SGE / Perplexity / GPT
 *     browsing — the marginal-cost-zero SEO win.
 *
 * Question selection: each question targets a real comparison or
 * objection-handling search query the devtool category sees:
 *   - "What is RunHQ" → brand definition, fuels knowledge panel
 *   - "Foreman / Overmind alternative" → comparison intent
 *   - "Replace Docker Desktop" → high-volume cost-driven search
 *   - "Does my code leave the machine?" → privacy objection
 *   - "Which runtimes are supported?" → discovery intent
 *   - "VSCode / Cursor companion" → editor adjacency intent
 *   - "Free / open source?" → license intent
 *
 * Answers are concise (2-3 sentences) so the rich-result snippet
 * doesn't get truncated. The plain-text representation stays in
 * sync with `FAQ_ITEMS` because the JSON-LD blob and the visible
 * `<details>` both render from the same array — single source of
 * truth. */

interface FaqItem {
  q: string;
  /** Human-readable answer rendered in the `<details>` block. May
   *  contain inline tags. */
  a: ReactNode;
  /** Plain-text mirror used in the JSON-LD payload. Must be
   *  semantically equivalent to `a` — drift breaks the schema
   *  audit. */
  aPlain: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'What is RunHQ?',
    a: (
      <>
        RunHQ is a <strong>local-first developer cockpit</strong> for your laptop. It auto-discovers
        the repos in your dev folder, lets you start whole stacks with one click, opens a log tab
        per command, watches ports, scans dependencies for CVEs, and lets AI triage the workspace.
        Native desktop app, MIT-licensed, written in Rust + Tauri.
      </>
    ),
    aPlain:
      'RunHQ is a local-first developer cockpit. It auto-discovers your repos, runs services and stacks, opens log tabs, watches ports, scans CVEs, tracks git status, and lets AI triage your workspace. Native desktop app for macOS, Linux and Windows, MIT-licensed, written in Rust and Tauri.',
  },
  {
    q: 'How is RunHQ different from Foreman, Overmind, mprocs or Concurrently?',
    a: (
      <>
        Procfile-style runners (Foreman, Overmind, Hivemind) and TUI process managers (mprocs) cover{' '}
        <em>one</em> Procfile per repo and stop there. RunHQ covers the whole machine — services
        across every repo, port watchdog, CVE + outdated-dependency scanner, git status, AI triage,
        and a real native GUI. See the{' '}
        <a className="text-accent hover:underline" href="#alternatives">
          comparison matrix
        </a>{' '}
        for the cell-by-cell breakdown.
      </>
    ),
    aPlain:
      'Procfile runners like Foreman, Overmind and mprocs cover one Procfile per repo. RunHQ covers the whole machine: services across every repo, port watchdog, CVE scanner, git status, AI triage, and a native cross-platform GUI.',
  },
  {
    q: 'Does RunHQ replace Docker Desktop?',
    a: (
      <>
        For local <em>development</em>, often yes. RunHQ runs your services natively (Node, Go,
        Rust, Python, …) without containerising them, but it can also start Docker Compose stacks
        the same way it starts a `pnpm dev`. Many teams keep Docker for production parity tests and
        use RunHQ for the day-to-day inner loop.
      </>
    ),
    aPlain:
      'For local development, RunHQ often replaces Docker Desktop. It runs services natively (Node, Go, Rust, Python and more), but can also start Docker Compose stacks. Teams typically keep Docker for production-parity tests and use RunHQ for the daily inner loop.',
  },
  {
    q: 'Does my code or AI prompt ever leave my machine?',
    a: (
      <>
        Never by default. RunHQ has zero telemetry, no account, and no built-in cloud sync. AI
        triage uses any OpenAI-compatible endpoint <em>you</em> point it at — that can be a local
        model (Ollama, LM Studio, qwen2.5-coder, llama.cpp) or your own cloud key. Logs, scans, and
        chat tabs persist to a local SQLite file under <code className="font-mono">~/.runhq/</code>.
      </>
    ),
    aPlain:
      'No. RunHQ has zero telemetry, no account, and no built-in cloud sync. AI triage uses any OpenAI-compatible endpoint you provide, including local models like Ollama, LM Studio or llama.cpp. All data persists to a local SQLite file under ~/.runhq.',
  },
  {
    q: 'Which runtimes and package managers does RunHQ auto-discover?',
    a: (
      <>
        Ten runtime families today: <strong>Node.js</strong>, <strong>Bun</strong>,{' '}
        <strong>Deno</strong>, <strong>Go</strong>, <strong>Rust</strong>, <strong>.NET</strong>,{' '}
        <strong>Python</strong> (Poetry / uv / pip), <strong>Java</strong> (Maven + Gradle),{' '}
        <strong>Ruby</strong>, <strong>PHP</strong>, plus <strong>Docker Compose</strong>. RunHQ
        reads <code className="font-mono">package.json</code>,{' '}
        <code className="font-mono">go.mod</code>,<code className="font-mono">Cargo.toml</code>,{' '}
        <code className="font-mono">pyproject.toml</code>,{' '}
        <code className="font-mono">compose.yaml</code> and friends to infer start commands.
      </>
    ),
    aPlain:
      'RunHQ auto-discovers ten runtime families: Node.js, Bun, Deno, Go, Rust, .NET, Python (Poetry, uv, pip), Java (Maven and Gradle), Ruby, PHP, and Docker Compose. It reads package.json, go.mod, Cargo.toml, pyproject.toml, compose.yaml and similar manifests to infer start commands.',
  },
  {
    q: 'How does RunHQ work alongside VSCode, Cursor or JetBrains IDEs?',
    a: (
      <>
        Your editor edits code; RunHQ runs it. The cockpit watches the same workspace your editor
        has open and exposes one-click &ldquo;open in IDE&rdquo; buttons for VSCode, Cursor, Zed,
        Sublime, Xcode, JetBrains and any terminal — picking up where you left off without re-typing
        paths. RunHQ does <em>not</em> replace your editor or its run/debug configurations.
      </>
    ),
    aPlain:
      'RunHQ complements editors like VSCode, Cursor, Zed, Sublime, Xcode and JetBrains. It runs and observes the services your editor is editing, with one-click "open in IDE" buttons for every workspace. RunHQ does not replace editor tasks or debug configurations.',
  },
  {
    q: 'Is RunHQ free? What is the licence?',
    a: (
      <>
        Yes, free and open source under the <strong>MIT licence</strong>. No paid tier today, no
        seat-based pricing, no account walls. The full source lives on{' '}
        <a className="text-accent hover:underline" href="https://github.com/erdembas/runhq">
          github.com/erdembas/runhq
        </a>{' '}
        and every release is signed with the same minisign key the in-app updater verifies.
      </>
    ),
    aPlain:
      'Yes. RunHQ is free and open source under the MIT licence. There is no paid tier, no seat pricing, and no account requirement. The source is on GitHub at github.com/erdembas/runhq and every release is signed.',
  },
  {
    q: 'How heavy is RunHQ on system resources?',
    a: (
      <>
        RunHQ targets <strong>under 100 MB of RAM</strong> idle and ships as a Tauri + Rust native
        binary — the same engine that powers tools like Linear&rsquo;s desktop app and Spacedrive.
        The renderer is React, but every cross-process call is a Rust IPC, not Electron-style
        Node-bridged JS. Cold start to first paint is sub-300 ms on an M-series Mac.
      </>
    ),
    aPlain:
      'RunHQ targets under 100 MB of RAM at idle. It ships as a Tauri and Rust native binary, with a React renderer over Rust IPC. Cold start to first paint is under 300 milliseconds on Apple Silicon.',
  },
];

function buildFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, aPlain }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: aPlain,
      },
    })),
  };
}

export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="border-border/60 border-t bg-[rgb(var(--surface-muted)/0.4)] py-24"
    >
      {/* JSON-LD: paired with the visible `<details>` blocks below.
          `aPlain` mirrors `a` so the schema text matches what the
          crawler reads in the DOM — Google's rich-result audit
          rejects pages where the structured-data answer doesn't
          appear in the visible page. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd()) }}
      />

      <div className="mx-auto max-w-4xl px-6">
        <div className="flex flex-col gap-3">
          <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
            FAQ · Developer questions
          </span>
          <h2
            id="faq-heading"
            className="text-fg max-w-3xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
          >
            Questions developers ask before they install.
          </h2>
          <p className="text-fg-muted max-w-2xl text-[15px] leading-relaxed">
            Eight straight answers about runtimes, privacy, licence, IDE adjacency and how RunHQ
            sits next to the tools you already use.
          </p>
        </div>

        <ul className="mt-10 flex flex-col gap-2.5">
          {FAQ_ITEMS.map((item, idx) => (
            <li key={item.q}>
              <details className="group border-border bg-surface hover:border-accent/30 open:border-accent/40 open:bg-surface-overlay/60 rounded-2xl border transition">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
                  <span className="bg-surface-muted text-fg-dim group-open:bg-accent/15 group-open:text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] tabular-nums transition">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-fg text-[15px] leading-tight font-semibold">{item.q}</span>
                  <ChevronDown className="text-fg-muted ml-auto h-4 w-4 shrink-0 transition group-open:rotate-180" />
                </summary>
                <div className="text-fg-muted border-border/60 border-t px-5 py-4 text-[14px] leading-relaxed">
                  <div className="mb-2 flex items-center gap-1.5">
                    <StatusDot status="running" size="xs" />
                    <span className="text-fg-dim font-mono text-[10px] tracking-wider uppercase">
                      Answer
                    </span>
                  </div>
                  {item.a}
                </div>
              </details>
            </li>
          ))}
        </ul>

        <p className="text-fg-muted mt-8 text-center text-[13px]">
          Got a question that isn&rsquo;t here?{' '}
          <a
            className="text-accent hover:underline"
            href="https://github.com/erdembas/runhq/discussions"
          >
            Open a discussion on GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}
