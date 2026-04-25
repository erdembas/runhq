/**
 * Sidebar version chip — discreet `vX.Y.Z` pill at the bottom of the
 * expanded sidebar that doubles as the entry point into the
 * "What's New" modal.
 *
 * Why a chip and not a menu item: every "release notes" surface in
 * apps users actually keep coming back to (Linear, Raycast, the
 * Electron family, JetBrains) puts the version somewhere
 * peripherally visible — so users notice it changed after an update
 * and click reflexively. A buried Help menu entry hits maybe one
 * third of that audience.
 *
 * Hidden when:
 *   • the sidebar is collapsed (icon rail mode) — there's no width
 *     for a label and we don't want a tooltip-only mystery dot;
 *   • the running build has no curated highlights for the running
 *     version — we'd be advertising a feature we can't deliver.
 */
import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getReleaseFor } from '@/lib/whatsnew';

interface Props {
  expanded: boolean;
}

export function VersionChip({ expanded }: Props) {
  const appVersion = useAppStore((s) => s.appVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);

  // The chip is interactive only when there's actually a release entry
  // for the running version — otherwise we render a muted, non-clickable
  // version label so the layout doesn't shift between releases that ship
  // highlights and ones that don't.
  const release = useMemo(() => {
    if (!appVersion) return null;
    return getReleaseFor(appVersion);
  }, [appVersion]);

  if (!expanded) return null;
  if (!appVersion) return null;

  if (!release) {
    return (
      <div className="text-fg-dim/70 px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase">
        v{appVersion}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openWhatsNew(release.version)}
      title={`See what's new in RunHQ ${release.version}`}
      className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 group flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors"
    >
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="text-accent/70 group-hover:text-accent h-3 w-3 transition-colors" />
        <span className="font-mono tabular-nums">v{release.version}</span>
      </span>
      <span className="text-fg-dim/70 group-hover:text-fg-dim text-[10px] tracking-wide transition-colors">
        What&apos;s new
      </span>
    </button>
  );
}
