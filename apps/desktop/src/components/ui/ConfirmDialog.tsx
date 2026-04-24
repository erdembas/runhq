import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export type ConfirmTone = 'danger' | 'warning' | 'info';

interface Props {
  /** Short title for the dialog. Optional — plain message-only usage
   *  stays identical to the previous API. */
  title?: string;
  /** Main body of the confirmation. Rendered with `whitespace-pre-line`. */
  message: string;
  /** Optional monospace details block (e.g. command preview, file list). */
  details?: string;
  /** Labels for the action buttons; sensible defaults provided. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual severity. Defaults to `danger` for backward-compatibility with
   *  the original hard-coded `variant="danger"`. */
  tone?: ConfirmTone;
  /** When set, the confirm button stays disabled until the user types
   *  exactly this word/phrase. Used for irreversible ops (force-delete,
   *  reset, etc.) to avoid muscle-memory double-clicks. */
  confirmWord?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  confirmWord,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');

  // Focus strategy:
  // - When a confirmWord gate is present, focus the input so the user can
  //   start typing immediately instead of a pointless extra click.
  // - Otherwise focus the confirm button so ↵ submits, matching the
  //   previous behaviour exactly (no regression for existing callers).
  useEffect(() => {
    if (confirmWord) wordInputRef.current?.focus();
    else confirmRef.current?.focus();
  }, [confirmWord]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const gateSatisfied = !confirmWord || typed.trim() === confirmWord;
  const Icon = tone === 'info' ? Info : AlertTriangle;
  const iconColorCls =
    tone === 'danger'
      ? 'text-status-error'
      : tone === 'warning'
        ? 'text-status-starting'
        : 'text-accent';

  return createPortal(
    <div
      className="fixed inset-0 z-10000 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-overlay animate-fade-in rounded-app-lg w-full max-w-md border p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              tone === 'danger' && 'bg-status-error/12',
              tone === 'warning' && 'bg-status-starting/14',
              tone === 'info' && 'bg-accent/12',
            )}
          >
            <Icon className={cn('h-4 w-4', iconColorCls)} />
          </div>
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-fg mb-1 text-[14px] font-semibold">{title}</h3>}
            <p className="text-fg text-[13px] leading-relaxed whitespace-pre-line">{message}</p>
            {details && (
              <pre className="border-border bg-surface-muted/40 text-fg-muted mt-3 max-h-40 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap">
                {details}
              </pre>
            )}
            {confirmWord && (
              <div className="mt-3">
                <label className="text-fg-dim text-[11px]">
                  Type{' '}
                  <span className="text-fg bg-surface-muted rounded px-1 font-mono text-[11px]">
                    {confirmWord}
                  </span>{' '}
                  to confirm
                </label>
                <input
                  ref={wordInputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && gateSatisfied) onConfirm();
                  }}
                  className="border-border bg-surface-muted/60 text-fg focus:border-accent/60 focus:bg-surface mt-1 h-8 w-full rounded border px-2 font-mono text-[12px] transition focus:outline-none"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'info' ? 'primary' : 'danger'}
            onClick={onConfirm}
            ref={confirmRef}
            disabled={!gateSatisfied}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
