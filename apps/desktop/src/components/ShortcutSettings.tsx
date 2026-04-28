import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, PlayCircle, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/useAppStore';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { getLatestRelease } from '@/lib/whatsnew';
import type { Prefs, Shortcuts } from '@/types';

// Stored in the platform-agnostic `CmdOrCtrl` form that Tauri's
// global-shortcut parser resolves to Command on macOS and Control on
// Windows/Linux. The UI then displays the platform-appropriate label.
const DEFAULT_SHORTCUTS: Shortcuts = {
  quick_action: 'CmdOrCtrl+Shift+K',
  focus_main: 'CmdOrCtrl+Shift+L',
};

const SHORTCUT_LABELS: Record<keyof Shortcuts, string> = {
  quick_action: 'Quick Action Bar',
  focus_main: 'Show RunHQ window',
};

const SHORTCUT_DESCRIPTIONS: Record<keyof Shortcuts, string> = {
  quick_action:
    'Open the Spotlight-like search bar from anywhere. The app window will be brought to front if hidden.',
  focus_main:
    'Bring the main RunHQ window to the foreground from anywhere — works even when RunHQ is hidden in the menu bar / tray, minimised, or sitting behind a fullscreen editor.',
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
// The primary "command" modifier as the user expects to see it on their OS —
// Cmd on Mac, Ctrl everywhere else. Windows/Linux users don't want to see
// "Cmd" anywhere in the UI; this is the pragmatic cross-platform convention
// VS Code, Slack, Linear, etc. all follow.
const PRIMARY_MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';

function normalizeShortcut(raw: string): string {
  // Any token that a Tauri shortcut string may use for the platform's
  // primary modifier is collapsed to the single platform-appropriate label
  // before rendering. `Control` alone always stays as `Ctrl` because a
  // power user may bind literal Control on macOS on purpose.
  return raw
    .replace(/CommandOrControl/g, PRIMARY_MOD_LABEL)
    .replace(/CmdOrCtrl/g, PRIMARY_MOD_LABEL)
    .replace(/Command/g, PRIMARY_MOD_LABEL)
    .replace(/\bCmd\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bSuper\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bMeta\b/g, PRIMARY_MOD_LABEL)
    .replace(/\bControl\b/g, 'Ctrl');
}

function parseKeyboardEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push(PRIMARY_MOD_LABEL);
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    const k = key.length === 1 ? key.toUpperCase() : key;
    parts.push(k);
  }
  return parts.join('+');
}

interface ShortcutRowProps {
  id: keyof Shortcuts;
  value: string;
  onChange: (id: keyof Shortcuts, value: string) => void;
  onReset: (id: keyof Shortcuts) => void;
  /**
   * `true` when this row's binding collides with another row's binding
   * after normalisation. Rendered as a soft danger ring + inline note
   * so users can resolve the duplicate without hunting through the
   * Rust logs for the silent-skip warning.
   */
  conflict?: boolean;
}

function ShortcutRow({ id, value, onChange, onReset, conflict }: ShortcutRowProps) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (recording) inputRef.current?.focus();
  }, [recording]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      const shortcut = parseKeyboardEvent(e);
      const hasModifier = e.metaKey || e.ctrlKey;
      if (!hasModifier) return;
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
      onChange(id, shortcut);
      setRecording(false);
    },
    [recording, id, onChange],
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-fg text-[12px] font-medium">{SHORTCUT_LABELS[id]}</div>
        <div className="text-fg-dim text-[10px]">{SHORTCUT_DESCRIPTIONS[id]}</div>
        {conflict && (
          <div className="text-danger mt-1 text-[10px]">
            Same binding as another shortcut — pick a different chord so both can fire.
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          ref={inputRef}
          type="button"
          onBlur={() => setRecording(false)}
          onClick={() => setRecording(true)}
          className={cn(
            'border-border bg-surface-muted hover:border-border-strong rounded-app-sm min-w-[140px] border px-3 py-1.5 text-left transition',
            recording && 'border-accent ring-accent/30 ring-2',
            !recording && conflict && 'border-danger ring-danger/30 ring-2',
          )}
        >
          {recording ? (
            <span className="text-accent text-[11px]">Press shortcut…</span>
          ) : (
            <span className="flex items-center gap-1">
              {value.split('+').map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-fg-dim text-[10px]">+</span>}
                  <Kbd className="text-[10px]">{part}</Kbd>
                </span>
              ))}
            </span>
          )}
        </button>
        <button
          type="button"
          title="Reset to default"
          onClick={() => onReset(id)}
          className="text-fg-dim hover:text-fg inline-flex h-6 w-6 items-center justify-center transition"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

interface ShortcutSettingsProps {
  onClose: () => void;
  /** Called when the user clicks "Replay welcome tour". The caller is
   *  responsible for actually opening the tour UI; we just surface the
   *  action because this dialog is the natural home for discoverability
   *  features. */
  onReplayTour?: () => void;
}

export function ShortcutSettings({ onClose, onReplayTour }: ShortcutSettingsProps) {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  // "Data & cache" section state. Kept local because none of these
  // values are interesting beyond this dialog's lifetime — a global
  // store would just add re-render surface for no benefit.
  const [scanRowCount, setScanRowCount] = useState<number | null>(null);
  const [confirmResetScans, setConfirmResetScans] = useState(false);
  const [resettingScans, setResettingScans] = useState(false);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);
  // Only render the release links if there's actually a release entry
  // shipped — keeps the dialog from showing dead buttons on a build
  // that lost the registry (e.g. during a future split where OSS / pro
  // have different highlight sets).
  const latestRelease = useMemo(() => getLatestRelease(), []);

  useEffect(() => {
    ipc.getPrefs().then((p) => {
      setPrefs(p);
      if (p.shortcuts) setShortcuts(p.shortcuts);
    });
    // Fire-and-forget the row count for the "Reset scan cache"
    // section. We don't block the rest of the dialog on this — a
    // failed read just leaves the count as "unknown", which the UI
    // still renders sensibly.
    ipc
      .listPersistedScans()
      .then((rows) => setScanRowCount(rows.length))
      .catch(() => setScanRowCount(null));
  }, []);

  /**
   * Wipe the persistent dependency-scan database, then clear the
   * matching in-memory store maps so the dashboard immediately
   * reflects "no scans on file" rather than continuing to show
   * stale "scanned 3h ago" chips. The actual `npm outdated` /
   * `cargo audit` data on the project cards stays intact (it
   * lives on the live overview, not in the scan history) so the
   * user doesn't lose visible signal until the next refresh.
   */
  const handleResetScanCache = async () => {
    setResettingScans(true);
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
      setResettingScans(false);
      setConfirmResetScans(false);
    }
  };

  const handleChange = (id: keyof Shortcuts, value: string) => {
    setShortcuts((prev) => ({ ...prev, [id]: value }));
  };

  const handleReset = (id: keyof Shortcuts) => {
    setShortcuts((prev) => ({ ...prev, [id]: DEFAULT_SHORTCUTS[id] }));
  };

  const handleResetAll = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
  };

  /**
   * Set of shortcut ids that share their (normalised) chord with at
   * least one other binding. Two rows with the same chord would have
   * the second `on_shortcut` registration silently clobber the first
   * inside Tauri's global-shortcut plugin — surfacing the conflict
   * here lets the user fix it before save instead of finding out via
   * "huh, my palette doesn't open anymore".
   *
   * Comparison is on the *normalised* string so `Cmd+Shift+L` and
   * `CmdOrCtrl+Shift+L` count as the same chord even though they're
   * stored differently.
   */
  const conflictingIds = useMemo<ReadonlySet<keyof Shortcuts>>(() => {
    const counts = new Map<string, Array<keyof Shortcuts>>();
    for (const id of Object.keys(DEFAULT_SHORTCUTS) as Array<keyof Shortcuts>) {
      const normalised = normalizeShortcut(shortcuts[id] ?? DEFAULT_SHORTCUTS[id]).toLowerCase();
      const list = counts.get(normalised);
      if (list) list.push(id);
      else counts.set(normalised, [id]);
    }
    const out = new Set<keyof Shortcuts>();
    for (const list of counts.values()) {
      if (list.length > 1) {
        for (const id of list) out.add(id);
      }
    }
    return out;
  }, [shortcuts]);

  const hasConflict = conflictingIds.size > 0;

  const handleSave = async () => {
    if (hasConflict) return;
    setSaving(true);
    try {
      const updated = await ipc.updatePrefs({
        ...prefs,
        theme: prefs?.theme ?? null,
        last_scanned_dir: prefs?.last_scanned_dir ?? null,
        shortcuts,
      });
      setPrefs(updated);
      onClose();
    } catch (err) {
      console.error('failed to save shortcuts', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose} size="md">
      <div className="flex flex-col gap-1">
        {(Object.keys(DEFAULT_SHORTCUTS) as Array<keyof Shortcuts>).map((id) => (
          <ShortcutRow
            key={id}
            id={id}
            value={normalizeShortcut(shortcuts[id] ?? DEFAULT_SHORTCUTS[id])}
            onChange={handleChange}
            onReset={handleReset}
            conflict={conflictingIds.has(id)}
          />
        ))}
      </div>
      <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
        <Button variant="ghost" size="sm" onClick={handleResetAll}>
          Reset All
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || hasConflict}>
            {saving ? 'Saving…' : 'Save & Apply'}
          </Button>
        </div>
      </div>
      <p className="text-fg-dim mt-3 text-[10px]">
        Changes to global shortcuts take effect after restarting the app. A modifier key (Cmd/Ctrl)
        is required for all shortcuts.
      </p>

      {/*
        Data & cache section. Lives in the same dialog as keyboard
        shortcuts because both are "preferences I tweak rarely" — a
        dedicated Settings window for one button felt overkill, and
        the user already lands here from the gear icon. The row
        count tells the user up-front "this will affect 14
        projects", so the destructive action isn't fired blind.
      */}
      <div className="border-border mt-4 border-t pt-3">
        <div className="text-fg mb-1 text-[12px] font-semibold">Dependency scan history</div>
        <p className="text-fg-dim mb-2 text-[11px]">
          Cached scan results survive restarts so the dashboard can render audit/outdated chips
          instantly on cold start. Resetting forces every project to be rescanned on the next
          dependency sweep.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="text-fg-dim flex items-center gap-1.5 text-[11px]">
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
            onClick={() => setConfirmResetScans(true)}
            disabled={resettingScans || scanRowCount === 0 || scanRowCount == null}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            {resettingScans ? 'Clearing…' : 'Reset scan cache'}
          </Button>
        </div>
      </div>

      {confirmResetScans && (
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
          onCancel={() => setConfirmResetScans(false)}
        />
      )}

      {(onReplayTour || latestRelease) && (
        <div className="border-border mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
          {onReplayTour && (
            <button
              type="button"
              onClick={onReplayTour}
              className="text-fg-dim hover:text-fg inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors"
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Replay welcome tour
            </button>
          )}
          {latestRelease && (
            <>
              <button
                type="button"
                onClick={() => {
                  openWhatsNew(latestRelease.version);
                  onClose();
                }}
                className="text-fg-dim hover:text-fg inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                What&apos;s new in {latestRelease.version}
              </button>
              <button
                type="button"
                onClick={() => {
                  openReleaseNotes();
                  onClose();
                }}
                className="text-fg-dim hover:text-fg inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors"
              >
                <History className="h-3.5 w-3.5" />
                Release notes
              </button>
            </>
          )}
        </div>
      )}

      <div className="border-border mt-4 border-t pt-3">
        <div className="text-fg text-[12px] font-semibold">Danger Zone</div>
        <p className="text-fg-dim mt-1 text-[11px]">
          Remove all services, stacks, and sections. This cannot be undone.
        </p>
        <FullReset />
      </div>
    </Dialog>
  );
}

function FullReset() {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = useAppStore((s) => s.services);
  const setServices = useAppStore((s) => s.setServices);
  const setStacks = useAppStore((s) => s.setStacks);
  const resetSections = useCallback(() => {
    useAppStore.setState({ sections: [], serviceSection: {}, stackSection: {} });
  }, []);

  const doReset = async () => {
    setBusy(true);
    for (const svc of services) {
      await ipc.stopService(svc.id).catch(() => {});
      await ipc.removeService(svc.id);
    }
    setServices([]);
    setStacks([]);
    resetSections();
    setBusy(false);
    setPending(false);
  };

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        leftIcon={<Trash2 className="h-3 w-3" />}
        onClick={() => setPending(true)}
        disabled={services.length === 0 && busy}
        className="mt-2"
      >
        {busy ? 'Resetting…' : 'Full Reset'}
      </Button>
      {pending && (
        <ConfirmDialog
          message="Delete all services, stacks, and sections?"
          onConfirm={doReset}
          onCancel={() => setPending(false)}
        />
      )}
    </>
  );
}
