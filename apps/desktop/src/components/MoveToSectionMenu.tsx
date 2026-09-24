import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, FolderPlus, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SECTION_COLORS, sectionColor } from '@/lib/sectionColors';
import { useAppStore } from '@/store/useAppStore';
import { usePopoverPosition, useClickOutsideClose } from '@/lib/hooks';
import type { SectionColor, SectionId } from '@/types';
import { createVisibleSection } from '@/components/sidebar/sectionNavigation';

/**
 * "Move to section" popover for a service or stack row. Shows every
 * section with its color swatch plus an inline "Unassigned" choice, and a
 * quick-create footer that spawns a new section and assigns the item to
 * it in one gesture (single-step power user affordance).
 */

const POPOVER_W = 240;

interface Props {
  kind: 'service' | 'stack';
  itemId: string;
  currentSectionId: SectionId | null;
}

export function MoveToSectionMenu({ kind, itemId, currentSectionId }: Props) {
  i18n.useLocale();
  const sections = useAppStore((s) => s.sections);
  const assignService = useAppStore((s) => s.assignServiceToSection);
  const assignStack = useAppStore((s) => s.assignStackToSection);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<SectionColor>('blue');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { popoverRef, pos } = usePopoverPosition(open, triggerRef);
  useClickOutsideClose(open, [wrapRef, popoverRef], () => setOpen(false));

  // Reset the inline-create form each time the popover opens and suggest
  // the next unused palette entry so brand-new sections are visually
  // distinct from siblings without a manual pick.
  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setName('');
    const used = sections.map((s) => s.color);
    const suggestion = SECTION_COLORS.find((c) => !used.includes(c.key)) ?? SECTION_COLORS[0]!;
    setColor(suggestion.key);
  }, [open, sections]);

  useEffect(() => {
    if (creating) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [creating]);

  const assign = (sectionId: SectionId | null) => {
    if (kind === 'service') assignService(itemId, sectionId);
    else assignStack(itemId, sectionId);
    setOpen(false);
  };

  const commitCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createVisibleSection(trimmed, color, { kind, id: itemId });
    setOpen(false);
  };

  const popover = open && pos && (
    <div
      ref={popoverRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W }}
      className="border-border bg-surface-raised rounded-app-lg animate-fade-in z-[60] overflow-hidden border shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
    >
      <div className="px-3 pt-2.5 pb-1.5">
        <span className="text-fg-dim text-[9.5px] font-semibold tracking-[0.14em] uppercase">
          {i18n.t('Move to')}
        </span>
      </div>
      <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5">
        <PickerRow
          label={i18n.t('Unassigned')}
          checked={currentSectionId == null}
          leading={
            <span
              className="bg-fg-dim/30 flex h-3 w-3 items-center justify-center rounded-full"
              aria-hidden
            >
              <Minus className="text-fg-dim h-2 w-2" strokeWidth={3} />
            </span>
          }
          onClick={() => assign(null)}
        />
        {sections.map((s) => (
          <PickerRow
            key={s.id}
            label={s.name}
            checked={currentSectionId === s.id}
            leading={
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: sectionColor(s.color).solid }}
                aria-hidden
              />
            }
            onClick={() => assign(s.id)}
          />
        ))}
      </div>
      <div className="border-border/60 border-t">
        {creating ? (
          <div className="space-y-2 p-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  // Cycle the swatch — 8 options, compact chooser.
                  const i = SECTION_COLORS.findIndex((c) => c.key === color);
                  const next = SECTION_COLORS[(i + 1) % SECTION_COLORS.length]!;
                  setColor(next.key);
                }}
                title={i18n.t('Change color')}
                aria-label={i18n.t('Change color')}
                className="h-4 w-4 shrink-0 rounded-full transition hover:brightness-110"
                style={{ backgroundColor: sectionColor(color).solid }}
              />
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setCreating(false);
                  }
                }}
                placeholder={i18n.t('Section name')}
                className="border-border bg-surface rounded-app-sm focus:ring-accent/40 focus:border-accent/50 text-fg min-w-0 flex-1 border px-2 py-1 text-[11.5px] transition outline-none focus:ring-2"
              />
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-fg-muted hover:text-fg rounded-app-sm px-2 py-1 text-[11px] font-medium"
              >
                {i18n.t('Cancel')}
              </button>
              <button
                type="button"
                onClick={commitCreate}
                disabled={!name.trim()}
                className="bg-accent text-accent-fg rounded-app-sm px-2.5 py-1 text-[11px] font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18n.t('Create & move')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-fg-muted hover:bg-surface-overlay hover:text-fg flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] transition"
          >
            {i18n.rich('{value1}New section…', { value1: <FolderPlus className="h-3 w-3" /> })}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={i18n.t('Move to section')}
        title={i18n.t('Move to section')}
        className={cn(
          // Sized + toned to match `IconButton size="xs"` (h-6/w-6, svg
          // 12×12, `bg-fg/10` hover) so the move-to-section trigger
          // looks like a first-class row action, not a bolted-on trigger.
          'text-fg-muted hover:bg-fg/10 hover:text-fg rounded-app-sm inline-flex h-6 w-6 items-center justify-center transition',
          open && 'bg-fg/10 text-fg',
        )}
      >
        <FolderInput className="h-3 w-3" />
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}

function PickerRow({
  label,
  checked,
  leading,
  onClick,
}: {
  label: string;
  checked: boolean;
  leading: React.ReactNode;
  onClick: () => void;
}) {
  i18n.useLocale();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'rounded-app-sm group flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] transition',
        checked ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
      )}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && (
        <span className="text-accent text-[10px] font-semibold tracking-wide uppercase">
          {i18n.t('Current')}
        </span>
      )}
    </button>
  );
}
