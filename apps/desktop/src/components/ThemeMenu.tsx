import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme, type Theme } from '@/lib/theme';
import { ipc } from '@/lib/ipc';

/**
 * Compact theme switcher for the status bar: single icon-only trigger that
 * opens a small popover with Light / Dark / System. The trigger's icon
 * reflects the **current selection** (not effective), so `System` shows
 * a monitor even in dark mode — matching Slack / Linear / Notion.
 */
const OPTIONS: Array<{ key: Theme; icon: React.ReactNode; label: string; hint: string }> = [
  {
    key: 'light',
    icon: <Sun className="h-3.5 w-3.5" />,
    get label() {
      return i18n.t('Light');
    },
    get hint() {
      return i18n.t('Bright UI');
    },
  },
  {
    key: 'dark',
    icon: <Moon className="h-3.5 w-3.5" />,
    get label() {
      return i18n.t('Dark');
    },
    get hint() {
      return i18n.t('Dim UI');
    },
  },
  {
    key: 'system',
    icon: <Monitor className="h-3.5 w-3.5" />,
    get label() {
      return i18n.t('System');
    },
    get hint() {
      return i18n.t('Follow OS');
    },
  },
];

const ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun className="h-3 w-3" />,
  dark: <Moon className="h-3 w-3" />,
  system: <Monitor className="h-3 w-3" />,
};

export function ThemeMenu() {
  i18n.useLocale();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={i18n.t('Theme: {theme}', { theme: theme })}
        className={cn(
          'rounded-app-sm hover:bg-surface-overlay hover:text-fg flex items-center gap-1.5 px-1.5 py-1 transition',
          open ? 'bg-surface-overlay text-fg' : 'text-fg-muted',
        )}
      >
        {ICONS[theme]}
        <span className="text-fg-dim text-[11px] capitalize">{theme}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="border-border bg-surface-raised rounded-app-sm animate-fade-in absolute right-0 bottom-full z-50 mb-1.5 w-[160px] overflow-hidden border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          {OPTIONS.map((opt) => {
            const active = theme === opt.key;
            return (
              <button
                key={opt.key}
                role="menuitemradio"
                aria-checked={active}
                type="button"
                onClick={() => {
                  setTheme(opt.key);
                  void ipc.updatePrefs({ theme: opt.key }).catch(() => {});
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition',
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
                )}
              >
                <span className={cn(active ? 'text-accent' : 'text-fg-dim')}>{opt.icon}</span>
                <span className="flex-1 font-medium">{opt.label}</span>
                <span className="text-fg-dim text-[10px]">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
