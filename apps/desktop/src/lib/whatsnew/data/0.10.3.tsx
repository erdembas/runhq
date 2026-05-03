import type { DocumentRelease } from '../types';
import { release_0_10_3_sections } from './0.10.3/sections';

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

  sections: release_0_10_3_sections,
};
