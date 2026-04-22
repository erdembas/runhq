import { useCallback, useEffect, useState } from 'react';
import { X, FilePlus, FileEdit, FileMinus, ChevronRight, ChevronDown } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { DiffSummary, FileDiff, FileDiffStatus } from '@/types';

interface DiffViewerProps {
  serviceId: string;
  onClose: () => void;
}

const statusIcon: Record<FileDiffStatus, typeof FileEdit> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: FileEdit,
  copied: FileEdit,
  untracked: FilePlus,
};

const statusColor: Record<FileDiffStatus, string> = {
  added: 'text-green-400',
  modified: 'text-yellow-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  copied: 'text-blue-400',
  untracked: 'text-cyan-400',
};

export function DiffViewer({ serviceId, onClose }: DiffViewerProps) {
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [stagedDiff, setStagedDiff] = useState<DiffSummary | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [unstaged, staged] = await Promise.all([
          ipc.gitDiff(serviceId),
          ipc.gitDiffStaged(serviceId),
        ]);
        if (cancelled) return;
        setDiff(unstaged);
        setStagedDiff(staged);
      } catch (err) {
        console.error('Failed to load diff', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  useEffect(() => {
    if (!selectedFile) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await ipc.gitDiffFile(serviceId, selectedFile);
        if (cancelled) return;
        setFileDiff(raw);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load file diff', err);
          setFileDiff(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selectedFile]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
    setSelectedFile((cur) => (cur === path ? null : path));
  }, []);

  const allFiles: Array<FileDiff & { section: string }> = [
    ...(stagedDiff?.files.map((f) => ({ ...f, section: 'Staged' })) ?? []),
    ...(diff?.files.map((f) => ({ ...f, section: 'Unstaged' })) ?? []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border-border flex h-[80vh] w-[75vw] min-w-[700px] flex-col overflow-hidden rounded-lg border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-fg text-sm font-semibold">
            Changes
            {diff && stagedDiff && (
              <span className="text-fg/50 ml-2 text-xs font-normal">
                {diff.total_additions + (stagedDiff.total_additions ?? 0)}+ /{' '}
                {diff.total_deletions + (stagedDiff.total_deletions ?? 0)}−
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-fg/60 hover:text-fg cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="border-border w-56 shrink-0 overflow-y-auto border-r p-2">
            {loading && <p className="text-fg/40 px-2 text-xs">Loading…</p>}
            {!loading && allFiles.length === 0 && (
              <p className="text-fg/40 px-2 text-xs">No changes</p>
            )}
            {allFiles.map((f, i) => {
              const Icon = statusIcon[f.status] ?? FileEdit;
              const isExpanded = expanded[f.path] ?? false;
              return (
                <div key={`${f.section}-${f.path}-${i}`}>
                  {i === 0 && (
                    <div className="text-fg/30 mb-1 px-2 text-[10px] tracking-wider uppercase">
                      {f.section}
                    </div>
                  )}
                  {i > 0 && f.section !== allFiles[i - 1]?.section && (
                    <div className="text-fg/30 mt-2 mb-1 px-2 text-[10px] tracking-wider uppercase">
                      {f.section}
                    </div>
                  )}
                  <button
                    onClick={() => toggleExpand(f.path)}
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                      selectedFile === f.path
                        ? 'bg-accent/10 text-accent'
                        : 'text-fg/70 hover:bg-fg/5'
                    }`}
                  >
                    {isExpanded ? (
                      <ChevronDown size={10} className="shrink-0" />
                    ) : (
                      <ChevronRight size={10} className="shrink-0" />
                    )}
                    <Icon size={12} className={`shrink-0 ${statusColor[f.status] ?? ''}`} />
                    <span className="truncate">{f.path}</span>
                    <span className="text-fg/30 ml-auto shrink-0 text-[10px]">
                      +{f.additions} −{f.deletions}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {selectedFile && fileDiff != null ? (
              <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                {fileDiff.split('\n').map((line, i) => {
                  let cls = 'text-fg/70';
                  if (line.startsWith('+++') || line.startsWith('---'))
                    cls = 'text-fg font-semibold';
                  else if (line.startsWith('@@')) cls = 'text-cyan-400';
                  else if (line.startsWith('+')) cls = 'text-green-400';
                  else if (line.startsWith('-')) cls = 'text-red-400';
                  return (
                    <div key={i} className={cls}>
                      {line || ' '}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-fg/30 flex flex-1 items-center justify-center text-sm">
                {loading ? 'Loading…' : 'Select a file to view diff'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
