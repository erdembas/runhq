/**
 * 0.6.0 release highlights — the "project command center" chapter.
 *
 * Scope decision: 5 highlights, not 3 or 7. Five fits inside a single
 * carousel without forcing the user to decide whether to keep paging,
 * and matches the rhythm Linear / Raycast / Arc use for major releases.
 * Three would have collapsed two distinct surfaces (the dashboard's
 * bird's-eye view vs. the per-project triage drawer) into one bullet
 * and undersold the work; seven would have read like a spec sheet.
 *
 * Each highlight is *the* surface a user can open and play with. We
 * avoid mixing engineering wins (e.g. two-phase aggregator, serde
 * boundary fix) into the modal — those live in CHANGELOG.md where
 * developers go for that level of detail. Here we surface only what
 * a non-technical adopter cares about: what new thing can I touch?
 *
 * Asset slugs map 1:1 to `apps/desktop/public/whatsnew/0.6.0/<slug>-{light,dark}.webp`.
 * Files that don't exist yet fall back to the in-component gradient,
 * so this content can ship before screenshots are produced.
 */
import {
  CheckCircle2,
  GitBranch,
  History,
  LayoutDashboard,
  Layers,
  MoveVertical,
  PanelRight,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  ZoomIn,
} from 'lucide-react';
import type { WhatsNewRelease } from '../types';

export const release_0_6_0: WhatsNewRelease = {
  version: '0.6.0',
  releasedAt: '2026-04-23',
  headline: 'Project command center, shipped.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md#060',
  highlights: [
    {
      id: 'cross-project-dashboard',
      title: 'Cross-Project Dashboard',
      badge: 'new',
      blurb:
        "Bird's-eye view of every repo on disk — git status, resource heatmap, " +
        'outdated dependencies and CVE alerts in one screen. The new filter bar ' +
        'splits into three chambers (Organize · Git · Attention) so you can ' +
        'narrow to "dirty + at risk" in two clicks, and the WorstOffenders band ' +
        'always surfaces the projects you should look at first.',
      media: {
        src: '/whatsnew/0.6.0/dashboard',
        themeAware: true,
        alt: 'Cross-project dashboard with project cards, git status pills and resource heatmap',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <LayoutDashboard className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Every project, one screen',
        tint: 'accent',
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
    {
      id: 'triage-cockpit',
      title: 'Triage Cockpit, per project',
      badge: 'new',
      blurb:
        'Click any project card and a triage drawer slides in with severity- and ' +
        'bump-tinted tabs, a multi-select rail, and a sticky bulk bar that copies ' +
        'every selected upgrade as a single shell script. Advisories keep their ' +
        'GHSA link permanently visible — reading the write-up *is* the triage ' +
        'action, not a buried secondary one. In-drawer rescan, plus an "Open in…" ' +
        'menu that lists every editor RunHQ detected on your machine.',
      media: {
        src: '/whatsnew/0.6.0/triage-drawer',
        themeAware: true,
        alt: 'Project triage drawer with severity-tinted tabs, multi-select rows, and a copy-as-script bulk bar',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <ShieldCheck className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Audit, upgrade, ship',
        tint: 'emerald',
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
    {
      id: 'source-control',
      title: 'Source Control, built-in',
      badge: 'new',
      blurb:
        'Full Monaco diff (with a Diffs-only / Full-file toggle that actually ' +
        'fetches more context), staging, history, branches and a commit graph — ' +
        'no more bouncing to VSCode. shadcn-style branch picker, 90+ Material ' +
        'file icons, VSCode-parity right-click menu, and Esc no longer eats your ' +
        'half-written commit message. The cross-project view rolls up every ' +
        'dirty repo so half-finished commits stop slipping through context switches.',
      media: {
        src: '/whatsnew/0.6.0/diff-viewer',
        themeAware: true,
        alt: 'Source Control window with file tree, Monaco diff editor, branch picker and commit composer',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <GitBranch className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Stay in flow, skip VSCode',
        tint: 'sky',
      },
      cta: {
        kind: 'store-action',
        label: 'Open Cross-Project Changes',
        actionId: 'open-cross-project-diff',
      },
    },
    {
      id: 'activity-timeline',
      title: 'Activity Timeline & Standup Export',
      badge: 'new',
      blurb:
        '"What did I work on today?" — answered. SQLite-persisted feed of every ' +
        'service start, git op, error and file change across every project, ' +
        'rendered as a node-graph on the right edge. One-click standup export ' +
        'turns the day into a clean markdown block ready to paste into Slack or ' +
        'Linear, with commits grouped by project and error counts surfaced ' +
        "so retros don't have to invent themselves.",
      media: {
        src: '/whatsnew/0.6.0/timeline',
        themeAware: true,
        alt: 'Activity timeline drawer with a vertical node graph and a standup export chip in the toolbar',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <History className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'A standup, ready to paste',
        tint: 'violet',
      },
      cta: { kind: 'store-action', label: 'Open Timeline', actionId: 'open-timeline' },
    },
    {
      id: 'polish',
      title: 'Polish that adds up',
      badge: 'improved',
      blurb:
        'Half a dozen tiny upgrades aimed at the surfaces you touch every ' +
        'day — keyboard zoom, calmer scrollbars, the drawer floating instead ' +
        'of crashing into the canvas, persistent sidebar widths, smarter ' +
        'service counting, and a Windows CI runner that stays green.',
      media: {
        src: undefined,
        themeAware: false,
        alt: '',
        aspectRatio: '16/9',
      },
      fallback: {
        // Single screenshot can't honestly represent six unrelated polish
        // items, so we render a bullet grid instead. Each item is the
        // smallest unit that's still recognisable on its own — keyboard
        // chord, scope, etc. live in `sub`.
        icon: <Sparkles className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Six quality-of-life upgrades',
        tint: 'amber',
        bullets: [
          {
            icon: <ZoomIn className="h-4 w-4" />,
            label: 'UI zoom',
            sub: 'Cmd/Ctrl + 0 / − / =',
          },
          {
            icon: <MoveVertical className="h-4 w-4" />,
            label: 'Auto-hiding scrollbars',
            sub: 'Native macOS feel',
          },
          {
            icon: <PanelRight className="h-4 w-4" />,
            label: 'Floating drawer',
            sub: "Doesn't fight the canvas",
          },
          {
            icon: <SplitSquareHorizontal className="h-4 w-4" />,
            label: 'Resizable diff sidebars',
            sub: '220–720 px, persisted',
          },
          {
            icon: <Layers className="h-4 w-4" />,
            label: 'Stack-aware sidebar',
            sub: 'No more double-counts',
          },
          {
            icon: <CheckCircle2 className="h-4 w-4" />,
            label: 'Stable Windows CI',
            sub: 'ScanCache TTL fix',
          },
        ],
      },
      cta: {
        kind: 'store-action',
        label: 'Read full changelog',
        actionId: 'open-changelog',
      },
    },
  ],
};
