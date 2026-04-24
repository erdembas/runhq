import { useMemo } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { ChevronRight, File, RefreshCw, UnfoldVertical, FoldVertical } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FileTypeIcon } from '@/lib/fileIcon';
import { useAppStore } from '@/store/useAppStore';
import {
  type FileEntry,
  isBinaryDiff,
  languageForPath,
  parseUnifiedDiff,
  statusColor,
  statusLetterStyle,
  statusLabel,
  statusLetter,
} from '@/lib/gitDiff';
import { BinaryPreview } from '@/components/git/shared';

export type DiffViewMode = 'side-by-side' | 'inline';

interface DiffPaneProps {
  /** Path of the file currently being shown, relative to the repo root. */
  selectedFile: string | null;
  /** Raw git diff output for the selected file. Null = still loading. */
  fileDiff: string | null;
  /** Metadata for the selected file (used by the header and binary preview). */
  selectedMeta: FileEntry | null;
  /** Monaco theme id registered by the parent (runhq-dark / runhq-light). */
  monacoTheme: string;
  /** Absolute cwd for the repo — needed to build a full path for the
   * "Open in default app" button in the binary preview. */
  cwd: string | null;
  viewMode: DiffViewMode;
  fileLoading: boolean;
  /** Optional label shown in the placeholder when nothing is selected. */
  emptyLabel?: string;
}

export function DiffPane({
  selectedFile,
  fileDiff,
  selectedMeta,
  monacoTheme,
  cwd,
  viewMode,
  fileLoading,
  emptyLabel,
}: DiffPaneProps) {
  // "Full file" toggle lives in the global store so every surface that
  // mounts a DiffPane (Changes / Commit / History / Cross-Project)
  // stays in sync, AND so the parent's fetch logic can observe the
  // same flag to request a wider `-U` context from git.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const setShowUnchanged = useAppStore((s) => s.setDiffShowUnchanged);

  const { original, modified } = useMemo(() => {
    if (!fileDiff) return { original: '', modified: '' };
    return parseUnifiedDiff(fileDiff);
  }, [fileDiff]);

  const language = useMemo(() => {
    if (!selectedFile) return 'plaintext';
    return languageForPath(selectedFile);
  }, [selectedFile]);

  const binaryInfo = useMemo(() => {
    if (!selectedFile || fileDiff == null) return null;
    if (!isBinaryDiff(fileDiff, selectedFile)) return null;
    return true;
  }, [selectedFile, fileDiff]);

  if (!selectedFile || fileDiff == null) {
    return (
      <div className="text-fg/40 flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <File size={42} className="text-fg/15" strokeWidth={1} />
        <p>{emptyLabel ?? 'Select a file to view the diff'}</p>
      </div>
    );
  }

  const breadcrumbParts = selectedFile.split('/');

  return (
    <>
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
        <FileTypeIcon
          path={selectedFile}
          size={14}
          fallbackColor={selectedMeta ? statusColor[selectedMeta.status] : 'text-fg/40'}
        />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[11px]">
          {breadcrumbParts.map((part, idx) => {
            const isLast = idx === breadcrumbParts.length - 1;
            return (
              <span key={idx} className="flex items-center gap-0.5">
                <span className={cn('truncate', isLast ? 'text-fg font-medium' : 'text-fg/50')}>
                  {part}
                </span>
                {!isLast && <ChevronRight size={10} className="text-fg/30 shrink-0" />}
              </span>
            );
          })}
        </div>
        {selectedMeta && (
          <span
            className="inline-flex items-center justify-center font-bold tabular-nums"
            style={{
              ...statusLetterStyle[selectedMeta.status],
              height: 15,
              minWidth: 15,
              borderRadius: 3,
              paddingLeft: 3,
              paddingRight: 3,
              fontSize: 9.5,
              lineHeight: 1,
            }}
            title={statusLabel[selectedMeta.status]}
          >
            {statusLetter[selectedMeta.status]}
          </span>
        )}
        {selectedMeta && (
          <span className="text-[10px] tabular-nums">
            <span className="text-emerald-400/80">+{selectedMeta.additions}</span>{' '}
            <span className="text-rose-400/80">−{selectedMeta.deletions}</span>
          </span>
        )}
        <span className="text-fg/30 bg-fg/5 rounded px-1.5 py-px text-[9px] uppercase">
          {language}
        </span>
        <button
          type="button"
          onClick={() => setShowUnchanged(!showUnchanged)}
          title={
            showUnchanged
              ? 'Collapse unchanged regions (show only diffs + 3 lines context)'
              : 'Show full file — expand every unchanged line'
          }
          aria-label="Toggle full-file view"
          aria-pressed={showUnchanged}
          className={cn(
            'flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition',
            showUnchanged ? 'bg-accent/20 text-accent' : 'text-fg/50 hover:bg-fg/10 hover:text-fg',
          )}
        >
          {showUnchanged ? <FoldVertical size={11} /> : <UnfoldVertical size={11} />}
          <span className="hidden sm:inline">{showUnchanged ? 'Full file' : 'Diffs only'}</span>
        </button>
        {fileLoading && <RefreshCw size={10} className="text-fg/30 animate-spin" />}
      </div>
      <div className="min-h-0 flex-1">
        {binaryInfo ? (
          <BinaryPreview
            path={selectedFile}
            status={selectedMeta?.status ?? 'modified'}
            additions={selectedMeta?.additions ?? 0}
            deletions={selectedMeta?.deletions ?? 0}
            cwd={cwd}
          />
        ) : (
          <DiffEditor
            height="100%"
            language={language}
            original={original}
            modified={modified}
            theme={monacoTheme}
            options={
              {
                readOnly: true,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                // Full-line current-line highlight — "all" covers both
                // gutter and line, matching VSCode's default so the
                // focused row always reads as a single coloured band.
                renderLineHighlight: 'all',
                renderLineHighlightOnlyWhenFocus: false,
                wordWrap: 'off',
                folding: true,
                automaticLayout: true,
                renderSideBySide: viewMode === 'side-by-side',
                diffAlgorithm: 'advanced',
                // Keep the +/- marks in the gutter AND render the whole
                // changed line as a tinted band. Monaco calls this the
                // "renderMarginRevertIcon + whole-line decoration"
                // combo; without `renderIndicators: true` the left
                // gutter shows no hint at all when side-by-side is off.
                renderIndicators: true,
                renderMarginRevertIcon: false,
                // Ensure the line-level tint reaches the full editor
                // width even when scrollbars are floating on top.
                renderOverviewRuler: true,
                hideUnchangedRegions: {
                  enabled: !showUnchanged,
                  contextLineCount: 3,
                  minLineCount: 5,
                },
              } as Record<string, unknown>
            }
            loading={
              <div className="bg-surface flex h-full items-center justify-center">
                <span className="text-fg/30 text-xs">Loading editor…</span>
              </div>
            }
          />
        )}
      </div>
    </>
  );
}
