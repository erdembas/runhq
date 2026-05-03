import type { LogLine } from '@/types';

export const EMPTY_LOGS: LogLine[] = [];

export function utf8ToBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

export function badgeClass(name: string): string {
  const palette = [
    'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    'bg-lime-500/15 text-lime-700 dark:text-lime-300',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}
