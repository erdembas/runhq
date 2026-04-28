import {
  Code2,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Play,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sun,
  TerminalSquare,
  TextSearch,
} from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import { ipc } from '@/lib/ipc';
import { broadcastTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import { localUrl } from '@/lib/url';
import { categoryForTags } from '@/lib/categories';
import { modChord } from '@/lib/platform';
import { editorBadgeLabel, visibleEditorsFor } from '@/lib/editorMeta';
import { recordActionUse, topActionKeys } from '@/lib/actionStats';
import { cn } from '@/lib/cn';
import { isRunning, type FilterMode, type ListItem, type ServiceCmd } from './types';
import type { DetectedEditor, ServiceDef, ServiceId, StackDef } from '@/types';

/**
 * Wraps an action body so its successful runs get recorded against the
 * service's stats. We record AFTER the body resolves — failures must
 * not promote dead actions to the Frequent section. The wrapper lets
 * every sub-action stay declarative without each callsite repeating the
 * "do work, then call recordActionUse" pattern.
 */
function tracked(
  serviceId: ServiceId,
  actionKey: string,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    await fn();
    recordActionUse(serviceId, actionKey);
  };
}

export interface BuildItemsDeps {
  query: string;
  filter: FilterMode;
  services: ServiceDef[];
  stacks: StackDef[];
  editors: DetectedEditor[];
  expandedService: ServiceDef | null;
  expandedStack: StackDef | null;
  /**
   * Whether the user has drilled into the editor sub-picker from inside
   * an expanded service. Mutually exclusive with `expandedStack`; only
   * meaningful while `expandedService` is non-null.
   */
  editorPickerOpen: boolean;
  toggleEditorPicker: () => void;
  getCmds: (svc: ServiceDef) => ServiceCmd[];
  hide: () => void;
  refreshStatus: (id: ServiceId) => Promise<void>;
  focusMainWindow: () => Promise<void>;
}

// Reuses the same square-badge styling EditorDropdown ships so an editor
// row in the QA palette and the sidebar dropdown look identical at a
// glance — important because users learn the "Cu" / "VS" abbreviations
// once and we don't want them re-decoding per surface.
function editorBadge(editor: Pick<DetectedEditor, 'key' | 'command'>) {
  return (
    <span
      className={cn(
        'rounded-app-sm flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[8px] font-bold',
        'bg-surface-muted text-fg-muted',
      )}
    >
      {editorBadgeLabel(editor)}
    </span>
  );
}

export function buildItems(deps: BuildItemsDeps): ListItem[] {
  const {
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
  } = deps;

  const q = query.trim().toLowerCase();
  const result: ListItem[] = [];

  if (expandedService) {
    const svc = expandedService;
    const cmds = getCmds(svc);
    const anyRunning = cmds.some((c) => isRunning(c.status));
    const editorsForSvc = visibleEditorsFor(editors, svc.cmds);

    result.push({ type: 'expanded-header', service: svc, cmds });

    const subActions: ListItem[] = [];
    subActions.push({
      type: 'sub-action',
      serviceId: svc.id,
      label: anyRunning ? 'Stop All' : 'Start All',
      icon: anyRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />,
      danger: anyRunning,
      // Start and Stop share a key on purpose: from the user's POV
      // they're one slot ("toggle the service"), and tracking them
      // separately would split the count and starve the Frequent
      // section of an obviously-frequent action.
      actionKey: 'start-stop-all',
      run: tracked(svc.id, 'start-stop-all', async () => {
        if (anyRunning) await ipc.stopService(svc.id);
        else await ipc.startService(svc.id);
        await refreshStatus(svc.id);
      }),
    });
    subActions.push({
      type: 'sub-action',
      serviceId: svc.id,
      label: 'Restart All',
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      actionKey: 'restart-all',
      run: tracked(svc.id, 'restart-all', async () => {
        await ipc.restartService(svc.id);
        await refreshStatus(svc.id);
      }),
    });
    subActions.push({
      type: 'sub-action',
      serviceId: svc.id,
      label: 'Show in RunHQ',
      icon: <TextSearch className="h-3.5 w-3.5" />,
      actionKey: 'show-in-runhq',
      run: tracked(svc.id, 'show-in-runhq', async () => {
        await focusMainWindow();
        await emit('quick-action://navigate', { serviceId: svc.id });
        hide();
      }),
    });
    if (svc.port != null) {
      subActions.push({
        type: 'sub-action',
        serviceId: svc.id,
        label: `Open localhost:${svc.port}`,
        subtitle: localUrl(svc.port!),
        icon: <Globe className="h-3.5 w-3.5" />,
        actionKey: 'open-localhost',
        run: tracked(svc.id, 'open-localhost', async () => {
          await ipc.openUrl(localUrl(svc.port!));
          hide();
        }),
      });
    }
    // Surface detected IDEs without bloating the action sheet:
    //
    // - 0 editors detected → no row (keep the palette honest; we never
    //   want a dead "Open in IDE" entry that expands to nothing).
    // - 1 editor → single direct row. An expander would force a
    //   pointless second keypress for the overwhelmingly common
    //   single-IDE user.
    // - 2+ editors → single "Open in IDE" row that expands inline,
    //   nesting the editor rows immediately below it. Inline keeps the
    //   user on the same screen (Raycast/Linear pattern) instead of
    //   forcing a second page transition.
    // Helper: build a fully-formed (top-level, non-nested) editor row.
    // Used both for the single-editor direct row and as the synthesizer
    // when an `open-editor:<key>` shows up in Frequent — we always need
    // to be able to render it regardless of whether the picker happens
    // to be expanded.
    const makeEditorRow = (editor: DetectedEditor, opts: { nested?: boolean } = {}): ListItem => ({
      type: 'sub-action',
      serviceId: svc.id,
      label: `Open in ${editor.name}`,
      subtitle: svc.cwd,
      icon: editorBadge(editor),
      nested: opts.nested,
      actionKey: `open-editor:${editor.key}`,
      run: tracked(svc.id, `open-editor:${editor.key}`, async () => {
        await ipc.openInEditor(editor.command, svc.cwd);
        hide();
      }),
    });

    if (editorsForSvc.length === 1) {
      subActions.push(makeEditorRow(editorsForSvc[0]!));
    } else if (editorsForSvc.length > 1) {
      // Inline-expandable parent. Pressing Enter (or clicking) toggles
      // the picker open without leaving the current screen — Raycast /
      // Linear-style nested actions, which keep the user oriented in
      // the same context instead of drilling into a fresh page.
      subActions.push({
        type: 'sub-action',
        serviceId: svc.id,
        label: 'Open in IDE',
        // Comma-list when collapsed gives a one-glance confirmation that
        // the user's editor is in there. When expanded the same data is
        // visible as rows below, so we drop it to avoid duplication.
        subtitle: editorPickerOpen ? undefined : editorsForSvc.map((e) => e.name).join(' · '),
        icon: <Code2 className="h-3.5 w-3.5" />,
        expandable: true,
        expanded: editorPickerOpen,
        // No `actionKey` — the expander toggles UI state, never commits
        // a real action, so it must not be a Frequent candidate.
        run: async () => {
          toggleEditorPicker();
        },
      });

      // Splice the actual editor rows immediately after the parent so
      // they read as nested children. `nested: true` triggers the
      // deeper indent + guide line in the renderer.
      if (editorPickerOpen) {
        for (const editor of editorsForSvc) {
          subActions.push(makeEditorRow(editor, { nested: true }));
        }
      }
    }
    subActions.push({
      type: 'sub-action',
      serviceId: svc.id,
      label: 'Open in Finder',
      subtitle: svc.cwd,
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      actionKey: 'open-finder',
      run: tracked(svc.id, 'open-finder', async () => {
        await ipc.openPath(svc.cwd);
        hide();
      }),
    });
    subActions.push({
      type: 'sub-action',
      serviceId: svc.id,
      label: 'Open Terminal',
      subtitle: svc.cwd,
      icon: <TerminalSquare className="h-3.5 w-3.5" />,
      actionKey: 'open-terminal',
      run: tracked(svc.id, 'open-terminal', async () => {
        await focusMainWindow();
        await emit('quick-action://navigate', { serviceId: svc.id, openTerminal: true });
        hide();
      }),
    });

    // ---- Frequent section ----
    //
    // Pull up to 3 most-used actions for THIS service. We resolve each
    // top key to a fully-rendered row so the Frequent section behaves
    // like a flat shortcut list — even if the canonical row currently
    // lives inside the IDE expander or wasn't yet built (multi-editor
    // case with picker collapsed). Rows promoted here are deduped from
    // the main list so the user sees each action exactly once.
    //
    // Editors are *not* deduped from the IDE expander itself: if the
    // user has 4 IDEs and Cursor is their favorite, Cursor stays in
    // the expander too — the expander is the "give me a different
    // editor" surface, and removing a single child would make it feel
    // like an item went missing.
    const recentItems: ListItem[] = [];
    const dedupeKeys = new Set<string>();
    const dedupeCmdNames = new Set<string>();
    for (const key of topActionKeys(svc.id)) {
      if (key.startsWith('open-editor:')) {
        const editorKey = key.slice('open-editor:'.length);
        const editor = editorsForSvc.find((e) => e.key === editorKey);
        if (!editor) continue;
        recentItems.push(makeEditorRow(editor));
        // Only dedupe the main list when there's a matching top-level
        // row to remove (i.e. the single-editor case). For 2+ editors
        // the canonical row is nested and the expander stays intact.
        if (editorsForSvc.length === 1) dedupeKeys.add(key);
      } else if (key.startsWith('cmd:')) {
        // Promote frequently-run scripts (yarn dev, yarn build, …)
        // alongside the standard sub-actions. The bottom "Commands"
        // section below dedupes via `dedupeCmdNames` so the user sees
        // the script in exactly one place.
        const cmdName = key.slice('cmd:'.length);
        const found = cmds.find((c) => c.name === cmdName);
        if (!found) continue;
        recentItems.push({ type: 'expanded-cmd', serviceId: svc.id, cmd: found });
        dedupeCmdNames.add(cmdName);
      } else {
        const found = subActions.find(
          (a) => a.type === 'sub-action' && !a.nested && a.actionKey === key,
        );
        if (found) {
          recentItems.push(found);
          dedupeKeys.add(key);
        }
      }
    }

    const mainSubActions = subActions.filter((a) => {
      if (a.type !== 'sub-action') return true;
      if (!a.actionKey) return true;
      return !dedupeKeys.has(a.actionKey);
    });

    // Filter helper that also passes through `expanded-cmd` rows in the
    // Frequent group (those don't have a `label` — match against the
    // script name + command string instead, mirroring the bottom-list
    // search behaviour).
    const matchesQuery = (item: ListItem): boolean => {
      if (!q) return true;
      if (item.type === 'sub-action') return item.label.toLowerCase().includes(q);
      if (item.type === 'expanded-cmd') {
        return item.cmd.name.toLowerCase().includes(q) || item.cmd.cmd.toLowerCase().includes(q);
      }
      return true;
    };
    const filteredRecent = recentItems.filter(matchesQuery);
    const filteredMain = mainSubActions.filter((a) => a.type === 'sub-action' && matchesQuery(a));

    if (filteredRecent.length > 0) {
      result.push({ type: 'header', label: 'Frequent' });
      result.push(...filteredRecent);
    }
    result.push(...filteredMain);

    const cmdsForBottomList = cmds.filter((c) => !dedupeCmdNames.has(c.name));
    const filteredCmds = q
      ? cmdsForBottomList.filter(
          (c) => c.name.toLowerCase().includes(q) || c.cmd.toLowerCase().includes(q),
        )
      : cmdsForBottomList;
    if (filteredCmds.length > 0) {
      result.push({ type: 'cmd-header' });
      for (const cmd of filteredCmds) {
        result.push({ type: 'expanded-cmd', serviceId: svc.id, cmd });
      }
    }
    return result;
  }

  if (expandedStack) {
    const stack = expandedStack;
    const stackServices = stack.service_ids
      .map((sid) => services.find((s) => s.id === sid))
      .filter(Boolean) as ServiceDef[];
    const cmdsPerService: Record<ServiceId, ServiceCmd[]> = {};
    let stackRunning = 0;
    for (const svc of stackServices) {
      const cmds = getCmds(svc);
      cmdsPerService[svc.id] = cmds;
      if (cmds.some((c) => isRunning(c.status))) stackRunning++;
    }
    const anyRunning = stackRunning > 0;

    result.push({
      type: 'expanded-stack',
      stack,
      services: stackServices,
      cmdsPerService,
    });

    const stackActions: ListItem[] = [
      {
        type: 'stack-action',
        stackId: stack.id,
        label: anyRunning ? 'Stop All' : 'Start All',
        icon: anyRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />,
        danger: anyRunning,
        run: async () => {
          if (anyRunning) await ipc.stopStack(stack.id);
          else await ipc.startStack(stack.id);
        },
      },
      {
        type: 'stack-action',
        stackId: stack.id,
        label: 'Restart All',
        icon: <RotateCcw className="h-3.5 w-3.5" />,
        run: async () => {
          await ipc.restartStack(stack.id);
        },
      },
    ];

    const svcRows: ListItem[] = stackServices.map((svc) => {
      const cmds = cmdsPerService[svc.id] ?? [];
      const svcRunning = cmds.some((c) => isRunning(c.status));
      return {
        type: 'sub-action',
        serviceId: svc.id,
        label: svc.name,
        icon: svcRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />,
        danger: svcRunning,
        run: async () => {
          if (svcRunning) await ipc.stopService(svc.id);
          else await ipc.startService(svc.id);
        },
      };
    });

    const all = [...stackActions, ...svcRows];
    const filtered = q
      ? all.filter((a) => {
          if (a.type === 'stack-action') return a.label.toLowerCase().includes(q);
          if (a.type === 'sub-action') return a.label.toLowerCase().includes(q);
          return true;
        })
      : all;
    result.push(...filtered);
    return result;
  }

  const appActions = [
    {
      type: 'app-action' as const,
      id: 'open-app',
      label: 'Open RunHQ',
      subtitle: 'Show the main application window',
      shortcut: modChord('1'),
      icon: <LayoutDashboard className="h-4 w-4" />,
      run: async () => {
        await focusMainWindow();
        hide();
      },
    },
    {
      type: 'app-action' as const,
      id: 'scan',
      label: 'Scan for Projects',
      subtitle: 'Find and add services from a directory',
      shortcut: modChord('2'),
      icon: <Search className="h-4 w-4" />,
      run: async () => {
        await focusMainWindow();
        await emit('quick-action://scan');
        hide();
      },
    },
    {
      type: 'app-action' as const,
      id: 'toggle-theme',
      label: 'Toggle Theme',
      subtitle: 'Switch between light and dark mode',
      shortcut: modChord('3'),
      icon: <Sun className="h-4 w-4" />,
      run: async () => {
        const saved = (() => {
          try {
            return localStorage.getItem(THEME_STORAGE_KEY);
          } catch {
            return null;
          }
        })();
        const next: Theme =
          saved === 'dark'
            ? 'light'
            : saved === 'light'
              ? 'dark'
              : document.documentElement.classList.contains('dark')
                ? 'light'
                : 'dark';
        await broadcastTheme(next);
      },
    },
    {
      type: 'app-action' as const,
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      subtitle: 'Configure global shortcuts',
      shortcut: modChord('4'),
      icon: <Settings className="h-4 w-4" />,
      run: async () => {
        await focusMainWindow();
        await emit('quick-action://shortcuts');
        hide();
      },
    },
  ].filter((a) => !q || a.label.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q));

  if (appActions.length > 0 && (filter === 'all' || q)) {
    result.push(...appActions);
  }

  if (filter === 'all' || filter === 'running' || filter === 'stopped') {
    const stackItems: ListItem[] = [];
    for (const stack of stacks) {
      let stackRunning = 0;
      const stackServices = stack.service_ids
        .map((sid) => services.find((s) => s.id === sid))
        .filter(Boolean) as ServiceDef[];
      for (const svc of stackServices) {
        const cmds = getCmds(svc);
        if (cmds.some((c) => isRunning(c.status))) stackRunning++;
      }
      if (filter === 'running' && stackRunning === 0) continue;
      if (filter === 'stopped' && stackRunning > 0) continue;

      const nameMatches = !q || stack.name.toLowerCase().includes(q);
      if (!nameMatches) continue;

      stackItems.push({ type: 'stack', stack, runningCount: stackRunning });
    }
    if (stackItems.length > 0) {
      result.push({ type: 'header', label: 'Stacks' });
      result.push(...stackItems);
    }
  }

  const svcItems: ListItem[] = [];
  for (const svc of services) {
    const cmds = getCmds(svc);
    const anyRunning = cmds.some((c) => isRunning(c.status));

    if (filter === 'running' && !anyRunning) continue;
    if (filter === 'stopped' && anyRunning) continue;
    if (filter !== 'all' && filter !== 'running' && filter !== 'stopped') {
      const cat = categoryForTags(svc.tags);
      if (cat.key !== filter) continue;
    }

    const svcMatches =
      !q || svc.name.toLowerCase().includes(q) || svc.tags.some((t) => t.toLowerCase().includes(q));

    if (!svcMatches && q) {
      for (const cmd of cmds) {
        if (cmd.name.toLowerCase().includes(q) || cmd.cmd.toLowerCase().includes(q)) {
          svcItems.push({
            type: 'cmd',
            serviceId: svc.id,
            serviceName: svc.name,
            cmdName: cmd.name,
            cmd: cmd.cmd,
            status: cmd.status,
          });
        }
      }
      continue;
    }

    svcItems.push({ type: 'service', service: svc, cmds });
  }

  if (svcItems.length > 0) {
    result.push({ type: 'header', label: 'Services' });
    result.push(...svcItems);
  }

  return result;
}
