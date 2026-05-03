import { Search, Settings, Sun, LayoutDashboard } from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import { broadcastTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import { modChord } from '@/lib/platform';
import type { ListItem } from '../types';

interface BuildAppActionsArgs {
  query: string;
  filter: string;
  hide: () => void;
  focusMainWindow: () => Promise<void>;
}

export function buildAppActions({
  query,
  filter,
  hide,
  focusMainWindow,
}: BuildAppActionsArgs): ListItem[] {
  const q = query.trim().toLowerCase();
  const actions = [
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
        const saved = readTheme();
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

  return actions.length > 0 && (filter === 'all' || q) ? actions : [];
}

function readTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
