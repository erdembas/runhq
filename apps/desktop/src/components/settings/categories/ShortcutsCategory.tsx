import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import {
  canonicalizeChord,
  chordToStoredBinding,
  DEFAULT_SHORTCUTS,
  normalizeShortcutForDisplay,
  SHORTCUT_CATALOG,
  SHORTCUT_GROUP_DESCRIPTIONS,
  SHORTCUT_GROUP_LABELS,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutMeta,
} from '@/lib/shortcuts';
import type { Prefs, Shortcuts } from '@/types';
import { SettingsPageShell, SettingsSection } from '../SettingsView';

/**
 * VS Code / Cursor-style shortcut editor.
 *
 * Replaces the previous compact dialog with a wider, table-shaped
 * layout: filter / search bar across the top, then one section
 * per group (Global → Window panels → Service workspace → Main
 * tabs), each section rendering a column-aligned table of action
 * label / scope chip / chord / reset. The wider grid gives every
 * column room to breathe so the page no longer feels like a row
 * of cramped chips.
 *
 * The save model stays "explicit Save & Apply" because the global
 * bindings need a Tauri round-trip to re-register with the OS — a
 * silent autosave would surprise the user with a partially applied
 * change. The button bar sticks to the bottom of the scroll area
 * so it's reachable without hunting.
 */
export function ShortcutsCategory({ description }: { description?: string }) {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    ipc.getPrefs().then((p) => {
      setPrefs(p);
      setShortcuts({ ...DEFAULT_SHORTCUTS, ...(p.shortcuts ?? {}) });
    });
  }, []);

  const handleChange = (id: ShortcutId, value: string) => {
    setShortcuts((prev) => ({ ...prev, [id]: value }));
  };

  const handleReset = (id: ShortcutId) => {
    setShortcuts((prev) => ({ ...prev, [id]: DEFAULT_SHORTCUTS[id] }));
  };

  const handleResetAll = () => setShortcuts(DEFAULT_SHORTCUTS);

  /**
   * Set of shortcut ids that share their (canonicalised) chord with
   * at least one other binding. Comparison is on the canonical form
   * so `Cmd+B` and `CmdOrCtrl+B` count as the same chord even
   * though they're stored differently — otherwise the conflict
   * warning would silently miss most real conflicts on macOS.
   */
  const conflictingIds = useMemo<ReadonlySet<ShortcutId>>(() => {
    const counts = new Map<string, ShortcutId[]>();
    for (const meta of SHORTCUT_CATALOG) {
      const raw = shortcuts[meta.id] ?? meta.defaultBinding;
      const canon = canonicalizeChord(raw);
      const list = counts.get(canon);
      if (list) list.push(meta.id);
      else counts.set(canon, [meta.id]);
    }
    const out = new Set<ShortcutId>();
    for (const list of counts.values()) {
      if (list.length > 1) {
        for (const id of list) out.add(id);
      }
    }
    return out;
  }, [shortcuts]);

  const hasConflict = conflictingIds.size > 0;

  /**
   * Group catalogue items by `group`, after applying the search
   * filter. We keep groups with zero matches off the page entirely
   * (no "no results" placeholder per group) — searching by "tab"
   * shouldn't render five empty sections just to tell you they're
   * empty.
   */
  const grouped = useMemo<Record<ShortcutGroup, ShortcutMeta[]>>(() => {
    const out: Record<ShortcutGroup, ShortcutMeta[]> = {
      global: [],
      panels: [],
      service: [],
      tabs: [],
    };
    const needle = query.trim().toLowerCase();
    for (const meta of SHORTCUT_CATALOG) {
      if (needle) {
        const haystack = `${meta.label} ${meta.description} ${meta.id}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      out[meta.group].push(meta);
    }
    return out;
  }, [query]);

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
    } catch (err) {
      console.error('failed to save shortcuts', err);
    } finally {
      setSaving(false);
    }
  };

  const groupOrder: ShortcutGroup[] = ['global', 'panels', 'service', 'tabs'];
  const totalShown = groupOrder.reduce((sum, g) => sum + grouped[g].length, 0);

  // Search input + Reset All — rendered as the page toolbar by
  // `SettingsPageShell`. Lifting these out of the scrollable body
  // means the bar is opaque, fixed at the top of the pane, and
  // stratifies cleanly from the content underneath instead of
  // bleeding into it.
  const toolbar = (
    <>
      <div className="border-border bg-surface focus-within:border-accent/50 rounded-app-sm flex flex-1 items-center gap-2 border px-2.5 py-1.5 transition-colors">
        <Search className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        <input
          type="text"
          placeholder="Search shortcuts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-allow-shortcuts="false"
          className="text-fg placeholder:text-fg-dim/70 w-full bg-transparent text-[12px] outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-fg-dim hover:text-fg text-[10px] font-medium tracking-wider uppercase"
          >
            Clear
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<RotateCcw className="h-3 w-3" />}
        onClick={handleResetAll}
      >
        Reset All
      </Button>
    </>
  );

  // Footer — help text + Save & Apply. Same isolation rationale as
  // the toolbar above. The save action is the page's primary CTA
  // so it deserves a dedicated, always-reachable strip rather than
  // hiding at the bottom of a long scroll.
  const footer = (
    <>
      <p className="text-fg-dim flex-1 text-[10.5px] leading-snug">
        Global shortcuts take effect after restarting the app — they need to be re-registered with
        the OS. Window shortcuts apply immediately on save.
      </p>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void handleSave()}
        disabled={saving || hasConflict}
      >
        {saving ? 'Saving…' : 'Save & Apply'}
      </Button>
    </>
  );

  return (
    <SettingsPageShell description={description} toolbar={toolbar} footer={footer}>
      {totalShown === 0 && (
        <div className="text-fg-dim flex flex-col items-center gap-1 py-12 text-center text-[12px]">
          <span>No shortcuts match your search.</span>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-accent text-[11px] hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {groupOrder.map((group) => {
        const items = grouped[group];
        if (items.length === 0) return null;
        return (
          <SettingsSection
            key={group}
            title={SHORTCUT_GROUP_LABELS[group]}
            description={SHORTCUT_GROUP_DESCRIPTIONS[group]}
          >
            <div className="border-border/50 divide-border/40 bg-surface-raised/30 rounded-app-sm divide-y overflow-hidden border">
              {items.map((meta) => (
                <ShortcutRow
                  key={meta.id}
                  meta={meta}
                  value={normalizeShortcutForDisplay(shortcuts[meta.id] ?? meta.defaultBinding)}
                  onChange={handleChange}
                  onReset={handleReset}
                  conflict={conflictingIds.has(meta.id)}
                />
              ))}
            </div>
          </SettingsSection>
        );
      })}
    </SettingsPageShell>
  );
}

interface ShortcutRowProps {
  meta: ShortcutMeta;
  value: string;
  onChange: (id: ShortcutId, value: string) => void;
  onReset: (id: ShortcutId) => void;
  conflict?: boolean;
}

function ShortcutRow({ meta, value, onChange, onReset, conflict }: ShortcutRowProps) {
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
      const next = chordToStoredBinding(e);
      if (!next) return;
      onChange(meta.id, next);
      setRecording(false);
    },
    [recording, meta.id, onChange],
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto_180px_28px] items-center gap-3 px-3 py-2 transition',
        'hover:bg-surface-overlay/40',
      )}
    >
      <div className="min-w-0">
        <div className="text-fg truncate text-[12px] font-medium">{meta.label}</div>
        <div className="text-fg-dim mt-0.5 line-clamp-2 text-[10.5px] leading-snug">
          {meta.description}
        </div>
        {conflict && (
          <div className="text-status-error mt-1 text-[10px]">
            Same binding as another shortcut — pick a different chord so both can fire.
          </div>
        )}
      </div>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase',
          meta.scope === 'global' ? 'bg-warning/15 text-warning' : 'bg-accent/15 text-accent',
        )}
        title={
          meta.scope === 'global'
            ? 'Registered with the OS — fires from anywhere, requires an app restart to re-register.'
            : 'Window-level — fires only while the RunHQ window has focus, takes effect immediately.'
        }
      >
        {meta.scope}
      </span>
      <button
        ref={inputRef}
        type="button"
        onBlur={() => setRecording(false)}
        onClick={() => setRecording(true)}
        className={cn(
          'border-border bg-surface hover:border-border-strong rounded-app-sm h-7 w-full border px-2 text-left text-[11px] transition',
          recording && 'border-accent ring-accent/30 ring-2',
          !recording && conflict && 'border-status-error ring-status-error/30 ring-2',
        )}
      >
        {recording ? (
          <span className="text-accent text-[10.5px]">Press shortcut…</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
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
        onClick={() => onReset(meta.id)}
        className="text-fg-dim hover:text-fg rounded-app-sm hover:bg-surface-overlay/60 inline-flex h-7 w-7 items-center justify-center transition"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
