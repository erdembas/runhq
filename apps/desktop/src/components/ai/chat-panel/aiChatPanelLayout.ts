import { cn } from '@/lib/cn';

export function panelClassName(isInline: boolean) {
  return cn(
    'relative flex flex-col',
    isInline
      ? 'h-full min-h-0 w-full flex-1 bg-transparent'
      : 'bg-surface border-border fixed top-9 right-0 bottom-7 z-60 w-[440px] max-w-[100vw] border-l shadow-[-12px_0_40px_rgba(0,0,0,0.35)]',
  );
}
