import { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { SettingsPageShell, SettingsSection } from '../SettingsView';

/**
 * Data & Cache category.
 *
 * Today this is the dependency-scan history. Future tenants of this
 * page (overview snapshots, terminal scrollback caches, etc.) will
 * each get their own `SettingsSection` so the user has one
 * predictable home for "RunHQ has cached X for me, let me see /
 * clear it".
 */
export function DataCategory({ description }: { description?: string }) {
  const [scanRowCount, setScanRowCount] = useState<number | null>(null);
  const [stateDir, setStateDir] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    ipc
      .listPersistedScans()
      .then((rows) => setScanRowCount(rows.length))
      .catch(() => setScanRowCount(null));
    ipc
      .appInfo()
      .then((info) => setStateDir(info.state_dir))
      .catch(() => setStateDir(null));
  }, []);

  const handleResetScanCache = async () => {
    setResetting(true);
    try {
      const cleared = await ipc.clearPersistedScans();
      // Drop freshness/duration/delta maps in one shot so chips
      // disappear from the dashboard. Live audit/outdated values
      // stay because they're driven by the overview snapshot.
      useAppStore.setState({
        scanFreshnessByService: new Map(),
        scanDurationByService: new Map(),
        scanDeltasByService: new Map(),
      });
      setScanRowCount(0);
      console.info(`[Settings] cleared ${cleared} persisted scan(s)`);
    } catch (err) {
      console.error('[Settings] reset scan cache failed', err);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <SettingsPageShell description={description}>
      <SettingsSection
        title="Dependency scan history"
        description="Cached scan results survive restarts so the dashboard can render audit/outdated chips instantly on cold start. Resetting forces every project to be rescanned on the next dependency sweep."
      >
        <div className="border-border/50 bg-surface/40 rounded-app-sm flex items-center justify-between gap-3 border px-3 py-3">
          <div className="text-fg-dim flex items-center gap-2 text-[11px]">
            <History className="h-3.5 w-3.5" />
            {scanRowCount == null
              ? 'Loading scan cache…'
              : scanRowCount === 0
                ? 'No persisted scans yet'
                : `${scanRowCount} project${scanRowCount === 1 ? '' : 's'} cached`}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmReset(true)}
            disabled={resetting || scanRowCount === 0 || scanRowCount == null}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            {resetting ? 'Clearing…' : 'Reset scan cache'}
          </Button>
        </div>
      </SettingsSection>

      {stateDir && (
        <SettingsSection
          title="Storage location"
          description="Configuration, cached scans, and AI provider settings live in this directory. Quit RunHQ before backing it up to avoid copying a half-written sqlite file."
        >
          <div className="border-border/50 bg-surface/40 rounded-app-sm border px-3 py-2.5">
            <div className="text-fg-dim mb-1 text-[10px] tracking-wider uppercase">
              State directory
            </div>
            <div className="text-fg font-mono text-[11px] break-all">{stateDir}</div>
          </div>
        </SettingsSection>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Reset scan cache?"
          message={
            scanRowCount && scanRowCount > 0
              ? `This will delete ${scanRowCount} cached scan result${
                  scanRowCount === 1 ? '' : 's'
                }. The next dependency sweep will rerun npm outdated / cargo audit for every project.`
              : 'This will delete all cached dependency scan results.'
          }
          confirmLabel="Reset cache"
          confirmWord="reset"
          tone="danger"
          onConfirm={() => void handleResetScanCache()}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </SettingsPageShell>
  );
}
