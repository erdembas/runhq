import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns2, Rows2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';

/** macOS draws its traffic lights over the window, so the title row keeps that corner clear. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * One agent step's change, full screen, in the same viewer Source Control uses — so split and
 * unified reading, syntax colouring and the full-file toggle behave exactly as they do in Git.
 */
export function AgentDiffModal({
  path,
  patch,
  added,
  removed,
  cwd,
  onClose,
}: {
  path: string;
  patch: string;
  added: number;
  removed: number;
  cwd?: string | null;
  onClose: () => void;
}) {
  const [viewMode, setViewMode] = useState<DiffViewMode>('side-by-side');
  const { effective } = useTheme();
  const monacoTheme = useMonacoTheme(effective);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // The trigger lives inside a collapsed <details>, whose hidden children would never paint.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Change to ${path}`}
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-surface-raised flex h-full w-full flex-col overflow-hidden shadow-2xl">
        <div
          {...(isMac ? { 'data-tauri-drag-region': true } : {})}
          className={cn(
            'border-border flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-3',
            isMac ? 'pl-[84px]' : 'pl-3',
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-fg truncate text-[13px] font-semibold tracking-tight">{path}</h2>
            <span className="shrink-0 text-[11px] tabular-nums">
              <span className="text-emerald-400">+{added}</span>{' '}
              <span className="text-rose-400">−{removed}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="border-border bg-surface-muted flex items-center overflow-hidden rounded border">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[11px] transition',
                  viewMode === 'side-by-side'
                    ? 'bg-accent/20 text-accent'
                    : 'text-fg/50 hover:text-fg',
                )}
                title="Side-by-side view"
              >
                <Columns2 size={12} />
                <span className="hidden sm:inline">Split</span>
              </button>
              <button
                onClick={() => setViewMode('inline')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[11px] transition',
                  viewMode === 'inline' ? 'bg-accent/20 text-accent' : 'text-fg/50 hover:text-fg',
                )}
                title="Inline (unified) view"
              >
                <Rows2 size={12} />
                <span className="hidden sm:inline">Inline</span>
              </button>
            </div>
            <button
              onClick={onClose}
              aria-label="Close diff"
              className="text-fg/50 hover:bg-fg/10 hover:text-fg flex h-6 w-6 items-center justify-center rounded transition"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <DiffPane
            selectedFile={path}
            fileDiff={patch}
            selectedMeta={{
              path,
              status: removed === 0 ? 'added' : 'modified',
              additions: added,
              deletions: removed,
              section: 'agent',
            }}
            monacoTheme={monacoTheme}
            cwd={cwd ?? null}
            viewMode={viewMode}
            fileLoading={false}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
