import { useEffect, useLayoutEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import type { Turn } from '../chatPanelTypes';

interface Args {
  closePanel: () => void;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isOpen: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  turns: Turn[];
  variant: 'drawer' | 'inline';
}

export function useAiPanelEffects({
  closePanel,
  input,
  inputRef,
  isOpen,
  scrollRef,
  turns,
  variant,
}: Args) {
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, inputRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [scrollRef, turns]);

  useEffect(() => {
    if (variant !== 'drawer' || !isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, isOpen, closePanel]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input, inputRef]);

  return useMemo(() => {
    const firstUser = turns.find((t) => t.role === 'user');
    const trimmed = firstUser?.content.trim();
    return trimmed ? trimmed.slice(0, 60) : null;
  }, [turns]);
}
