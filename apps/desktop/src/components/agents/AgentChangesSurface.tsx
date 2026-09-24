import { useLayoutEffect, useRef, type ElementRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function AgentChangesSurface({
  expanded,
  onCollapse,
  children,
  label,
}: {
  expanded: boolean;
  onCollapse: () => void;
  children: ReactNode;
  label: string;
}) {
  const dialog = useRef<ElementRef<'dialog'>>(null);
  const wasExpanded = useRef(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;

    // Keep one DOM subtree: changing presentation must retain the selected file,
    // expanded folders, loaded diff and each pane's scroll position.
    if (expanded) {
      element.close();
      element.showModal();
    } else {
      element.open = true;
    }
    if (expanded || wasExpanded.current) {
      element
        .querySelector<HTMLButtonElement>('[data-changes-expand-toggle]')
        ?.focus({ preventScroll: true });
    }
    wasExpanded.current = expanded;

    // Closing before the next effect allows an open nonmodal dialog to enter the
    // top layer, and removes modality when collapsing or unmounting the surface.
    return () => element.close();
  }, [expanded]);

  return (
    <dialog
      ref={dialog}
      open
      role={expanded ? 'dialog' : 'region'}
      aria-modal={expanded || undefined}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (expanded) onCollapse();
      }}
      onKeyDown={(event) => {
        if (!expanded || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCollapse();
      }}
      className={cn(
        'bg-surface text-fg relative m-0 flex max-h-none min-h-0 w-full max-w-none min-w-0 flex-1 flex-col overflow-hidden border-0 p-0',
        expanded &&
          'border-border fixed inset-3 h-auto w-auto rounded-xl border shadow-2xl backdrop:bg-black/50',
      )}
    >
      {children}
    </dialog>
  );
}
