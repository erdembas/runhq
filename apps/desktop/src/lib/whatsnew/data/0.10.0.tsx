import { Callout, InlineMedia, KbdChip, SettingChip } from '@/components/whatsnew/inline';
import type { DocumentRelease } from '../types';

export const release_0_10_0: DocumentRelease = {
  kind: 'document',
  version: '0.10.0',
  releasedAt: '2026-04-30',
  headline:
    'Per-project context lands inside every service — and the terminal stack finally takes a punch.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md#0100',

  intro: (
    <>
      <p>
        Welcome to RunHQ 0.10.0. Two threads weave through this chapter. The first puts{' '}
        <strong>per-project context</strong> inside every service: a private Monaco notebook that
        never leaves your machine, a read-only twin that renders your repo&apos;s committed{' '}
        <code>README</code> + <code>docs/</code>, and a license scanner that finally treats GPL/AGPL
        contamination as a first-class risk. The second <strong>hardens the terminal stack</strong>{' '}
        — logs and the integrated shell now share one xterm.js engine, <KbdChip>Cmd/Ctrl+F</KbdChip>{' '}
        works across both, Windows <em>actually</em> kills the entire descendant tree on Stop, and
        the prompt looks the way your dotfiles ask it to.
      </p>
    </>
  ),

  hooks: [
    {
      href: '#project-notes',
      label: 'Project Notes',
      detail: 'private Monaco notebook, never leaves your machine, auto-threaded into Ask AI',
    },
    {
      href: '#project-docs-tab',
      label: 'Project Docs tab',
      detail: "read-only twin of your repo's committed README + docs/, with guarded one-click Run",
    },
    {
      href: '#license-scanner',
      label: 'License Scanner',
      detail: 'dashboard chips, workspace "Scan all" sweep, AI contamination triage',
    },
    {
      href: '#log-panel-xterm',
      label: 'LogPanel on xterm.js',
      detail: 'logs + shell on one engine, native-rate streaming, ANSI stays crisp under load',
    },
    {
      href: '#terminal-search',
      label: 'Cmd/Ctrl+F search',
      detail: 'browser-style search across logs + terminal, selection auto-fills the query',
    },
  ],

  sections: [
    {
      id: 'per-project-context',
      title: 'Per-project context',
      subsections: [
        {
          id: 'project-notes',
          title: 'Project Notes',
          badge: 'new',
          body: (
            <>
              <p>
                Every service now ships a <strong>NOTES</strong> tab next to LOGS — a private
                Markdown notebook stored locally under{' '}
                <SettingChip name="$RUNHQ_HOME/notes/<service-id>/" prefix="Path" />, never
                committed to your repo and never synced anywhere. A persistent{' '}
                <strong>🔒 Local</strong> chip in the toolbar makes the privacy story impossible to
                miss.
              </p>

              <Callout tone="tip" title="Why a notebook, not just a single note">
                A multi-note sidebar (Docs-tab style) lets you keep <em>Deployment</em>,{' '}
                <em>On-call</em>, <em>Index</em>, and as many other notes as a project deserves. New
                file, rename, delete, and TOC-based navigation all live in the left rail.
              </Callout>

              <p>
                The editor is Monaco, with first-class Markdown shortcuts: <KbdChip>⌘B</KbdChip>{' '}
                bolds the selection, <KbdChip>⌘I</KbdChip> italicises, <KbdChip>⌘K</KbdChip> wraps a
                link, and <KbdChip>⌘⇧H</KbdChip> cycles heading levels. A built-in cheatsheet
                popover is one keystroke away. Preview mode offers a <strong>wide-layout</strong>{' '}
                toggle (persisted across sessions) and a sticky table-of-contents that scroll-spies
                whichever heading you&apos;re reading.
              </p>

              <InlineMedia
                src="https://cdn.runhq.dev/whatsnew/0.10.0/project-notes.webm"
                kind="video"
                alt='Service NOTES tab: left sidebar lists three notes (Deployment, On-call, Index) with relative timestamps and a persistent "🔒 Local" chip in the toolbar; the user clicks "Deployment", types a few lines in Monaco with markdown highlighting, hits ⌘B on a phrase to bold it, switches to Preview, toggles wide layout, the right-side TOC tracks scroll, then opens AI Chat and asks "what runs after seed?" — the model quotes the just-typed note in its first sentence.'
                caption="Multi-note sidebar, Monaco editor with ⌘B / ⌘I / ⌘K / ⌘⇧H, GFM Preview with sticky TOC + wide toggle, and Ask AI quoting a freshly-typed note."
              />

              <p>
                The killer feature is the AI Chat panel reading your <em>whole</em> notebook
                automatically. A note like &quot;after seed, run <code>prisma migrate deploy</code>
                &quot; is what the model quotes back the next time you ask why your API is 500-ing.
                Notes are concatenated with <code>## &lt;title&gt;</code> separators and threaded
                into the chat&apos;s system context — no &quot;AI memory&quot; menu, no copy-paste.
              </p>

              <Callout tone="note">
                Existing single-file notes from 0.9.x auto-migrate into <code>index.md</code> on
                first launch — your prior content is preserved verbatim, just relocated into the new
                directory layout.
              </Callout>
            </>
          ),
        },

        {
          id: 'project-docs-tab',
          title: 'Project Docs tab',
          badge: 'new',
          body: (
            <>
              <p>
                If <strong>NOTES</strong> is what <em>you</em> think about a project,{' '}
                <strong>DOCS</strong> is what the project says about itself. The new tab renders
                your repo&apos;s committed <code>README.md</code>, <code>CHANGELOG.md</code>, and
                the entire <code>docs/</code> folder as Markdown — same GFM tables and code
                highlighting as Notes, sticky TOC, deep- linkable headings.
              </p>

              <p>
                Every fenced shell block gets a <strong>copy</strong> button and, when the command
                is recognised, a <strong>Run</strong> pill that drops it straight into the
                integrated terminal. The runner is allow-listed (<code>npm</code>, <code>pnpm</code>
                , <code>yarn</code>, <code>bun</code>, <code>cargo</code>, <code>go</code>,{' '}
                <code>python</code>, <code>docker</code>, …) and refuses pipes, shell redirects,
                multi-line strings, and anything that looks like <code>sudo rm -rf</code>.
              </p>

              <Callout tone="warning" title="A README cannot one-click pwn you">
                The Run guard explicitly rejects pipes (<code>|</code>), redirects (
                <code>&gt;</code>, <code>&gt;&gt;</code>), command chaining (<code>&amp;&amp;</code>
                , <code>;</code>), and any binary outside the allow-list. A malicious README
                can&apos;t talk RunHQ into running <code>curl … | bash</code> on your behalf — the
                worst it can do is offer a copy button.
              </Callout>

              <p>
                For freshly-cloned services with no logs yet, the panel opens straight into DOCS
                instead of an empty LOGS pane. First click on a service = actually-useful content.
              </p>
            </>
          ),
        },

        {
          id: 'license-scanner',
          title: 'License & Compliance Scanner',
          badge: 'new',
          body: (
            <>
              <p>
                License risk is now first-class. Every dashboard card carries a license chip
                alongside the existing CVE / outdated chips, a workspace{' '}
                <strong>&quot;Scan all&quot;</strong> button sweeps every supported project in one
                click, and the per-service License panel classifies every dependency into seven
                tiers — <strong>safe</strong>, <strong>permissive</strong>, weak / mid / strong{' '}
                <strong>copyleft</strong>, <strong>proprietary</strong>, and{' '}
                <strong>inconclusive</strong>.
              </p>

              <p>
                When a GPL/AGPL package contaminates a permissive release, you find out{' '}
                <em>before</em> shipping. A Sparkles button next to every contamination row streams
                a plain-English AI triage covering the obligation (&quot;source-available, not
                redistribution-friendly&quot;), the distribution model (binary vs. SaaS vs.
                internal), and the fix order. The same Sparkles lives in the panel header for a
                full-warnings rollup.
              </p>

              <Callout tone="success" title="Why this changes how you ship">
                License risk feeds the project <code>riskScore</code> at{' '}
                <strong>higher priority</strong> than CVE or outdated, so a copyleft contamination
                outranks a stale dependency in the &quot;Worst Offenders&quot; ranking. A single
                click exports a fully-attributed{' '}
                <SettingChip name="THIRD-PARTY-NOTICES.md" prefix="Output" /> that&apos;s ready to
                ship inside your release artefact.
              </Callout>

              <Callout tone="note" title="Honest about coverage">
                Node and Rust ecosystems get full classification; Go is best-effort (resolves what{' '}
                <code>go list -m all</code> can reach); Python is explicitly unsupported and
                surfaces as &quot;inconclusive&quot; rather than pretending.
              </Callout>
            </>
          ),
        },
      ],
    },

    {
      id: 'terminal-stack-hardening',
      title: 'Terminal stack hardening',
      subsections: [
        {
          id: 'log-panel-xterm',
          title: 'LogPanel on xterm.js',
          badge: 'improved',
          body: (
            <>
              <p>
                Logs and the integrated terminal now share <strong>one engine</strong>. Both render
                through xterm.js (WebGL fast path, Canvas fallback), both use the same ANSI parser,
                both wire into a single search addon. The previous <code>react-virtual</code> log
                list leaves the bundle entirely.
              </p>

              <p>
                Underneath, every PTY now owns a per-instance{' '}
                <code>Channel&lt;TerminalOutput&gt;</code> instead of fanning out through a global
                event bus, and a Rust-side reader→flusher coalescer (<strong>8 ms</strong> /{' '}
                <strong>32 KB</strong> windows) drops the wire size from <code>~3-4×</code> the raw
                PTY bytes down to <code>~1.33×</code>. Net effect on mid-tier hardware: a{' '}
                <code>cargo build</code> or <code>vite dev</code> that used to peg a CPU core in the
                webview just on deserialisation now streams at native rate, ANSI colours stay crisp
                under load, and the log buffer reconciles in place (append fast path + ring-buffer
                tail) instead of re-mounting.
              </p>

              <Callout tone="success" title="What you actually feel">
                <code>cargo build</code>, <code>vite dev</code>, <code>docker pull</code>, and
                anything else that floods stdout no longer hangs the UI. Right-click on a log line
                still maps back to the original{' '}
                <SettingChip name="IMarker → LogLine" prefix="Type" /> so the existing context menu
                works exactly as before.
              </Callout>
            </>
          ),
        },

        {
          id: 'terminal-search',
          title: 'Cmd/Ctrl+F across panes',
          badge: 'new',
          body: (
            <>
              <p>
                <KbdChip>Cmd/Ctrl+F</KbdChip> now opens a browser-style search bar across{' '}
                <strong>both</strong> the integrated terminal and the migrated log view. Live
                accent-coloured match decorations on every visible hit, an <strong>N/M</strong>{' '}
                counter, <KbdChip>Enter</KbdChip> / <KbdChip>Shift+Enter</KbdChip> walks results,{' '}
                <KbdChip>Esc</KbdChip> dismisses. Selecting text first auto-fills the query — same
                muscle memory as Chrome and VS Code.
              </p>

              <Callout tone="note">
                Log search runs against the rendered ANSI buffer, so matches inside coloured spans
                get highlighted correctly — something the old <code>react-virtual</code> list simply
                couldn&apos;t do.
              </Callout>
            </>
          ),
        },

        {
          id: 'windows-tree-kill',
          title: 'Windows tree-kill',
          badge: 'fix',
          body: (
            <>
              <p>
                Stop on Windows now kills the <strong>entire descendant tree</strong>. The
                supervisor wraps every spawned child in a Job Object configured with{' '}
                <SettingChip name="JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE" prefix="Flag" />, so dropping
                the handle on Stop synchronously terminates{' '}
                <code>node.exe → esbuild.exe → workers</code> in one kernel call — no PID-tree
                walking, no leftover processes haunting Task Manager.
              </p>

              <Callout tone="success" title='No more "Stop succeeded but :3000 is still occupied"'>
                The most common Windows failure mode (a service&apos;s child dev server surviving
                its parent <code>pnpm</code>) is now structurally impossible. Job Objects are an
                OS-level mechanism, not a heuristic.
              </Callout>

              <p>
                Unix paths are unchanged — they continue using <code>setsid</code> +{' '}
                <code>killpg</code> via a zero-cost shim, so call sites avoid platform sprawl.
                EDR-tolerant best-effort: if Job Object creation fails (some endpoint protection
                products block it), RunHQ logs the failure and continues; the worst case degrades to
                the old behaviour, never blocks service start.
              </p>
            </>
          ),
        },

        {
          id: 'login-shell-matrix',
          title: 'Login-shell defaults',
          badge: 'improved',
          body: (
            <>
              <p>
                Spawn a terminal pane and the prompt now looks <em>exactly</em> like the system
                terminal you already configured. The previous &quot;<code>-l</code> everywhere&quot;
                default was silently bash-hostile — your <code>.bashrc</code> wouldn&apos;t load,{' '}
                <code>nvm</code> / <code>asdf</code> / <code>rbenv</code> shims were missing, theme
                and aliases lived only in the <em>second</em> command. This is the right matrix:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
                <li>
                  <KbdChip>bash</KbdChip> · <KbdChip>zsh</KbdChip> · <KbdChip>fish</KbdChip> ·
                  unknown shells → <code>-i -l</code> so rc files actually load
                </li>
                <li>
                  <KbdChip>sh</KbdChip> · <KbdChip>dash</KbdChip> · <KbdChip>ash</KbdChip> →{' '}
                  <code>-l</code> only (their <code>-i</code> semantics aren&apos;t portable)
                </li>
                <li>
                  <KbdChip>pwsh</KbdChip> · <KbdChip>powershell</KbdChip> → <code>-NoLogo</code>,
                  banner stays out of the way
                </li>
                <li>
                  <KbdChip>cmd.exe</KbdChip> → no flags, matches user expectation
                </li>
              </ul>

              <p>
                Your dotfiles, <code>nvm</code> / <code>asdf</code> / <code>rbenv</code> shims,
                theme, and aliases all live on the very first command — no warm-up shell needed.
              </p>
            </>
          ),
        },

        {
          id: 'terminal-polish',
          title: 'Terminal polish bundle',
          badge: 'improved',
          body: (
            <>
              <p>
                Four small fixes that together close the day-one rough spots in the new terminal —
                drag-resize coalescing, inline spawn errors, system-browser link routing, and a
                two-track theme policy:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li>
                  <strong>rAF-coalesced resize</strong> — drag-resizing a pane fires at most one PTY{' '}
                  <code>resize</code> per repaint, so the supervisor doesn&apos;t drown in dimension
                  updates while you&apos;re still moving the splitter.
                </li>
                <li>
                  <strong>Inline spawn-error banner</strong> — a failed <code>terminal_create</code>{' '}
                  now shows a red banner inline instead of leaving you staring at a silent black
                  pane.
                </li>
                <li>
                  <strong>Web links → system browser</strong> — clicking <code>https://…</code> in
                  your logs opens the system browser via{' '}
                  <SettingChip name="ipc.openUrl" prefix="API" />, never the Tauri webview itself
                  (which would replace the entire app UI).
                </li>
                <li>
                  <strong>Two-track theme policy</strong> — log views follow app mode (
                  <code>xtermTheme(isDark)</code>); the integrated shell stays{' '}
                  <strong>pinned dark</strong> via <code>xtermShellSurfaceTheme()</code>, same
                  convention as VS Code, iTerm, Hyper, and Alacritty.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
  ],
};
