import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSyncedTheme } from '@/lib/theme';
import { ipc } from '@/lib/ipc';
import { recordActionUse } from '@/lib/actionStats';
import type {
  CommandStatus,
  DetectedEditor,
  ServiceDef,
  ServiceId,
  StackDef,
  Status,
} from '@/types';
import { isRunning, isSelectable, type FilterMode, type ListItem, type ServiceCmd } from './types';
import { fetchStatus, focusMainWindow } from './hooks';
import { buildItems } from './items';
import type { RenderRowDeps } from './renderers';
import { QUICK_ACTION_FILTERS } from './filterModes';
import { QuickActionFilterBar } from './QuickActionFilterBar';
import { QuickActionFooter } from './QuickActionFooter';
import { QuickActionHeader } from './QuickActionHeader';
import { QuickActionList } from './QuickActionList';
import { useQuickActionBootstrap } from './useQuickActionBootstrap';

export function QuickActionBar() {
  useSyncedTheme();

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [stacks, setStacks] = useState<StackDef[]>([]);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [cmdStatuses, setCmdStatuses] = useState<Record<ServiceId, CommandStatus[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Sub-drill inside an expanded service's action sheet: when true, the
  // list collapses to just the "Open in <Editor>" rows so the palette
  // stays short. Reset whenever the parent drill changes — see the effect
  // below — so backing out always lands on a clean state.
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useQuickActionBootstrap({
    inputRef,
    services,
    setServices,
    setStacks,
    setEditors,
    setCmdStatuses,
  });

  useEffect(() => {
    setCursor(0);
  }, [query, filter]);

  useEffect(() => {
    scrollRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const hide = useCallback(() => {
    getCurrentWindow().hide();
    setQuery('');
    setCursor(0);
    setFilter('all');
    setExpandedId(null);
    setEditorPickerOpen(false);
  }, []);

  // Close the editor sub-drill whenever the parent expand changes (user
  // backed out, picked a different service, etc.). Without this the picker
  // would silently "stick" to the next service the user expands.
  useEffect(() => {
    setEditorPickerOpen(false);
  }, [expandedId]);

  const refreshStatus = useCallback(async (id: ServiceId) => {
    try {
      const cmds = await fetchStatus(id);
      setCmdStatuses((prev) => ({ ...prev, [id]: cmds }));
    } catch {
      // non-critical: status fetch best-effort
    }
  }, []);

  const getCmds = useCallback(
    (svc: ServiceDef): ServiceCmd[] =>
      svc.cmds.map((c) => {
        const cs = (cmdStatuses[svc.id] ?? []).find((s) => s.name === c.name);
        return { name: c.name, cmd: c.cmd, status: (cs?.status ?? 'stopped') as Status };
      }),
    [cmdStatuses],
  );

  const expandedService = useMemo(() => {
    if (!expandedId || expandedId.startsWith('stack:')) return null;
    return services.find((s) => s.id === expandedId) ?? null;
  }, [expandedId, services]);

  const expandedStack = useMemo(() => {
    if (!expandedId || !expandedId.startsWith('stack:')) return null;
    const sid = expandedId.slice('stack:'.length);
    return stacks.find((s) => s.id === sid) ?? null;
  }, [expandedId, stacks]);

  const toggleEditorPicker = useCallback(() => setEditorPickerOpen((prev) => !prev), []);

  const items = useMemo<ListItem[]>(
    () =>
      buildItems({
        query,
        filter,
        services,
        stacks,
        editors,
        expandedService,
        expandedStack,
        editorPickerOpen,
        toggleEditorPicker,
        getCmds,
        hide,
        refreshStatus,
        focusMainWindow,
      }),
    [
      services,
      stacks,
      editors,
      query,
      filter,
      expandedService,
      expandedStack,
      editorPickerOpen,
      toggleEditorPicker,
      getCmds,
      hide,
      refreshStatus,
    ],
  );

  useEffect(() => {
    if (expandedService || expandedStack) {
      setQuery('');
    }
  }, [expandedService, expandedStack]);

  useEffect(() => {
    if (items.length === 0) return;
    const current = items[cursor];
    if (isSelectable(current)) return;
    for (let n = cursor + 1; n < items.length; n++) {
      if (isSelectable(items[n])) {
        setCursor(n);
        return;
      }
    }
    for (let n = cursor - 1; n >= 0; n--) {
      if (isSelectable(items[n])) {
        setCursor(n);
        return;
      }
    }
  }, [items, cursor]);

  const execute = useCallback(
    async (item: ListItem) => {
      switch (item.type) {
        case 'service':
          setExpandedId(item.service.id);
          break;
        case 'stack':
          setExpandedId(`stack:${item.stack.id}`);
          break;
        case 'expanded-stack':
          setExpandedId(null);
          break;
        case 'stack-action':
          await item.run();
          break;
        case 'expanded-header':
          setExpandedId(null);
          break;
        case 'expanded-cmd':
          if (isRunning(item.cmd.status)) {
            await ipc.stopServiceCmd(item.serviceId, item.cmd.name);
          } else {
            await ipc.startServiceCmd(item.serviceId, item.cmd.name);
          }
          await refreshStatus(item.serviceId);
          // Track start AND stop under the same key — from a usage POV
          // the user "interacts with this script", and splitting would
          // halve the count for any cmd they cycle frequently.
          recordActionUse(item.serviceId, `cmd:${item.cmd.name}`);
          break;
        case 'cmd':
          if (isRunning(item.status)) {
            await ipc.stopServiceCmd(item.serviceId, item.cmdName);
          } else {
            await ipc.startServiceCmd(item.serviceId, item.cmdName);
          }
          await refreshStatus(item.serviceId);
          recordActionUse(item.serviceId, `cmd:${item.cmdName}`);
          break;
        case 'sub-action':
          await item.run();
          break;
        case 'app-action':
          await item.run();
          break;
      }
    },
    [refreshStatus],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Accept either Cmd (macOS) or Ctrl (Windows/Linux) as the modifier so
    // the `⌘1…⌘4` / `Ctrl+1…Ctrl+4` affordance shown in the list actually
    // triggers on every platform — previously this was macOS-only and the
    // labels were misleading on Windows/Linux.
    if ((e.metaKey || e.ctrlKey) && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      const action = items.find(
        (it): it is Extract<typeof it, { type: 'app-action' }> =>
          it.type === 'app-action' &&
          it.id === ['open-app', 'scan', 'toggle-theme', 'shortcuts'][Number(e.key) - 1],
      );
      if (action) execute(action);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editorPickerOpen) {
        setEditorPickerOpen(false);
        return;
      }
      if (expandedId) {
        setExpandedId(null);
        return;
      }
      if (filter !== 'all') {
        setFilter('all');
        return;
      }
      hide();
      return;
    }
    if (e.key === 'Backspace' && (editorPickerOpen || expandedId) && query === '') {
      e.preventDefault();
      if (editorPickerOpen) setEditorPickerOpen(false);
      else setExpandedId(null);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => {
        for (let n = i + 1; n < items.length; n++) {
          if (isSelectable(items[n])) return n;
        }
        return i;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => {
        for (let n = i - 1; n >= 0; n--) {
          if (isSelectable(items[n])) return n;
        }
        return i;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = items[cursor];
      if (item?.type === 'service') {
        setExpandedId(item.service.id);
      } else if (item?.type === 'stack') {
        setExpandedId(`stack:${item.stack.id}`);
      } else if (item?.type === 'sub-action' && item.expandable) {
        if (!item.expanded) {
          // → on a collapsed expandable row expands without committing,
          // letting users peek at the children before deciding. Enter
          // remains the explicit "do something" key.
          execute(item);
        } else {
          // → on an already-expanded parent dives into its first
          // nested child (Finder list view convention). Without this
          // the key is a dead no-op for repeat presses, which feels
          // broken.
          for (let n = cursor + 1; n < items.length; n++) {
            const next = items[n];
            if (!next) break;
            if (next.type === 'sub-action' && next.nested) {
              setCursor(n);
              break;
            }
            if (next.type === 'sub-action' && !next.nested) break;
          }
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const item = items[cursor];
      if (editorPickerOpen) {
        // If the cursor sits inside the expanded list, snap it back to
        // the parent before collapsing so it doesn't get stranded on
        // the next unrelated sibling (e.g. landing on "Open in Finder"
        // when the user just wanted to back out of the IDE picker).
        if (item?.type === 'sub-action' && item.nested) {
          for (let n = cursor - 1; n >= 0; n--) {
            const candidate = items[n];
            if (!candidate) break;
            if (candidate.type === 'sub-action' && candidate.expandable) {
              setCursor(n);
              break;
            }
          }
        }
        setEditorPickerOpen(false);
      } else if (expandedId) {
        setExpandedId(null);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[cursor];
      if (item && item.type !== 'header' && item.type !== 'cmd-header') execute(item);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setFilter((f) => {
        const modes: FilterMode[] = QUICK_ACTION_FILTERS.map((item) => item.key);
        const idx = modes.indexOf(f);
        const delta = e.shiftKey ? -1 : 1;
        const next = (idx + delta + modes.length) % modes.length;
        return modes[next]!;
      });
    }
  };

  const renderRowDeps: RenderRowDeps = {
    cursor,
    execute,
    setCursor,
    setExpandedId,
    refreshStatus,
  };

  const drillName = expandedService?.name ?? expandedStack?.name ?? null;
  const inDrill = Boolean(drillName);

  return (
    <div
      className="pointer-events-auto flex h-screen w-screen items-center justify-center pb-[8vh]"
      onClick={hide}
    >
      <div
        className="quick-action-panel animate-fade-in pointer-events-auto flex w-[620px] flex-col overflow-hidden"
        style={{ maxHeight: 'min(520px, 78vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <QuickActionHeader
          inDrill={inDrill}
          drillName={drillName}
          query={query}
          inputRef={inputRef}
          onQueryChange={setQuery}
          onKeyDown={handleKeyDown}
          onBack={() => setExpandedId(null)}
        />

        {!inDrill && (
          <QuickActionFilterBar
            active={filter}
            onChange={(next) => {
              setFilter(next);
              setCursor(0);
            }}
          />
        )}

        <QuickActionList
          scrollRef={scrollRef}
          items={items}
          inDrill={inDrill}
          services={services}
          renderRowDeps={renderRowDeps}
        />

        <QuickActionFooter inDrill={inDrill} />
      </div>
    </div>
  );
}
