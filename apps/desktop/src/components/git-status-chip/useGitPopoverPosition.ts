import { useEffect, useState, type RefObject } from 'react';
import { POPOVER_WIDTH, type ConfirmState, type GitPopoverPosition } from './types';

interface UseGitPopoverPositionArgs {
  open: boolean;
  confirm: ConfirmState;
  anchorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function useGitPopoverPosition({
  open,
  confirm,
  anchorRef,
  onClose,
}: UseGitPopoverPositionArgs) {
  const [position, setPosition] = useState<GitPopoverPosition | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const estHeight = 560;
      const above = rect.bottom + estHeight > window.innerHeight;
      const rawLeft = rect.right - POPOVER_WIDTH;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - POPOVER_WIDTH - 8));
      setPosition(
        above
          ? { bottom: window.innerHeight - rect.top + 6, left }
          : { top: rect.bottom + 6, left },
      );
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, confirm, anchorRef, onClose]);

  return position;
}
