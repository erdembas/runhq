import { useEffect, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  Database,
  Info,
  Keyboard,
  Settings as SettingsIcon,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppStore, type SettingsCategoryId } from '@/store/useAppStore';
import { ShortcutsCategory } from './categories/ShortcutsCategory';
import { AiCategory } from './categories/AiCategory';
import { DataCategory } from './categories/DataCategory';
import { AboutCategory } from './categories/AboutCategory';
import { DangerCategory } from './categories/DangerCategory';

export type { SettingsCategoryId };

interface CategoryDef {
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
  /**
   * Sidebar grouping. The visual divider in the sidebar maps to a
   * `group` change between consecutive entries — keeps related
   * pages clustered without a separate "section" data structure.
   */
  group: 'workspace' | 'system';
}

const CATEGORIES: ReadonlyArray<CategoryDef> = [
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Global hotkeys, panel toggles, and tab navigation.',
    icon: Keyboard,
    group: 'workspace',
  },
  {
    id: 'ai',
    label: 'AI Providers',
    description: 'Configure AI providers and per-conversation defaults.',
    icon: Bot,
    group: 'workspace',
  },
  {
    id: 'data',
    label: 'Data & Cache',
    description: 'Manage cached scan results and persisted data.',
    icon: Database,
    group: 'system',
  },
  {
    id: 'about',
    label: 'About & Updates',
    description: 'App version, release notes, and onboarding tour.',
    icon: Info,
    group: 'system',
  },
  {
    id: 'danger',
    label: 'Danger Zone',
    description: 'Destructive operations that cannot be undone.',
    icon: ShieldAlert,
    group: 'system',
  },
];

interface Props {
  /**
   * Replay the welcome tour. Callbacks live on the host (App.tsx)
   * because the tour modal is wired up there — Settings just
   * surfaces the action in the About page so the user has a single
   * "things I might want to revisit" pane.
   */
  onReplayTour?: () => void;
  /**
   * Open the (legacy) AI Provider Manager dialog. The provider CRUD
   * UI is large enough that embedding it inside Settings would
   * dwarf every other page, so we keep it as a separate modal and
   * the AI page in Settings just exposes a launcher + a quick
   * summary.
   */
  onOpenAiManager?: () => void;
}

/**
 * VS Code / Cursor-style settings hub, rendered as a *fullscreen
 * page* on the main canvas (mirroring `ReleaseNotes`) rather than a
 * modal dialog.
 *
 * Why a page and not a modal:
 *
 *   • Modals are interruption surfaces — great for "celebrate"
 *     ("you just updated, here's what's new") but actively hostile
 *     for "browse" / "configure". A dimmed overlay tells the user
 *     "you're not here to read this, you're here to dismiss it",
 *     exactly the wrong posture for a settings hub.
 *
 *   • Pages can host real density — a 220px sidebar, a wide content
 *     pane, sticky save bars, scrolling sections. The previous
 *     `1100×88vh` modal already strained the dialog metaphor.
 *
 *   • VS Code, Cursor, Linear all do this exact thing as a route
 *     instead of a popover. Following the proven pattern means
 *     users don't have to learn a one-off interaction.
 *
 * The page reads the active category and the close action straight
 * from the store; the only props are the cross-surface callbacks
 * (replay tour, open the legacy AI manager dialog) that App.tsx
 * has to wire because the targets live in *its* component tree.
 */
export function SettingsView({ onReplayTour, onOpenAiManager }: Props) {
  const active = useAppStore((s) => s.settingsCategory);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const openSettings = useAppStore((s) => s.openSettings);

  // Esc closes Settings. We listen at the window level (capture
  // phase off — body inputs should be allowed to consume Esc first
  // for things like "clear search") so Esc anywhere outside an
  // active text-edit closes the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't yank the user out of Settings while they're typing
      // in a search field or recording a shortcut chord — Esc has
      // local meaning there.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      closeSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeSettings]);

  // Defensive: if the store somehow has a null active category
  // while this component is rendered, render nothing instead of
  // crashing. App.tsx only mounts SettingsView when the category
  // is non-null so this is unreachable in practice.
  if (!active) return null;

  return (
    <div className="bg-surface flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Page header — same shape as ReleaseNotes' header. Back
          button on the left, breadcrumb in the middle, close (X)
          on the right. The X is redundant with Back but matches
          the user's expectation that "fullscreen pages have a
          close affordance in the corner". */}
      <header className="border-border bg-surface flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <button
          type="button"
          onClick={closeSettings}
          className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors"
          title="Back to dashboard"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="bg-border/70 h-4 w-px" aria-hidden />
        <div className="min-w-0">
          <span className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
            <SettingsIcon className="text-accent h-3 w-3" />
            Settings
          </span>
          <h1 className="text-fg text-[14px] leading-tight font-semibold tracking-tight">
            {currentCategory(active).label}
          </h1>
        </div>
        <button
          type="button"
          onClick={closeSettings}
          aria-label="Close settings"
          className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 ml-auto flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Body — sidebar (categories) + scrollable content. */}
      <div className="flex min-h-0 flex-1">
        <aside className="bg-surface-raised/30 border-border flex w-[240px] shrink-0 flex-col border-r">
          <div className="text-fg-dim/80 px-3 pt-3 pb-2 text-[10px] font-semibold tracking-wider uppercase">
            Categories
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            {CATEGORIES.map((cat, idx) => {
              const prev = CATEGORIES[idx - 1];
              const showDivider = prev && prev.group !== cat.group;
              return (
                <div key={cat.id}>
                  {showDivider && <div className="border-border/40 my-2 border-t" />}
                  <SidebarItem
                    icon={cat.icon}
                    label={cat.label}
                    description={cat.description}
                    active={active === cat.id}
                    onClick={() => openSettings(cat.id)}
                  />
                </div>
              );
            })}
          </nav>
        </aside>

        {/*
          Right pane is a flat flex column — *no* outer padding /
          scroll wrapper here. Each category owns its own layout
          via `SettingsPageShell`, which renders a 3-row split
          (toolbar / scrollable body / footer). That keeps toolbars
          and footers opaque, fixed, and visually distinct from the
          scrollable content underneath. The previous wrapper made
          every category share one scroll area, which forced
          ShortcutsCategory to fake a sticky toolbar with negative
          margins and translucent fills — and the seams showed.
        */}
        <section className="bg-surface flex min-w-0 flex-1 flex-col">
          {active === 'shortcuts' && (
            <ShortcutsCategory description={currentCategory(active).description} />
          )}
          {active === 'ai' && (
            <AiCategory
              description={currentCategory(active).description}
              onOpenManager={onOpenAiManager}
            />
          )}
          {active === 'data' && <DataCategory description={currentCategory(active).description} />}
          {active === 'about' && (
            <AboutCategory
              description={currentCategory(active).description}
              onReplayTour={onReplayTour}
              closeSettings={closeSettings}
            />
          )}
          {active === 'danger' && (
            <DangerCategory description={currentCategory(active).description} />
          )}
        </section>
      </div>
    </div>
  );
}

function currentCategory(id: SettingsCategoryId): CategoryDef {
  // Non-null assertion: CATEGORIES is a const array with at least
  // one entry, so the fallback always resolves to a real value.
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]!;
}

function SidebarItem({
  icon: Icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(
        'group rounded-app-sm relative flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] font-medium transition',
        active ? 'bg-accent/15 text-fg' : 'text-fg-dim hover:bg-surface-overlay/60 hover:text-fg',
      )}
    >
      {/* Left accent bar for the active row — Linear / VSCode use
          this exact pattern to make the active item read at a
          glance even when the row text colour is subtle. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1 bottom-1 left-0 w-[2px] rounded-r-full transition',
          active ? 'bg-accent' : 'bg-transparent',
        )}
      />
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          active ? 'text-accent' : 'text-fg-dim/80 group-hover:text-fg',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * Standard 3-row chrome for every Settings category.
 *
 * Layout (top → bottom):
 *
 *   ┌──────────────────────────────────────────┐
 *   │ TOOLBAR (optional)        opaque, sticky │ ← shrink-0, bg-surface-raised
 *   ├──────────────────────────────────────────┤
 *   │ description (optional)                   │ ← inside scroll, not sticky
 *   │ children (sections, tables, …)           │
 *   │ …                                        │ ← min-h-0 flex-1 overflow-y-auto
 *   ├──────────────────────────────────────────┤
 *   │ FOOTER (optional)         opaque, sticky │ ← shrink-0, bg-surface-raised
 *   └──────────────────────────────────────────┘
 *
 * Why opaque + bordered (and not translucent + sticky-inside-scroll
 * like the previous draft):
 *
 *   • A sticky bar that lives inside the scrolled content has to
 *     fight scroll painting — anything semi-transparent ends up
 *     bleeding the content underneath, which on dark themes makes
 *     the bar and the content look like the same surface.
 *   • Pulling the bar *out* of the scroll area lets it sit at full
 *     opacity with a real `border-{b,t}`, which gives the user an
 *     unambiguous "this is chrome, this is content" boundary —
 *     same shape VSCode / Cursor settings panes use.
 *
 * The inner content column is centred and capped at a comfortable
 * reading width (≈860px) so on ultra-wide windows the rows don't
 * stretch into runaway grids.
 */
export function SettingsPageShell({
  description,
  toolbar,
  footer,
  children,
}: {
  description?: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar && (
        <div className="shrink-0">
          <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-6 py-2.5">
            {toolbar}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-6 py-5">
          {description && (
            <p className="text-fg-dim mb-5 text-[12px] leading-relaxed">{description}</p>
          )}
          {children}
        </div>
      </div>

      {footer && (
        <div className="shrink-0">
          <div className="mx-auto flex w-full max-w-[860px] items-center gap-3 px-6 py-2.5">
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shared layout helper: each category content uses a vertical
 * stack of "sections", each with an optional title + description.
 * Keeps the typographic rhythm identical across every category
 * without each component re-implementing the same heading pattern.
 */
export function SettingsSection({
  title,
  description,
  trailing,
  children,
}: {
  title?: string;
  description?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      {(title || trailing) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title && (
            <h3 className="text-fg text-[12px] font-semibold tracking-wide uppercase">{title}</h3>
          )}
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
      )}
      {description && <p className="text-fg-dim mb-3 text-[11px] leading-snug">{description}</p>}
      {children}
    </section>
  );
}
