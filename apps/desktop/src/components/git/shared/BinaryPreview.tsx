import * as i18n from '@runhq/cockpit-ui/i18n';
import { Binary, ExternalLink, FileImage } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import {
  fileExt,
  humanKind,
  isImagePath,
  statusBadgeBg,
  statusColor,
  statusLabel,
  statusLetter,
} from '@/lib/gitDiff';
import type { FileDiffStatus } from '@/types';

interface BinaryPreviewProps {
  path: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
  cwd: string | null;
}

export function BinaryPreview({ path, status, additions, deletions, cwd }: BinaryPreviewProps) {
  i18n.useLocale();
  const isImage = isImagePath(path);
  const kind = humanKind(path);
  const ext = fileExt(path);
  const fullPath = cwd ? `${cwd.replace(/\/$/, '')}/${path}` : null;
  const Icon = isImage ? FileImage : Binary;
  const statusVerb: Record<FileDiffStatus, string> = {
    added: i18n.t('Added to working tree'),
    modified: i18n.t('Modified — contents changed'),
    deleted: i18n.t('Deleted from working tree'),
    renamed: i18n.t('Renamed'),
    copied: i18n.t('Copied'),
    untracked: i18n.t('New untracked file'),
  };
  const headline: Record<FileDiffStatus, string> = {
    added: i18n.t('New binary file'),
    modified: i18n.t('Binary file changed'),
    deleted: i18n.t('Binary file removed'),
    renamed: i18n.t('Binary file renamed'),
    copied: i18n.t('Binary file copied'),
    untracked: i18n.t('Untracked binary file'),
  };

  return (
    <div className="bg-surface flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div
        className={cn(
          'flex h-20 w-20 items-center justify-center rounded-2xl border',
          'border-border bg-surface-muted/40',
          statusColor[status],
        )}
      >
        <Icon size={42} strokeWidth={1.2} />
      </div>
      <div className="space-y-1">
        <h3 className="text-fg text-base font-semibold tracking-tight">{headline[status]}</h3>
        <p className="text-fg/60 max-w-md text-xs">
          {i18n.rich(
            "Monaco doesn't render {value1} diffs — Git tracks this file as binary, so a line-by-line comparison isn't meaningful.",
            { value1: kind.toLowerCase() },
          )}
        </p>
      </div>
      <div className="border-border bg-surface-muted/40 flex items-center gap-3 rounded-md border px-3 py-2 text-[11px]">
        <span
          className={cn(
            'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums ring-1',
            statusBadgeBg[status],
          )}
          title={statusLabel[status]}
        >
          {statusLetter[status]}
        </span>
        <span className="text-fg/70">{statusVerb[status]}</span>
        {(additions > 0 || deletions > 0) && <span className="text-fg/40">·</span>}
        {additions > 0 && <span className="text-emerald-400 tabular-nums">+{additions}</span>}
        {deletions > 0 && <span className="text-rose-400 tabular-nums">−{deletions}</span>}
        {ext && (
          <>
            <span className="text-fg/40">·</span>
            <span className="text-fg/50 uppercase">{ext}</span>
          </>
        )}
      </div>
      <div className="text-fg/40 max-w-lg truncate font-mono text-[11px]" title={path}>
        {path}
      </div>
      {fullPath && status !== 'deleted' && (
        <button
          onClick={() => void ipc.openPath(fullPath)}
          className="border-border bg-surface-muted/60 text-fg/80 hover:bg-fg/10 hover:text-fg flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition"
          title={fullPath}
        >
          {i18n.rich('{value1}Open in default app', { value1: <ExternalLink size={12} /> })}
        </button>
      )}
    </div>
  );
}
