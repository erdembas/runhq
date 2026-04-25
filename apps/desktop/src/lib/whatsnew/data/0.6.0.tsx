/**
 * 0.6.0 release highlights — the "project command center" chapter.
 *
 * Lifted from CHANGELOG §0.6.0 and rewritten in end-user voice (the
 * CHANGELOG copy is engineer-flavoured and densely cross-referenced).
 * Each highlight maps to one in-app surface so the CTA can drop the
 * user straight into the feature instead of leaving them to hunt.
 */
import { GitBranch, History, LayoutDashboard, Sparkles } from 'lucide-react';
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
        'outdated dependencies and CVE alerts in one screen. Each card opens ' +
        'a per-project triage drawer with one-click upgrade scripts.',
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
      id: 'git-diff-viewer',
      title: 'Source Control, built-in',
      badge: 'new',
      blurb:
        'Full Monaco-powered diff, staging, history, branches and commit graph — ' +
        'without leaving RunHQ. The cross-project view rolls up every dirty repo ' +
        'so half-finished commits stop slipping through context switches.',
      media: {
        src: '/whatsnew/0.6.0/diff-viewer',
        themeAware: true,
        alt: 'Source Control window with file tree on the left and a Monaco diff editor on the right',
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
      title: 'Activity Timeline',
      badge: 'new',
      blurb:
        '"What did I work on today?" — answered. SQLite-persisted feed of every ' +
        'service start, git op, error and file change across every project. ' +
        'Daily / weekly summaries, plus a one-click standup export.',
      media: {
        src: '/whatsnew/0.6.0/timeline',
        themeAware: true,
        alt: 'Activity timeline drawer with a vertical node graph of color-coded events',
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
      id: 'plus-more',
      title: 'And a stack of polish',
      badge: 'improved',
      blurb:
        'Cmd/Ctrl + 0 / − UI zoom · cleaner sidebar (no duplicate stack members) · ' +
        'auto-hiding macOS scrollbars · floating drawer surface · shadcn-style ' +
        'branch picker · 90+ Material file icons in Source Control.',
      media: {
        alt: '',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Sparkles className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Five more quality-of-life upgrades',
        tint: 'amber',
      },
      cta: {
        kind: 'store-action',
        label: 'Read full changelog',
        actionId: 'open-changelog',
      },
    },
  ],
};
