import { clsx, type ClassValue } from 'clsx';

/**
 * Local re-implementation of the desktop app's `cn` helper, minus the
 * `tailwind-merge` dependency. The presentational layer doesn't compose
 * arbitrary user-supplied class lists at runtime — every call site
 * passes a small, statically-known set of variants — so the
 * tail-twind-merge engine (which is non-trivial bundle weight) is dead
 * code here. Consumers that need real Tailwind class merging (the
 * desktop app's drawer / dialog plumbing) keep their own twMerge wrap.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
