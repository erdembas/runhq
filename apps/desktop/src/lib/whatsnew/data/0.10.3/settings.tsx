import { Callout, KbdChip, SettingChip } from '@/components/whatsnew/inline';
import type { ReleaseSection } from '../../types';

export const settingsSections: ReleaseSection[] = [
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
                <strong>AI Providers</strong> — the full provider CRUD (add / edit / remove / test,
                language pickers, default-marking) is rendered <strong>inline</strong> on this page.
                No more modal hop, no more &quot;Manage providers&quot; launcher button. Every entry
                point that used to open the legacy dialog (status-bar AI chip, chat composer model
                picker &quot;Manage&quot;, model chooser popover, release-notes CTA) now deep-links
                straight to this page.
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
              The status-bar &quot;shortcuts&quot; chip is now <strong>Settings</strong> (cog icon)
              and opens the hub at its default category. The <strong>AI</strong> chip opens the hub
              at the AI category instead of a modal. Two clicks down to one for both.
            </Callout>

            <p>
              Each category lives inside a shared{' '}
              <SettingChip name="SettingsPageShell" prefix="Component" /> with optional toolbar /
              footer slots — so &quot;Save &amp; Apply&quot; on Shortcuts sits in a real footer
              strip instead of the half-translucent sticky bar the previous draft used. Adding a new
              category is a single file in <code>components/settings/categories/</code> plus an
              entry in the sidebar array.
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
              terminal scrollback) and re-rendered it from scratch. With three or four service tabs
              open you could feel the freeze (~200–500 ms of pegged main thread) every time you
              bounced through Settings to tweak a shortcut.
            </p>

            <p>
              Both pages are now <strong>regular main tabs</strong>, opened and closed through the
              same tab-strip controls (X button, middle-click, right-click → Close,{' '}
              <KbdChip>Cmd</KbdChip> + <KbdChip>W</KbdChip>) as any service or stack tab. The
              main-tab tree never unmounts: switching between Dashboard, a service, Settings, and
              Release Notes is instant in either direction. The redundant in-page &quot;Back&quot; /
              &quot;X&quot; buttons that lived in the overlay headers were also removed — duplicated
              chrome once the tab strip owned closing.
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
              The shortcut catalogue grew from <strong>2 entries to 9</strong>, organised into three
              scopes so the user knows what each one does and when:
            </p>

            <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
              <li>
                <strong>Global</strong> (Tauri global-shortcut plugin — fires from anywhere, even
                when RunHQ is hidden / minimised / behind another app): <KbdChip>Cmd</KbdChip> +{' '}
                <KbdChip>Shift</KbdChip> + <KbdChip>K</KbdChip> opens the Quick Action Bar;{' '}
                <KbdChip>Cmd</KbdChip> + <KbdChip>Shift</KbdChip> + <KbdChip>L</KbdChip> brings the
                main window to the foreground.
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
                <KbdChip>W</KbdChip> closes the active tab. The Dashboard tab is sticky and ignores
                Close so the workspace always has an anchor.
              </li>
            </ul>

            <Callout tone="success" title="Shortcuts work even from input fields">
              Earlier drafts suppressed shortcuts when an input or contenteditable element had focus
              — which meant <KbdChip>Cmd</KbdChip> + <KbdChip>Shift</KbdChip> + <KbdChip>A</KbdChip>{' '}
              opened the AI panel but couldn&apos;t close it again because the AI composer snapped
              focus on open. Bound chords now match regardless of the event target; they always
              require a modifier so plain typing in inputs is never intercepted.
            </Callout>

            <Callout tone="note" title="Live conflict detection">
              Two shortcuts mapped to the same chord light up with a <code>status-error</code> ring
              and Save &amp; Apply is disabled until you fix it. Comparison is on the canonical
              chord form, so <code>Cmd+B</code> and <code>CmdOrCtrl+B</code> count as the same
              binding — no silent same-chord overlap that quietly clobbers half the catalogue.
            </Callout>

            <p>
              Defaults migrate forward via <code>#[serde(default)]</code> on every new field, so
              existing config files keep working and just pick up the new bindings on first read.
              Global shortcuts apply after the next restart (they need to be re-registered with the
              OS); window shortcuts apply immediately on save.
            </p>
          </>
        ),
      },
    ],
  },
];
