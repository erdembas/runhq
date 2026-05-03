import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, StretchHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DocContent } from '@/types';
import { formatBytes, formatRelative } from './docUtils';
import { DocMarkdown } from './DocMarkdown';
import { useWideLayoutPref } from './useWideLayoutPref';

interface DocBodyProps {
  serviceId: string;
  content: DocContent | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRunCommand: (command: string) => void;
  onSelectDoc: (path: string) => void;
}

export function DocBody({
  serviceId,
  content,
  loading,
  error,
  onRefresh,
  onRunCommand,
  onSelectDoc,
}: DocBodyProps) {
  const [wide, toggleWide] = useWideLayoutPref();
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSpinner(false);
      return;
    }
    const t = window.setTimeout(() => setShowSpinner(true), 200);
    return () => window.clearTimeout(t);
  }, [loading]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="border-status-error/40 bg-status-error/10 text-status-error max-w-md rounded-lg border px-4 py-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Couldn't load this doc</span>
          </div>
          <code className="text-fg-dim block font-mono text-[11px]">{error}</code>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
        {showSpinner ? 'Loading…' : ''}
      </div>
    );
  }

  return (
    <>
      <div className="border-border/60 bg-surface-raised text-fg-dim sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b px-5 py-1.5 text-[10.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3 w-3 shrink-0" />
          <code className="text-fg-muted truncate font-mono text-[11px]">
            {content.relative_path}
          </code>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatBytes(content.size_bytes)}</span>
          {content.last_modified_ms > 0 && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0" title={new Date(content.last_modified_ms).toString()}>
                edited {formatRelative(content.last_modified_ms)}
              </span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleWide}
            title={wide ? 'Switch to centred reading column' : 'Use the full available width'}
            aria-pressed={wide}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors',
              wide ? 'bg-accent/15 text-accent' : 'hover:bg-accent/10 hover:text-accent',
            )}
          >
            <StretchHorizontal className="h-3 w-3" />
            <span>Wide</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            title="Re-read this doc from disk"
            className="hover:bg-accent/10 hover:text-accent inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <DocMarkdown
        key={content.relative_path}
        serviceId={serviceId}
        content={content}
        onRunCommand={onRunCommand}
        onSelectDoc={onSelectDoc}
        wide={wide}
      />
    </>
  );
}
