import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { ReleaseDetail } from '@/components/release-notes/ReleaseDetail';
import { EmptyState, SelectionEmpty } from '@/components/release-notes/ReleaseEmptyStates';
import { ReleaseRow } from '@/components/release-notes/ReleaseRow';
import { getAllReleases } from '@/lib/whatsnew';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/store/useAppStore';

export function ReleaseNotes() {
  const releases = useMemo(() => getAllReleases(), []);
  const appVersion = useAppStore((s) => s.appVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const closeReleaseNotes = useAppStore((s) => s.closeReleaseNotes);
  const hint = useAppStore((s) => s.releaseNotesSelectedVersion);
  const { effective: effectiveTheme } = useTheme();
  const themeSuffix = effectiveTheme === 'dark' ? 'dark' : 'light';

  const initialVersion = useMemo(() => {
    const normalise = (v: string | null | undefined) => (v ? v.replace(/^v/i, '').trim() : null);
    const hinted = normalise(hint);
    if (hinted && releases.some((r) => normalise(r.version) === hinted)) return hinted;
    const running = normalise(appVersion);
    if (running && releases.some((r) => normalise(r.version) === running)) return running;
    return releases[0]?.version ?? null;
  }, [hint, appVersion, releases]);

  const [selectedVersion, setSelectedVersion] = useState<string | null>(initialVersion);

  useEffect(() => {
    if (!hint) return;
    const normalised = hint.replace(/^v/i, '').trim();
    if (releases.some((r) => r.version.replace(/^v/i, '') === normalised)) {
      setSelectedVersion(normalised);
    }
  }, [hint, releases]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedVersion]);

  const selected = useMemo(
    () => releases.find((r) => r.version === selectedVersion) ?? null,
    [releases, selectedVersion],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeReleaseNotes();
        return;
      }
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (releases.length === 0) return;
      e.preventDefault();
      const idx = releases.findIndex((r) => r.version === selectedVersion);
      const next =
        e.key === 'ArrowDown' ? Math.min(releases.length - 1, idx + 1) : Math.max(0, idx - 1);
      const target = releases[next];
      if (target) setSelectedVersion(target.version);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeReleaseNotes, releases, selectedVersion]);

  const handleOpenInModal = useCallback(() => {
    if (!selected) return;
    openWhatsNew(selected.version);
  }, [openWhatsNew, selected]);

  const latestVersion = releases[0]?.version ?? null;
  const normalisedRunning = appVersion ? appVersion.replace(/^v/i, '') : null;

  return (
    <div className="bg-surface flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="border-border bg-surface flex shrink-0 items-center border-b px-5 py-3">
        <div className="min-w-0">
          <span className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
            <History className="text-accent h-3 w-3" />
            Release notes
          </span>
          <h1 className="text-fg text-[14px] leading-tight font-semibold tracking-tight">
            Every release at a glance
          </h1>
        </div>
      </header>

      {releases.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="border-border bg-surface-raised/30 w-[240px] shrink-0 overflow-y-auto border-r p-2">
            <div className="text-fg-dim/80 px-2 pt-1 pb-2 text-[10px] font-semibold tracking-wider uppercase">
              Releases
            </div>
            <div className="flex flex-col gap-0.5">
              {releases.map((release) => (
                <ReleaseRow
                  key={release.version}
                  release={release}
                  selected={release.version === selectedVersion}
                  isRunning={
                    !!normalisedRunning && release.version.replace(/^v/i, '') === normalisedRunning
                  }
                  isLatest={release.version === latestVersion}
                  onSelect={() => setSelectedVersion(release.version)}
                />
              ))}
            </div>
          </aside>

          <main ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto select-text">
            {selected ? (
              <ReleaseDetail
                release={selected}
                themeSuffix={themeSuffix}
                onOpenModal={handleOpenInModal}
                onAfterAction={closeReleaseNotes}
                scrollerRef={scrollerRef}
              />
            ) : (
              <SelectionEmpty />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
