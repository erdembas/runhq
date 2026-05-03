import type { FileDiffStatus } from '@/types';

/** VSCode-style single-letter status badges. */
export const statusLetter: Record<FileDiffStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
};

export const statusColor: Record<FileDiffStatus, string> = {
  added: 'text-emerald-400',
  modified: 'text-amber-400',
  deleted: 'text-rose-400',
  renamed: 'text-sky-400',
  copied: 'text-sky-400',
  untracked: 'text-emerald-300',
};

export const statusBadgeBg: Record<FileDiffStatus, string> = {
  added: 'bg-emerald-400/20 ring-emerald-400/50 text-emerald-300',
  modified: 'bg-amber-400/20 ring-amber-400/50 text-amber-300',
  deleted: 'bg-rose-400/20 ring-rose-400/50 text-rose-300',
  renamed: 'bg-sky-400/20 ring-sky-400/50 text-sky-300',
  copied: 'bg-sky-400/20 ring-sky-400/50 text-sky-300',
  untracked: 'bg-emerald-300/20 ring-emerald-300/50 text-emerald-200',
};

export const statusBarBg: Record<FileDiffStatus, string> = {
  added: 'bg-emerald-400',
  modified: 'bg-amber-400',
  deleted: 'bg-rose-400',
  renamed: 'bg-sky-400',
  copied: 'bg-sky-400',
  untracked: 'bg-emerald-300',
};

export const statusLetterStyle: Record<FileDiffStatus, { background: string; color: string }> = {
  added: { background: 'rgba(52, 211, 153, 0.18)', color: 'rgb(110, 231, 183)' },
  modified: { background: 'rgba(251, 191, 36, 0.18)', color: 'rgb(253, 224, 71)' },
  deleted: { background: 'rgba(251, 113, 133, 0.18)', color: 'rgb(253, 164, 175)' },
  renamed: { background: 'rgba(56, 189, 248, 0.18)', color: 'rgb(125, 211, 252)' },
  copied: { background: 'rgba(56, 189, 248, 0.18)', color: 'rgb(125, 211, 252)' },
  untracked: { background: 'rgba(110, 231, 183, 0.18)', color: 'rgb(167, 243, 208)' },
};

export const statusLabel: Record<FileDiffStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
};
