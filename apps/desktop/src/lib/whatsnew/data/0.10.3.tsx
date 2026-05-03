/**
 * RunHQ 0.10.3 release highlights — document-style.
 *
 * This is the omnibus follow-up to 0.10.0. The two intermediate
 * tags (0.10.1 + 0.10.2) shipped distribution / docs fixes only —
 * no release-notes modal — so 0.10.3 rolls up everything since
 * 0.10.0 actually visible to the user:
 *
 *   • **Workspace layout** — every service panel is now a VS Code-
 *     style recursive split layout: drag a tab between panes, drag
 *     onto a pane edge to split, resize the divider, multi-terminal
 *     per service with rename/close, focused-pane visual tier.
 *     Layout is per-service-persisted with a Reset affordance.
 *
 *   • **Settings hub + shortcuts** — the legacy Shortcut Settings
 *     dialog is replaced by a full-page Settings hub (Shortcuts,
 *     AI, Data & Cache, About, Danger Zone). The Shortcuts
 *     catalogue grew from 2 entries to 9 with proper Global / View
 *     / Tabs scopes and live conflict detection. Status bar is
 *     re-wired so the AI chip deep-links into the page instead of
 *     popping a modal.
 *
 *   • **Dashboard organisation** — `hide_dashboard` flag puts
 *     workspace-only services out of sight without losing them, the
 *     filter bar is consolidated into a single top row (Attention +
 *     Git dropdowns sit alongside Search / Hidden / Group / Sort
 *     with prefixed labels), and card overflow menus render through
 *     a portal (no clipping inside the card, single-instance
 *     enforcement).
 *
 *   • **Terminal reliability** — the long-standing "opencode runs
 *     in dev but blanks in prod" bug is FIXED at the bundler
 *     level: Vite now uses `terser` because esbuild's identifier
 *     mangler corrupts xterm.js v6's `requestMode` closure. Every
 *     DECRQM-using TUI (opencode, claude-code, gemini, anything
 *     using cli-spinners v3+) now works in production builds.
 *
 *   • **Distribution & install** — macOS Developer ID notarization,
 *     ARM64 builds, OS/arch auto-detect on the landing page,
 *     version-less Linux asset aliases. Linux + manual installs
 *     hand off cleanly to GitHub Releases instead of pretending
 *     the desktop installer covers them.
 *
 * Asset hosting:
 *
 *   • No `<InlineMedia>` clips this release — every subsection
 *     tells its story in prose + chips + callouts. Captures take
 *     longer than they save when the change set is this UI-heavy
 *     (a thirty-second clip would have to fit drag, split,
 *     rename, focus tier, and a dashboard chip rearrangement
 *     into one frame). Future patch releases can layer a clip in
 *     for the workspace-layout headliner if reader feedback asks
 *     for one.
 */
import { Callout, KbdChip, SettingChip } from '@/components/whatsnew/inline';
import type { DocumentRelease } from '../types';

export const release_0_10_3: DocumentRelease = {
  kind: 'document',
  version: '0.10.3',
  releasedAt: '2026-05-03',
  headline:
    'Recursive split panes, a real Settings hub with nine keyboard shortcuts, opencode finally renders in production, and the dashboard learns to hide what you only watch.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md#0103',

  intro: (
    <>
      <p>
        Welcome to RunHQ 0.10.3. The headline change reaches into every service panel:{' '}
        <strong>recursive split layout with tab drag-and-drop</strong>, multi-terminal per service,
        and a clear visual tier for &quot;which terminal will eat my next keystroke&quot;. The
        terminal stack also closes the most-cursed bug of the cycle — <code>opencode</code> /
        <code>claude-code</code> / any TUI that probes synchronized-output support — by switching
        the production minifier to <strong>terser</strong>. Configurability gets a real home: the
        legacy shortcut dialog is gone, replaced by a <strong>full-page Settings hub</strong> with
        five categories and a shortcuts catalogue that grew from 2 entries to <strong>9</strong>{' '}
        (sidebar / AI panel / Activity panel toggles, new-terminal, main-tab navigation, and live
        conflict detection). The dashboard learns to <strong>hide</strong> services you only keep
        around for workspace context, the filter bar is rebuilt to feel like one control instead of
        seven, and the install pipeline gets ARM64 builds, macOS notarization, and OS-aware download
        links on the landing page. 0.10.1 and 0.10.2 were docs / distribution fixes with no modal of
        their own — everything between 0.10.0 and today is rolled up here.
      </p>
    </>
  ),

  hooks: [
    {
      href: '#workspace-layout',
      label: 'Workspace layout',
      detail: 'recursive split panes, tab drag & drop, per-service persistence, Reset to default',
    },
    {
      href: '#multi-terminal',
      label: 'Multi-terminal per service',
      detail: '"+ New" in any pane, double-click rename, close kills the PTY',
    },
    {
      href: '#focus-tier',
      label: 'Focus-aware tab styling',
      detail: 'three tiers so you always know which terminal will eat your next keystroke',
    },
    {
      href: '#opencode-fix',
      label: 'opencode unblocks',
      detail: 'switched Vite to terser; xterm.js v6 minify bug stops eating DECRQM TUIs',
    },
    {
      href: '#settings-hub',
      label: 'Full-page Settings hub',
      detail: 'replaces the modal — Shortcuts, AI, Data, About, Danger Zone in one place',
    },
    {
      href: '#settings-as-tabs',
      label: 'Settings & Release Notes as tabs',
      detail: 'no more overlay freeze on return; right side panels now slide instead of snap',
    },
    {
      href: '#shortcuts-catalogue',
      label: 'Nine keyboard shortcuts',
      detail: 'sidebar / AI / Activity toggles, new-terminal, main-tab navigation, conflicts',
    },
    {
      href: '#hide-from-dashboard',
      label: 'Hide from dashboard',
      detail: 'workspace-only services move out of sight without losing traceability',
    },
    {
      href: '#dashboard-polish',
      label: 'Dashboard organisation',
      detail: 'consolidated filter bar, portal-based card menu, single-open enforcement',
    },
    {
      href: '#install-distribution',
      label: 'Install & distribution',
      detail: 'macOS notarization, ARM64 builds, OS/arch detection on the landing page',
    },
  ],

  sections: [
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
                Each service can host as many terminals as you need. Every pane&apos;s tab strip
                ends with a captioned <strong>+ New Terminal</strong> button (the root pane also
                gets a <strong>↻ Reset Layout</strong> action right next to it) that spawns a fresh
                terminal in that pane. Each new terminal gets a sequential default label
                (&quot;Terminal 1&quot;, &quot;Terminal 2&quot;, …) — the counter never recycles, so
                a label you&apos;re reading right now won&apos;t silently change underneath you.
                Prefer the keyboard? <KbdChip>Cmd</KbdChip> + <KbdChip>`</KbdChip> spawns a new
                terminal in the active service via the new shortcut catalogue.
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
                  closeable; their X is suppressed even if you somehow drag-drop them onto a pane
                  with no other tabs.
                </li>
                <li>
                  Quick-action &quot;Open Terminal&quot; deep-links and the docs{' '}
                  <strong>Run</strong> button both route through a unified{' '}
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
                eat my next keystroke&quot; matters. Tab styling now answers it at a glance with
                three tiers:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
                <li>
                  <strong>Bright accent fill + accent top bar</strong> — the active tab in the pane
                  that currently owns keyboard focus. This is where typing lands.
                </li>
                <li>
                  <strong>Sade muted fill + faded top bar</strong> — a terminal that&apos;s active
                  in some background pane. Still rendered on its body, just not receiving input.
                </li>
                <li>
                  <strong>Dim flat</strong> — every other inactive tab.
                </li>
              </ul>

              <Callout tone="note" title="Logs / Docs / Notes never dim">
                The focus tier only applies to terminal tabs — they&apos;re the only kind whose body
                consumes keystrokes. Log / Docs / Notes tabs render at the bright tier whenever
                active so a click into a sibling terminal doesn&apos;t make them feel accidentally
                disabled.
              </Callout>

              <p>
                Pane focus is tracked via both <code>focusin</code> events (xterm grabs focus on
                click via its hidden textarea) and capture-phase <code>pointerdown</code> (catches
                clicks on read-only panes like the Notes preview that have no focusable element).
                Either signal is enough to repaint the active tab in its proper tier.
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
                The most painful bug of the cycle: in production builds only, the integrated
                terminal would open <code>opencode</code> (or <code>claude-code</code>,{' '}
                <code>gemini</code>, anything using <code>cli-spinners</code> v3+ or an alternate
                screen TUI), paint a few bytes, then go blank. Dev mode worked. macOS, Windows, and
                Linux all hit it. <code>top</code> and <code>vim</code> were unaffected. The console
                showed <code>ReferenceError: &lt;mangled&gt; is not defined</code> from inside
                xterm&apos;s <code>requestMode</code> handler.
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
                and handles the file correctly. The whole investigation, the rejected workarounds
                (the obvious{' '}
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
                terminals visible, clicking on one wouldn&apos;t move keyboard focus into its xterm
                — every click was being absorbed by the pane&apos;s own drag-drop edge overlay. The
                drop targets are mounted full-time so dnd-kit&apos;s collision detection has
                somewhere to land, but they were also <code>pointer-events: auto</code> full-time,
                so they sat above the body and ate clicks meant for the terminal.
              </p>

              <p>
                Fix: edge + center drop targets are now <code>pointer-events: none</code> while no
                drag is in progress. The refs stay mounted (collision detection only needs{' '}
                <code>getBoundingClientRect()</code>, not pointer events), and the moment a drag
                actually starts, the pointer flip happens automatically. Net effect: clicks reach
                the terminal as expected, drag highlights still work the moment you lift a tab.
              </p>
            </>
          ),
        },
      ],
    },

    {
      id: 'configurability',
      title: 'Configurability',
      subsections: [
        {
          id: 'settings-hub',
          title: 'Full-page Settings hub',
          badge: 'new',
          body: (
            <>
              <p>
                The legacy &quot;Shortcut Settings&quot; modal is gone. In its place lives a{' '}
                <strong>full-page Settings hub</strong> styled after VS Code / Cursor: a category
                sidebar on the left, a scrollable content pane on the right, mounted on the main
                canvas like Release Notes (no overlay dimming the workspace behind it). Five
                categories ship today:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
                <li>
                  <strong>Keyboard Shortcuts</strong> — the new comprehensive catalogue (see next
                  subsection).
                </li>
                <li>
                  <strong>AI Providers</strong> — the full provider CRUD (add / edit / remove /
                  test, language pickers, default-marking) is rendered <strong>inline</strong> on
                  this page. No more modal hop, no more &quot;Manage providers&quot; launcher
                  button. Every entry point that used to open the legacy dialog (status-bar AI chip,
                  chat composer model picker &quot;Manage&quot;, model chooser popover,
                  release-notes CTA) now deep-links straight to this page.
                </li>
                <li>
                  <strong>Data &amp; Cache</strong> — dependency-scan history with a one-shot reset,
                  plus the on-disk state directory path (handy before backups).
                </li>
                <li>
                  <strong>About &amp; Updates</strong> — app version, latest release version,
                  &quot;What&apos;s new&quot; / Release Notes shortcuts, and a{' '}
                  <strong>Replay welcome tour</strong> entry point.
                </li>
                <li>
                  <strong>Danger Zone</strong> — destructive operations (full workspace reset)
                  isolated on their own page behind a red-bordered warning banner so they can&apos;t
                  be mistaken for everyday preferences.
                </li>
              </ul>

              <Callout tone="tip" title="Status bar re-shuffle">
                The status-bar &quot;shortcuts&quot; chip is now <strong>Settings</strong> (cog
                icon) and opens the hub at its default category. The <strong>AI</strong> chip opens
                the hub at the AI category instead of a modal. Two clicks down to one for both.
              </Callout>

              <p>
                Each category lives inside a shared{' '}
                <SettingChip name="SettingsPageShell" prefix="Component" /> with optional toolbar /
                footer slots — so &quot;Save &amp; Apply&quot; on Shortcuts sits in a real footer
                strip instead of the half-translucent sticky bar the previous draft used. Adding a
                new category is a single file in <code>components/settings/categories/</code> plus
                an entry in the sidebar array.
              </p>
            </>
          ),
        },

        {
          id: 'settings-as-tabs',
          title: 'Settings & Release Notes are first-class tabs now',
          badge: 'improved',
          body: (
            <>
              <p>
                Earlier in the cycle, opening Settings or Release Notes mounted them as fullscreen
                overlays on top of the workspace — which meant going back to the dashboard
                <em>unmounted the entire main-tab tree</em> (every service tab, every layout, every
                terminal scrollback) and re-rendered it from scratch. With three or four service
                tabs open you could feel the freeze (~200–500 ms of pegged main thread) every time
                you bounced through Settings to tweak a shortcut.
              </p>

              <p>
                Both pages are now <strong>regular main tabs</strong>, opened and closed through the
                same tab-strip controls (X button, middle-click, right-click → Close,{' '}
                <KbdChip>Cmd</KbdChip> + <KbdChip>W</KbdChip>) as any service or stack tab. The
                main-tab tree never unmounts: switching between Dashboard, a service, Settings, and
                Release Notes is instant in either direction. The redundant in-page &quot;Back&quot;
                / &quot;X&quot; buttons that lived in the overlay headers were also removed —
                duplicated chrome once the tab strip owned closing.
              </p>

              <Callout tone="success" title="Smooth side panels too">
                The AI Chat and Activity panels used to vanish abruptly when toggled off (hard
                unmount). They now slide closed with a 200 ms width ease-out — same animation system
                as the left sidebar&apos;s collapse / expand, just on the opposite edge. An
                absolute-anchored inner wrapper keeps the panel content fully laid out during the
                animation, so chat history doesn&apos;t reflow while the aside collapses.
              </Callout>
            </>
          ),
        },

        {
          id: 'shortcuts-catalogue',
          title: 'Nine keyboard shortcuts with conflict detection',
          badge: 'new',
          body: (
            <>
              <p>
                The shortcut catalogue grew from <strong>2 entries to 9</strong>, organised into
                three scopes so the user knows what each one does and when:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li>
                  <strong>Global</strong> (Tauri global-shortcut plugin — fires from anywhere, even
                  when RunHQ is hidden / minimised / behind another app): <KbdChip>Cmd</KbdChip> +{' '}
                  <KbdChip>Shift</KbdChip> + <KbdChip>K</KbdChip> opens the Quick Action Bar;{' '}
                  <KbdChip>Cmd</KbdChip> + <KbdChip>Shift</KbdChip> + <KbdChip>L</KbdChip> brings
                  the main window to the foreground.
                </li>
                <li>
                  <strong>View</strong> (window-level — fires while RunHQ has focus, takes effect
                  immediately on save): <KbdChip>Cmd</KbdChip> + <KbdChip>B</KbdChip> pins / unpins
                  the left sidebar, <KbdChip>Cmd</KbdChip> + <KbdChip>Shift</KbdChip> +{' '}
                  <KbdChip>A</KbdChip> toggles the AI Chat panel, <KbdChip>Cmd</KbdChip> +{' '}
                  <KbdChip>Shift</KbdChip> + <KbdChip>T</KbdChip> toggles the Activity panel, and{' '}
                  <KbdChip>Cmd</KbdChip> + <KbdChip>`</KbdChip> spawns a new terminal in the active
                  service (delegated to the focused service&apos;s LogPanel via a module-level
                  shortcut bus).
                </li>
                <li>
                  <strong>Main tabs</strong>: <KbdChip>Ctrl</KbdChip> + <KbdChip>Tab</KbdChip> /{' '}
                  <KbdChip>Ctrl</KbdChip> + <KbdChip>Shift</KbdChip> + <KbdChip>Tab</KbdChip> cycle
                  forward / back through the top tab strip; <KbdChip>Cmd</KbdChip> +{' '}
                  <KbdChip>W</KbdChip> closes the active tab. The Dashboard tab is sticky and
                  ignores Close so the workspace always has an anchor.
                </li>
              </ul>

              <Callout tone="success" title="Shortcuts work even from input fields">
                Earlier drafts suppressed shortcuts when an input or contenteditable element had
                focus — which meant <KbdChip>Cmd</KbdChip> + <KbdChip>Shift</KbdChip> +{' '}
                <KbdChip>A</KbdChip> opened the AI panel but couldn&apos;t close it again because
                the AI composer snapped focus on open. Bound chords now match regardless of the
                event target; they always require a modifier so plain typing in inputs is never
                intercepted.
              </Callout>

              <Callout tone="note" title="Live conflict detection">
                Two shortcuts mapped to the same chord light up with a <code>status-error</code>{' '}
                ring and Save &amp; Apply is disabled until you fix it. Comparison is on the
                canonical chord form, so <code>Cmd+B</code> and <code>CmdOrCtrl+B</code> count as
                the same binding — no silent same-chord overlap that quietly clobbers half the
                catalogue.
              </Callout>

              <p>
                Defaults migrate forward via <code>#[serde(default)]</code> on every new field, so
                existing config files keep working and just pick up the new bindings on first read.
                Global shortcuts apply after the next restart (they need to be re-registered with
                the OS); window shortcuts apply immediately on save.
              </p>
            </>
          ),
        },
      ],
    },

    {
      id: 'dashboard-organisation',
      title: 'Dashboard organisation',
      subsections: [
        {
          id: 'hide-from-dashboard',
          title: 'Hide-from-dashboard',
          badge: 'new',
          body: (
            <>
              <p>
                Some services live in the workspace only because you want their git / docs / notes
                trail handy — you don&apos;t need them cluttering the dashboard between the things
                you actually run. Toggle the new <strong>Hide from dashboard</strong> flag (eye-off
                icon in the service header, or the inline switch in the Advanced editor) and the
                card disappears from the dashboard grid while staying fully reachable from the
                sidebar, search, and quick actions.
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
                <li>
                  A <strong>persistent hidden-services toggle chip</strong> sits next to the search
                  bar so you can re-reveal them in one click when you need to. The chip&apos;s
                  open/closed state is remembered per workspace.
                </li>
                <li>
                  Hidden cards render with a subtle <strong>EyeOff badge</strong> when revealed, so
                  you can tell them apart from the always-visible ones without re-opening the
                  service.
                </li>
                <li>
                  The card overflow menu and the service header both expose a quick{' '}
                  <strong>Show / Hide on dashboard</strong> action — no more burying the toggle
                  inside the Advanced editor tab.
                </li>
              </ul>
            </>
          ),
        },

        {
          id: 'dashboard-polish',
          title: 'Filter bar + card overflow menu polish',
          badge: 'improved',
          body: (
            <>
              <p>
                The dashboard&apos;s filter strip used to be a stack of chip groups that grew
                another row every time we added an axis. It now lives on a{' '}
                <strong>single top row</strong>: search input on the left, then{' '}
                <strong>Attention</strong> and <strong>Git</strong> dropdowns (each with a prefixed
                uppercase label so the axis is unambiguous), then the Hidden toggle, Group, and Sort
                controls — one continuous bar instead of a chip wall.
              </p>

              <Callout tone="success" title="Filtering no longer freezes the UI">
                Switching between filter options used to lock the dashboard for ~150–300 ms while
                React mounted / unmounted card trees. The grid now mounts every eligible card once
                and toggles visibility via CSS (<code>display: none</code>), with{' '}
                <code>useTransition</code> driving the filter state update. Switching between
                &quot;All&quot; and any other filter is instant.
              </Callout>

              <p>
                The card overflow menu (⋯ on each card) now renders through a{' '}
                <strong>
                  portal to <code>document.body</code>
                </strong>{' '}
                with viewport-relative positioning, so it can no longer be clipped by the
                card&apos;s own <code>overflow: hidden</code>. A module-level pubsub registry
                enforces <strong>only-one-open-at-a-time</strong> across the dashboard — opening a
                new menu automatically closes the previous one. Item styling now matches{' '}
                <code>EditorDropdown</code> for visual consistency.
              </p>
            </>
          ),
        },
      ],
    },

    {
      id: 'install-and-distribution',
      title: 'Install & distribution',
      subsections: [
        {
          id: 'install-distribution',
          title: 'macOS notarization, ARM64 builds, smarter landing page',
          badge: 'improved',
          body: (
            <>
              <p>
                The install pipeline picked up several upgrades across 0.10.1 / 0.10.2 / 0.10.3:
              </p>

              <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li>
                  <strong>macOS Developer ID notarization</strong> wired into the release CI, gated
                  on signing secrets so forks without certificates still build. First-launch
                  Gatekeeper prompt is gone for users on Apple-built binaries.
                </li>
                <li>
                  <strong>ARM64 builds</strong> are first-class on every supported OS, and the
                  landing page <strong>auto-detects OS + arch</strong> so the download CTA points at
                  the right binary instead of forcing the visitor to read filename suffixes.
                </li>
                <li>
                  <strong>Version-less Linux asset aliases</strong> let scripted installs and
                  package recipes pin to <code>runhq-linux-x86_64.AppImage</code> /{' '}
                  <code>runhq-linux-aarch64.deb</code> instead of chasing the latest version number
                  across release tags.
                </li>
                <li>
                  <strong>Linux + manual installs</strong> hand off cleanly to the GitHub Releases
                  page (winget references removed, install instructions updated to reflect what
                  actually ships).
                </li>
                <li>
                  <strong>Content-Security-Policy</strong> on the docs site now permits the GitHub
                  API request used by the &quot;latest release&quot; widget, so the landing page
                  stops 404&apos;ing the version pill on first paint.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
  ],
};
