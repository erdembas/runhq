'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  Check,
  Code2,
  Download,
  FileText,
  Image,
  Layers3,
  Monitor,
  Play,
  RotateCcw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { AGENT_CANVAS_SANDBOX, type AgentCanvasArtifact } from '../lib/agentCanvas';

const kindIcons = { html: Code2, svg: Image, markdown: FileText };
const control =
  'text-fg-muted hover:text-fg hover:bg-fg/5 focus-visible:outline-accent flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-35';

export interface AgentCanvasProps {
  artifacts: readonly AgentCanvasArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  source: string;
  onSourceChange: (source: string) => void;
  previewDocument: string;
  previewUrl?: string;
  previewStatus?: string;
  markdownPreview?: ReactNode;
  modified: boolean;
  onReset: () => void;
  onDownload: () => void;
  saving?: boolean;
  onCopyPrompt?: () => void;
  promptCopied?: boolean;
  error?: string | null;
}

/** A provider-independent surface. Persistence and Markdown rendering belong to the consumer. */
export function AgentCanvas({
  artifacts,
  selectedId,
  onSelect,
  source,
  onSourceChange,
  previewDocument,
  previewUrl,
  previewStatus,
  markdownPreview,
  modified,
  onReset,
  onDownload,
  saving,
  onCopyPrompt,
  promptCopied,
  error,
}: AgentCanvasProps) {
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const panelId = useId();
  const selected = artifacts.find((artifact) => artifact.id === selectedId);
  return (
    <section aria-label="Agent canvas" className="bg-surface flex h-full min-h-0 flex-col">
      <header className="border-border/70 flex shrink-0 items-center gap-3 border-b px-5 py-4">
        <span className="border-accent/20 bg-accent/10 text-accent flex h-9 w-9 items-center justify-center rounded-xl border">
          <Layers3 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-fg text-[13px] font-semibold">Canvas</h2>
          <p className="text-fg-dim mt-0.5 text-[11px]">Ideas you can see, edit and try.</p>
        </div>
        {!!artifacts.length && (
          <span className="text-fg-dim bg-fg/5 rounded-full px-2.5 py-1 font-mono text-[10px]">
            {artifacts.length} {artifacts.length === 1 ? 'artifact' : 'artifacts'}
          </span>
        )}
      </header>
      {!selected ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <div className="w-full max-w-sm text-center">
            <div className="relative mx-auto mb-6 h-24 w-32" aria-hidden="true">
              <div className="border-border bg-surface-raised absolute inset-x-2 top-1 h-20 -rotate-6 rounded-xl border" />
              <div className="border-accent/25 bg-surface-raised absolute inset-x-2 top-1 flex h-20 rotate-6 items-center justify-center rounded-xl border shadow-lg shadow-black/5">
                <Sparkles className="text-accent h-7 w-7" />
              </div>
            </div>
            <h3 className="text-fg text-[16px] font-semibold tracking-tight">
              Make the conversation tangible
            </h3>
            <p className="text-fg-muted mt-2 text-[12px] leading-6">
              Ask your agent for a prototype, diagram or document. HTML, SVG and Markdown code
              blocks appear here when they are ready.
            </p>
            <div className="border-border/70 bg-surface-raised mt-6 rounded-xl border p-4 text-left">
              <p className="text-fg-dim text-[10px] font-semibold tracking-wider uppercase">
                Try a prompt
              </p>
              <p className="text-fg mt-2 text-[12px] leading-5">
                “Create an interactive project dashboard as a single, self-contained HTML code
                block. Include all styles and scripts inline.”
              </p>
              {onCopyPrompt && (
                <button
                  type="button"
                  onClick={onCopyPrompt}
                  className="text-accent hover:bg-accent/10 focus-visible:outline-accent mt-3 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium"
                >
                  {promptCopied ? <Check className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
                  {promptCopied ? 'Prompt copied' : 'Copy prompt'}
                </button>
              )}
            </div>
            <p className="text-fg-dim mt-4 text-[10px]">
              Works with every agent that returns these code blocks.
            </p>
          </div>
        </div>
      ) : (
        <>
          <nav
            aria-label="Canvas artifacts"
            className="border-border/60 flex shrink-0 gap-2 overflow-x-auto border-b px-4 py-3"
          >
            {artifacts.map((artifact) => {
              const Icon = kindIcons[artifact.kind];
              return (
                <button
                  type="button"
                  key={artifact.id}
                  aria-pressed={artifact.id === selectedId}
                  onClick={() => onSelect(artifact.id)}
                  title={artifact.title}
                  className={cn(
                    'focus-visible:outline-accent flex max-w-56 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    artifact.id === selectedId
                      ? 'border-accent/30 bg-accent/8 text-fg'
                      : 'border-border/60 bg-surface-raised text-fg-muted hover:border-fg/20',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      artifact.id === selectedId && 'text-accent',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium">{artifact.title}</span>
                    <span className="text-fg-dim mt-0.5 block text-[9px] uppercase">
                      {artifact.kind}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="border-border/60 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <div className="bg-fg/5 flex rounded-lg p-0.5" aria-label="Canvas view">
              <button
                type="button"
                aria-pressed={view === 'preview'}
                aria-controls={panelId}
                onClick={() => setView('preview')}
                className={cn(control, view === 'preview' && 'bg-surface-raised text-fg shadow-sm')}
              >
                <Play className="h-3 w-3" />
                Preview
              </button>
              <button
                type="button"
                aria-pressed={view === 'source'}
                aria-controls={panelId}
                onClick={() => setView('source')}
                className={cn(control, view === 'source' && 'bg-surface-raised text-fg shadow-sm')}
              >
                <Code2 className="h-3 w-3" />
                Source
              </button>
            </div>
            {view === 'preview' && selected.kind !== 'markdown' && (
              <div className="flex items-center gap-0.5" aria-label="Preview size">
                <button
                  type="button"
                  className={cn(control, device === 'desktop' && 'bg-fg/5 text-fg')}
                  onClick={() => setDevice('desktop')}
                  aria-label="Desktop preview"
                  aria-pressed={device === 'desktop'}
                  title="Desktop preview"
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={cn(control, device === 'mobile' && 'bg-fg/5 text-fg')}
                  onClick={() => setDevice('mobile')}
                  aria-label="Mobile preview"
                  aria-pressed={device === 'mobile'}
                  title="Mobile preview"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              {view === 'preview' && selected.kind === 'html' && (
                <button
                  type="button"
                  onClick={() => setReload((value) => value + 1)}
                  className={control}
                  aria-label="Restart preview"
                  title="Restart preview"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={onReset}
                disabled={!modified}
                className={control}
                title="Restore agent's original source"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={saving}
                className={control}
                title="Download current source"
              >
                <Download className="h-3 w-3" />
                {saving ? 'Saving…' : 'Save file'}
              </button>
            </div>
          </div>
          <div id={panelId} className="relative min-h-0 flex-1 overflow-hidden">
            {view === 'source' ? (
              <textarea
                aria-label={`${selected.title} source`}
                spellCheck={false}
                value={source}
                onChange={(event) => onSourceChange(event.target.value)}
                className="text-fg placeholder:text-fg-dim focus-visible:outline-accent h-full w-full resize-none border-0 bg-transparent p-5 font-mono text-[12px] leading-6 outline-none"
              />
            ) : selected.kind === 'markdown' ? (
              <div className="h-full overflow-auto p-6">
                <div className="text-fg-muted mx-auto max-w-3xl text-[13px] leading-6">
                  {markdownPreview}
                </div>
              </div>
            ) : previewStatus ? (
              <div
                className="text-fg-muted flex h-full items-center justify-center p-6 text-center text-[12px]"
                role="status"
              >
                {previewStatus}
              </div>
            ) : (
              <div
                className={cn('h-full w-full overflow-auto', device === 'mobile' && 'bg-fg/3 p-4')}
              >
                <iframe
                  key={`${selected.id}:${reload}:${previewUrl ?? ''}`}
                  title={`${selected.title} preview`}
                  src={previewUrl}
                  srcDoc={previewUrl ? undefined : previewDocument}
                  sandbox={AGENT_CANVAS_SANDBOX}
                  referrerPolicy="no-referrer"
                  allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
                  className={cn(
                    'mx-auto block h-full border-0 bg-white',
                    device === 'mobile'
                      ? 'w-full max-w-[390px] rounded-xl shadow-lg shadow-black/10'
                      : 'w-full',
                  )}
                />
              </div>
            )}
          </div>
          <footer className="border-border/70 text-fg-dim flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  modified ? 'bg-accent' : 'bg-status-running',
                )}
              />
              {modified ? 'Local edits' : 'Agent original'}
            </span>
            <span>{source.split('\n').length} lines</span>
            <span className="ml-auto">
              {selected.kind === 'html'
                ? 'Inline HTML · sandboxed preview'
                : selected.kind === 'svg'
                  ? 'SVG image preview'
                  : 'Markdown document'}
            </span>
          </footer>
        </>
      )}
      {error && (
        <p
          role="alert"
          className="border-status-error/20 bg-status-error/5 text-status-error shrink-0 border-t px-4 py-2 text-[11px]"
        >
          {error}
        </p>
      )}
    </section>
  );
}
