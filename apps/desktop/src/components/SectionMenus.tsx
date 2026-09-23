import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { SECTION_COLORS, sectionColor } from '@/lib/sectionColors';
import { usePopoverPosition, useClickOutsideClose } from '@/lib/hooks';
import { useAppStore } from '@/store/useAppStore';
import type { Section, SectionColor } from '@/types';

const POPOVER_W = 260;

function ColorSwatchGrid({
  value,
  onPick,
}: {
  value: SectionColor;
  onPick: (c: SectionColor) => void;
}) {
  i18n.useLocale();
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {SECTION_COLORS.map((c) => {
        const active = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick(c.key)}
            title={c.label}
            aria-label={c.label}
            className={cn(
              'relative flex h-5 w-5 items-center justify-center rounded-full transition',
              active && 'ring-2 ring-offset-2 ring-offset-[rgb(var(--surface-raised))]',
            )}
            style={
              active
                ? { backgroundColor: c.solid, boxShadow: `0 0 0 1.5px ${c.solid}` }
                : { backgroundColor: c.solid }
            }
          >
            {active && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Add section ─────────────────────────────────────────────────────────────

/**
 * Inline trigger + portaled popover that creates a new section. The caller
 * controls the visual of the trigger via `children` (defaults to a plain
 * "+ Section" button suited to a section list header).
 */
export function AddSectionButton({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  i18n.useLocale();
  const addSection = useAppStore((s) => s.addSection);
  const sections = useAppStore((s) => s.sections);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<SectionColor>('blue');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { popoverRef, pos } = usePopoverPosition(open, triggerRef);
  useClickOutsideClose(open, [wrapRef, popoverRef], () => setOpen(false));

  // Suggest the next unused palette entry each time the popover opens so the
  // new section stands out from siblings without requiring a manual pick.
  useEffect(() => {
    if (!open) return;
    setName('');
    const used = sections.map((s) => s.color);
    const suggestion = SECTION_COLORS.find((c) => !used.includes(c.key)) ?? SECTION_COLORS[0]!;
    setColor(suggestion.key);
    // Focus the name input once the popover mounts.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, sections]);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addSection(trimmed, color);
    setOpen(false);
  };

  const popover = open && pos && (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={i18n.t('New section')}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W }}
      className="border-border bg-surface-raised rounded-app-lg animate-fade-in z-[60] border p-3 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-4 w-4 rounded-full"
          style={{ backgroundColor: sectionColor(color).solid }}
          aria-hidden
        />
        <span className="text-fg text-[11.5px] font-semibold">{i18n.t('New section')}</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={i18n.t('e.g. Clients')}
        className="border-border bg-surface rounded-app-sm focus:ring-accent/40 focus:border-accent/50 text-fg w-full border px-2 py-1.5 text-[12px] transition outline-none focus:ring-2"
      />
      <div className="mt-2.5">
        <div className="text-fg-dim mb-1.5 text-[9.5px] font-semibold tracking-[0.14em] uppercase">
          {i18n.t('Color')}
        </div>
        <ColorSwatchGrid value={color} onPick={setColor} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-fg-muted hover:text-fg rounded-app-sm px-2 py-1 text-[11px] font-medium transition"
        >
          {i18n.t('Cancel')}
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={!name.trim()}
          className="bg-accent text-accent-fg rounded-app-sm px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {i18n.t('Create')}
        </button>
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={i18n.t('New section')}
        title={i18n.t('New section')}
        className={cn(
          'text-fg-muted hover:bg-surface-overlay hover:text-fg rounded-app-sm inline-flex items-center gap-1 px-1.5 py-1 text-[10.5px] font-medium transition',
          open && 'bg-surface-overlay text-fg',
          className,
        )}
      >
        {children ?? (
          <>
            <FolderPlus className="h-3 w-3" />
            <span>{i18n.t('Section')}</span>
          </>
        )}
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}

// ─── Edit section ────────────────────────────────────────────────────────────

/**
 * Overflow trigger for an existing section — opens a popover with rename,
 * recolor and delete. Rendered inline inside the section header.
 */
export function SectionOverflowMenu({ section }: { section: Section }) {
  i18n.useLocale();
  const renameSection = useAppStore((s) => s.renameSection);
  const recolorSection = useAppStore((s) => s.recolorSection);
  const deleteSection = useAppStore((s) => s.deleteSection);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(section.name);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const { popoverRef, pos } = usePopoverPosition(open, triggerRef);
  useClickOutsideClose(open, [wrapRef, popoverRef], () => setOpen(false));

  useEffect(() => {
    if (open) {
      setRenaming(false);
      setNameDraft(section.name);
    }
  }, [open, section.name]);

  useEffect(() => {
    if (renaming) {
      const t = setTimeout(() => renameInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [renaming]);

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== section.name) renameSection(section.id, trimmed);
    setRenaming(false);
    setOpen(false);
  };

  const onDelete = () => {
    // Close the overflow popover so the confirm dialog owns the focus layer
    // alone — keeps the modal decision unambiguous and avoids stacking two
    // overlapping surfaces.
    setOpen(false);
    setPendingConfirm({
      message: i18n.t(
        'Delete section "{value1}"?\n\nItems inside will move to "Unassigned" — services and stacks are not deleted.',
        { value1: section.name },
      ),
      onConfirm: () => {
        setPendingConfirm(null);
        deleteSection(section.id);
      },
    });
  };

  const popover = open && pos && (
    <div
      ref={popoverRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W }}
      className="border-border bg-surface-raised rounded-app-lg animate-fade-in z-[60] overflow-hidden border shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
    >
      {renaming ? (
        <div className="p-3">
          <div className="text-fg-dim mb-1.5 text-[9.5px] font-semibold tracking-[0.14em] uppercase">
            {i18n.t('Rename')}
          </div>
          <input
            ref={renameInputRef}
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(false);
              }
            }}
            className="border-border bg-surface rounded-app-sm focus:ring-accent/40 focus:border-accent/50 text-fg w-full border px-2 py-1.5 text-[12px] transition outline-none focus:ring-2"
          />
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="text-fg-muted hover:text-fg rounded-app-sm px-2 py-1 text-[11px] font-medium"
            >
              {i18n.t('Cancel')}
            </button>
            <button
              type="button"
              onClick={commitRename}
              className="bg-accent text-accent-fg rounded-app-sm px-2.5 py-1 text-[11px] font-semibold hover:brightness-110"
            >
              {i18n.t('Save')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="p-3">
            <div className="text-fg-dim mb-1.5 text-[9.5px] font-semibold tracking-[0.14em] uppercase">
              {i18n.t('Color')}
            </div>
            <ColorSwatchGrid value={section.color} onPick={(c) => recolorSection(section.id, c)} />
          </div>
          <div className="border-border/60 border-t py-1">
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="text-fg hover:bg-surface-overlay flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition"
            >
              {i18n.rich('{value1}Rename', { value1: <Pencil className="h-3 w-3" /> })}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-status-error hover:bg-status-error/10 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition"
            >
              {i18n.rich('{value1}Delete section', { value1: <Trash2 className="h-3 w-3" /> })}
            </button>
          </div>
        </>
      )}
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
        aria-label={i18n.t('Section options for {value1}', { value1: section.name })}
        title={i18n.t('Section options')}
        className={cn(
          // Exact twin of the sibling count badge: shared chip geometry
          // (h-[18px] min-w-[22px] px-1) + matching text metrics. We
          // switched from a custom SVG to the Unicode midline ellipsis
          // "⋯" on purpose — the SVG centred on its geometric bounding
          // box while the digit next to it centred on font baseline, so
          // the two never lined up pixel-for-pixel no matter how much
          // we fiddled with `leading-none` and `items-center`. Using a
          // glyph from the same font in the same 10px size makes both
          // chips obey identical typographic rules → they render as
          // true visual twins.
          'bg-surface-muted text-fg-dim hover:bg-surface-overlay hover:text-fg rounded-app-sm inline-flex h-[18px] min-w-[22px] items-center justify-center px-1 text-[10px] leading-none font-bold transition',
          open && 'bg-surface-overlay text-fg',
        )}
      >
        <span aria-hidden className="-mt-px tracking-wider">
          ⋯
        </span>
      </button>
      {popover && createPortal(popover, document.body)}
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
