import { Callout, KbdChip, SettingChip } from '@/components/whatsnew/inline';
import type { ReleaseSection } from '../../types';

export const workspaceAndTerminalSections: ReleaseSection[] = [
  {
    id: 'workspace-pane-system',
    title: 'Workspace pane system',
    subsections: [
      {
        id: 'workspace-layout',
        title: 'Recursive split layout with tab drag & drop',
        badge: 'new',
        body: (
          <>
            <p>
              Every service panel is now a <strong>recursive split layout</strong> à la VS Code.
              Inside one service you can:
            </p>
            <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>Drag a tab</strong> within its strip to reorder, or onto another pane to
                hand it over.
              </li>
              <li>
                <strong>Drag onto a pane&apos;s edge</strong> (top / right / bottom / left,
                highlighted with an accent overlay during the drag) to split the pane in that
                direction. The dragged tab lands in the new sibling pane, the original keeps the
                rest.
              </li>
              <li>
                <strong>Drag the divider</strong> to rebalance the split. The handle reads at 2 px
                by default, grows to 4 px on hover with an accent fill so you don&apos;t have to
                hunt for the seam.
              </li>
              <li>
                Empty panes self-heal — closing the last tab in a split-off group offers a single
                &quot;start a new terminal&quot; CTA, and a pane that ends up empty on both sides
                collapses back into its parent automatically.
              </li>
            </ul>

            <Callout tone="tip" title="Tabs survive every move">
              Bodies (terminal PTYs, log buffers, Notes / Docs renderers) are mounted once per tab
              and portaled into whichever pane currently owns the tab. Dragging a Terminal across
              the layout never kills its PTY or scrollback — the React subtree stays put, only the
              DOM target swaps.
            </Callout>

            <p>
              Layout is <strong>per-service persisted</strong> via{' '}
              <SettingChip name="runhq:layout:v1:<service-id>" prefix="LocalStorage" /> with a 250
              ms debounced save. The root pane&apos;s tab strip carries a small{' '}
              <strong>Reset</strong> action that wipes the saved layout and snaps you back to a
              single-pane default — useful when you&apos;ve over-split and want a fresh start.
            </p>
          </>
        ),
      },

      {
        id: 'multi-terminal',
        title: 'Multi-terminal per service',
        badge: 'new',
        body: (
          <>
            <p>
              Each service can host as many terminals as you need. Every pane&apos;s tab strip ends
              with a captioned <strong>+ New Terminal</strong> button (the root pane also gets a{' '}
              <strong>↻ Reset Layout</strong> action right next to it) that spawns a fresh terminal
              in that pane. Each new terminal gets a sequential default label (&quot;Terminal
              1&quot;, &quot;Terminal 2&quot;, …) — the counter never recycles, so a label
              you&apos;re reading right now won&apos;t silently change underneath you. Prefer the
              keyboard? <KbdChip>Cmd</KbdChip> + <KbdChip>`</KbdChip> spawns a new terminal in the
              active service via the new shortcut catalogue.
            </p>

            <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>Double-click a tab title</strong> to rename it inline (≤ 40 chars).{' '}
                <KbdChip>Enter</KbdChip> commits, <KbdChip>Esc</KbdChip> cancels.
              </li>
              <li>
                <strong>Close (×) on a terminal tab</strong> destroys the PTY immediately —
                &quot;close means close&quot;, not &quot;hide and let the shell linger&quot;.
              </li>
              <li>
                <strong>Logs / Docs / Notes</strong> remain singletons per service and aren&apos;t
                closeable; their X is suppressed even if you somehow drag-drop them onto a pane with
                no other tabs.
              </li>
              <li>
                Quick-action &quot;Open Terminal&quot; deep-links and the docs <strong>Run</strong>{' '}
                button both route through a unified{' '}
                <SettingChip name="ensureTerminal()" prefix="API" /> shim — they reuse an existing
                terminal in your preferred pane if one exists, otherwise spawn a fresh one.
              </li>
              <li>
                The standalone <strong>Terminal</strong> button in the LogPanel toolbar is{' '}
                <strong>gone</strong> — the &quot;+ New Terminal&quot; affordance lives in every
                pane&apos;s tab strip now and the <KbdChip>Cmd</KbdChip> + <KbdChip>`</KbdChip>{' '}
                shortcut covers the keyboard path, so the toolbar pill was just visual noise.
              </li>
            </ul>
          </>
        ),
      },

      {
        id: 'focus-tier',
        title: 'Focus-aware tab styling',
        badge: 'improved',
        body: (
          <>
            <p>
              When you have three terminals visible across two splits, &quot;which one is going to
              eat my next keystroke&quot; matters. Tab styling now answers it at a glance with three
              tiers:
            </p>

            <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>Bright accent fill + accent top bar</strong> — the active tab in the pane
                that currently owns keyboard focus. This is where typing lands.
              </li>
              <li>
                <strong>Sade muted fill + faded top bar</strong> — a terminal that&apos;s active in
                some background pane. Still rendered on its body, just not receiving input.
              </li>
              <li>
                <strong>Dim flat</strong> — every other inactive tab.
              </li>
            </ul>

            <Callout tone="note" title="Logs / Docs / Notes never dim">
              The focus tier only applies to terminal tabs — they&apos;re the only kind whose body
              consumes keystrokes. Log / Docs / Notes tabs render at the bright tier whenever active
              so a click into a sibling terminal doesn&apos;t make them feel accidentally disabled.
            </Callout>

            <p>
              Pane focus is tracked via both <code>focusin</code> events (xterm grabs focus on click
              via its hidden textarea) and capture-phase <code>pointerdown</code> (catches clicks on
              read-only panes like the Notes preview that have no focusable element). Either signal
              is enough to repaint the active tab in its proper tier.
            </p>
          </>
        ),
      },
    ],
  },

  {
    id: 'terminal-reliability',
    title: 'Terminal reliability',
    subsections: [
      {
        id: 'opencode-fix',
        title: 'opencode + every DECRQM-using TUI now renders in production',
        badge: 'fix',
        body: (
          <>
            <p>
              The most painful bug of the cycle: in production builds only, the integrated terminal
              would open <code>opencode</code> (or <code>claude-code</code>, <code>gemini</code>,
              anything using <code>cli-spinners</code> v3+ or an alternate screen TUI), paint a few
              bytes, then go blank. Dev mode worked. macOS, Windows, and Linux all hit it.{' '}
              <code>top</code> and <code>vim</code> were unaffected. The console showed{' '}
              <code>ReferenceError: &lt;mangled&gt; is not defined</code> from inside xterm&apos;s{' '}
              <code>requestMode</code> handler.
            </p>

            <p>
              Root cause: xterm.js v6.0.0 ships its ESM <em>already minified</em>. esbuild&apos;s
              identifier-mangling pass mishandles a closure capture inside{' '}
              <code>InputHandler.requestMode</code> when re-minifying the file — the inner arrow
              function ends up referencing a parameter name that no longer exists in the outer
              scope. The first DEC private mode query (<code>CSI ?2026 $p</code>, used by every
              modern TUI to probe for synchronized-output support) throws, the DCS handler chain
              dies, and every subsequent <code>write()</code> is silently dropped.
            </p>

            <Callout tone="success" title="The fix is one line, backed by a doc">
              <code>apps/desktop/vite.config.ts</code> now ships{' '}
              <code>build.minify: &apos;terser&apos;</code>. Terser does proper AST scope tracking
              and handles the file correctly. The whole investigation, the rejected workarounds (the
              obvious{' '}
              <code>
                esbuild: {'{'} minifyIdentifiers: false {'}'}
              </code>{' '}
              doesn&apos;t reach Vite&apos;s build pass), and the criteria for removing the
              workaround live in <SettingChip name="docs/KNOWN_ISSUES.md" prefix="Doc" />.
            </Callout>

            <p>
              Cost: <strong>~+160 KB gzipped</strong> on the main chunk vs. the broken esbuild
              output, ~+2 s on build time. Webview load is unaffected (Tauri serves assets from
              local disk). Worth every byte.
            </p>
          </>
        ),
      },

      {
        id: 'pane-pointer-gating',
        title: 'Pane drop overlays no longer steal clicks',
        badge: 'fix',
        body: (
          <>
            <p>
              A regression caught between the layout system landing and 0.10.3 ship: with multiple
              terminals visible, clicking on one wouldn&apos;t move keyboard focus into its xterm —
              every click was being absorbed by the pane&apos;s own drag-drop edge overlay. The drop
              targets are mounted full-time so dnd-kit&apos;s collision detection has somewhere to
              land, but they were also <code>pointer-events: auto</code> full-time, so they sat
              above the body and ate clicks meant for the terminal.
            </p>

            <p>
              Fix: edge + center drop targets are now <code>pointer-events: none</code> while no
              drag is in progress. The refs stay mounted (collision detection only needs{' '}
              <code>getBoundingClientRect()</code>, not pointer events), and the moment a drag
              actually starts, the pointer flip happens automatically. Net effect: clicks reach the
              terminal as expected, drag highlights still work the moment you lift a tab.
            </p>
          </>
        ),
      },
    ],
  },
];
