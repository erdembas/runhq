import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

/** Expand in place so drafts, selection and the canvas viewport survive focus mode. */
export function AgentWorkflowStudio({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  i18n.useLocale();
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="listbox"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        toggle.current?.focus();
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expanded]);
  return (
    <div
      ref={root}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label={i18n.t('Workflow studio')}
      className={`workflow-studio border-border bg-surface-raised overflow-auto rounded-xl border shadow-sm ${expanded ? 'workflow-studio-expanded fixed inset-3 z-50 shadow-2xl' : ''}`}
    >
      <div className="bg-surface border-border flex flex-wrap items-center gap-3 border-b px-4 py-3">
        {toolbar}
        <button
          ref={toggle}
          type="button"
          className="border-border hover:bg-fg/5 rounded-lg border p-2"
          aria-label={expanded ? i18n.t('Exit expanded studio') : i18n.t('Expand studio')}
          title={expanded ? i18n.t('Exit expanded studio') : i18n.t('Expand studio')}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>
      {children}
    </div>
  );
}
