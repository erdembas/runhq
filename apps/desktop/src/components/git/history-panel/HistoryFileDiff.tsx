import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import type { HistoryPanelStore } from '@/components/git/useHistoryPanelStore';
import type { FileEntry } from '@/lib/gitDiff';

interface HistoryFileDiffProps {
  panel: HistoryPanelStore;
  selectedMeta: FileEntry | null;
  monacoTheme: string;
  cwd: string | null;
  viewMode: DiffViewMode;
}

export function HistoryFileDiff({
  panel,
  selectedMeta,
  monacoTheme,
  cwd,
  viewMode,
}: HistoryFileDiffProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <DiffPane
        selectedFile={panel.selectedFile}
        fileDiff={panel.fileDiff}
        selectedMeta={selectedMeta}
        monacoTheme={monacoTheme}
        cwd={cwd}
        viewMode={viewMode}
        fileLoading={panel.fileLoading}
        emptyLabel={
          panel.selectedCommit ? 'Select a file from this commit' : 'Select a commit on the left'
        }
      />
    </div>
  );
}
