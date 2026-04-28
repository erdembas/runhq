import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Code2, FolderOpen } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { editorBadgeLabel, visibleEditorsFor } from '@/lib/editorMeta';
import type { CommandEntry } from '@/types';

// Detect the host OS once so we can label the reveal-folder row using the
// platform-native vocabulary ("Finder" on macOS, "Explorer" on Windows,
// "file manager" elsewhere). `navigator.platform` is deprecated but still
// the cheapest, sync-safe signal we have in a Tauri webview; we only need
// a best-effort label, not a security boundary.
const PLATFORM =
  typeof navigator === 'undefined'
    ? 'other'
    : /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      ? 'mac'
      : /Win/.test(navigator.userAgent)
        ? 'win'
        : 'other';
const REVEAL_LABEL =
  PLATFORM === 'mac' ? 'Show in Finder' : PLATFORM === 'win' ? 'Show in Explorer' : 'Open folder';

interface Props {
  cwd: string;
  size?: 'xs' | 'sm';
  /**
   * The service (or stack-member) commands this dropdown is attached to.
   * Used to gate ecosystem-specific editors: e.g. Rider only shows up for
   * services that actually run the `dotnet` CLI, so Node/Python projects
   * stay clutter-free. Pass `undefined` on surfaces that aren't tied to a
   * specific service (in which case runtime-scoped editors stay hidden).
   */
  cmds?: CommandEntry[];
}

export function EditorDropdown({ cwd, size = 'xs', cmds }: Props) {
  const editors = useAppStore((s) => s.editors);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep only editors that are either universally relevant or whose runtime
  // gate matches the attached service's commands. Computed once per render
  // via `useMemo` so the placement calculation and the render loop see the
  // same list — otherwise the estimated-height math would drift from the
  // actually-rendered rows and the menu could flip in the wrong direction.
  const visibleEditors = useMemo(() => visibleEditorsFor(editors, cmds), [editors, cmds]);

  const computePosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedHeight = Math.min((visibleEditors.length + 1) * 32 + 10, 320);
    const above = spaceBelow < estimatedHeight && spaceBelow < spaceAbove;
    const left = rect.right - 220 > 0 ? rect.right - 220 : rect.left;
    setPos(
      above ? { bottom: window.innerHeight - rect.top + 4, left } : { top: rect.bottom + 4, left },
    );
  }, [visibleEditors.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    computePosition();
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, computePosition]);

  if (visibleEditors.length === 0) return null;

  // xs is the size used inside sidebar rows; we keep the sizing identical
  // to `IconButton size="xs"` (h-6/w-6 + 12×12 svg) so the editor trigger
  // vertically and horizontally lines up with its sibling actions instead
  // of sitting 4 px shorter and drawing the eye.
  const sizeClasses =
    size === 'xs' ? 'h-6 w-6 [&>svg]:h-3 [&>svg]:w-3' : 'h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5';

  return (
    <div ref={containerRef}>
      <div
        role="button"
        tabIndex={0}
        title="Open in editor"
        className={cn(
          'rounded-app-sm inline-flex cursor-pointer items-center justify-center transition',
          'text-fg-muted hover:bg-fg/10 hover:text-fg',
          sizeClasses,
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (visibleEditors.length === 1) {
            void ipc.openInEditor(visibleEditors[0]!.command, cwd);
          } else {
            setOpen((prev) => !prev);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            if (visibleEditors.length === 1) {
              void ipc.openInEditor(visibleEditors[0]!.command, cwd);
            } else {
              setOpen((prev) => !prev);
            }
          }
        }}
      >
        <Code2 />
      </div>

      {open &&
        visibleEditors.length > 1 &&
        createPortal(
          <div
            ref={menuRef}
            className="border-border bg-surface-raised rounded-app fixed z-[9999] min-w-[220px] border py-1 shadow-lg"
            style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {visibleEditors.map((editor) => (
              <button
                key={editor.key}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition',
                  'text-fg-muted hover:bg-accent/10 hover:text-fg',
                )}
                onClick={() => {
                  void ipc.openInEditor(editor.command, cwd);
                  setOpen(false);
                }}
              >
                <span
                  className={cn(
                    'rounded-app-sm flex h-5 w-5 shrink-0 items-center justify-center text-[9px] font-bold',
                    'bg-surface-muted text-fg-muted',
                  )}
                >
                  {editorBadgeLabel(editor)}
                </span>
                <span className="truncate font-medium">{editor.name}</span>
                <span className="text-fg-dim ml-auto text-[10.5px]">{editor.command}</span>
              </button>
            ))}
            <div className="border-border/70 my-1 border-t" role="separator" />
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition',
                'text-fg-muted hover:bg-fg/10 hover:text-fg',
              )}
              onClick={() => {
                void ipc.openPath(cwd);
                setOpen(false);
              }}
            >
              <span
                className={cn(
                  'rounded-app-sm flex h-5 w-5 shrink-0 items-center justify-center',
                  'bg-surface-muted text-fg-muted',
                )}
              >
                <FolderOpen className="h-3 w-3" />
              </span>
              <span className="truncate font-medium">{REVEAL_LABEL}</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
