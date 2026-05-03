import { useState } from 'react';
import { Check, Code2, Copy, ExternalLink, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IS_MAC } from '@/lib/platform';
import type { DetectedEditor, ProjectOverview } from '@/types';
import { IconBtn } from './IconBtn';
import { OverflowMenu } from './OverflowMenu';
import { scanFreshness } from './model';

export function DrawerHeader({
  project,
  scanning,
  lastScanAt,
  editors,
  onRescan,
  onClose,
  onOpenPath,
  onOpenInEditor,
  onJump,
}: {
  project: ProjectOverview;
  scanning: boolean;
  lastScanAt: number | null;
  editors: DetectedEditor[];
  onRescan: () => void;
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenInEditor: (command: string, path: string) => void;
  onJump: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const branch = project.git_status?.branch ?? null;
  const dirty = project.git_status?.is_dirty ?? false;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(project.cwd);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
    } catch {
      /* clipboard blocked — no UX recourse from here */
    }
  };

  return (
    <header className="border-border/70 shrink-0 border-b px-4 pt-3 pb-2.5">
      {/* Identity row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-fg truncate text-[14px] font-semibold">{project.name}</h3>
          {project.runtime && (
            <span className="bg-fg/8 text-fg/55 shrink-0 rounded px-1.5 py-px text-[9px] font-medium tracking-wider uppercase">
              {project.runtime}
            </span>
          )}
          {branch && (
            <span
              className="text-fg/55 border-border inline-flex min-w-0 shrink items-center gap-1 rounded border px-1.5 py-px text-[10px]"
              title={`Branch: ${branch}${dirty ? ' (dirty)' : ''}`}
            >
              <span className="truncate font-mono">{branch}</span>
              {dirty && <span className="bg-tone-warning h-1.5 w-1.5 shrink-0 rounded-full" />}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <OverflowMenu
            open={menuOpen}
            setOpen={setMenuOpen}
            items={[
              {
                label: 'Jump to project',
                icon: <ExternalLink size={12} />,
                onClick: () => onJump(project.service_id),
              },
              {
                // "Open in..." fans out detected editors so the user can
                // pick the right IDE per project (VS Code for TS, RubyMine
                // for Rails, etc.) without us guessing from `editors[0]`.
                // Finder/Explorer sits below a divider as the non-editor
                // escape hatch — same "Open in..." family, different tool.
                label: 'Open in…',
                icon: <Code2 size={12} />,
                children:
                  editors.length > 0
                    ? [
                        ...editors.map((ed) => ({
                          label: ed.name,
                          icon: <Code2 size={12} />,
                          onClick: () => onOpenInEditor(ed.command, project.cwd),
                        })),
                        { separator: true as const },
                        {
                          label: IS_MAC ? 'Open in Finder' : 'Open in Explorer',
                          icon: <FolderOpen size={12} />,
                          onClick: () => onOpenPath(project.cwd),
                        },
                      ]
                    : [
                        {
                          label: IS_MAC ? 'Open in Finder' : 'Open in Explorer',
                          icon: <FolderOpen size={12} />,
                          onClick: () => onOpenPath(project.cwd),
                        },
                      ],
              },
              { separator: true },
              {
                label: pathCopied ? 'Path copied' : 'Copy project path',
                icon: pathCopied ? <Check size={12} /> : <Copy size={12} />,
                onClick: copyPath,
              },
            ]}
          />
          <IconBtn label="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </IconBtn>
        </div>
      </div>

      {/* Path + scan freshness row */}
      <div className="mt-1 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={copyPath}
          title={pathCopied ? 'Copied' : 'Click to copy project path'}
          className="text-fg/40 hover:text-fg/70 min-w-0 truncate text-left font-mono text-[10px] transition"
        >
          {pathCopied ? 'Path copied' : project.cwd}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-[10px]">
          <span className="text-fg/40 tabular-nums">{scanFreshness(lastScanAt)}</span>
          <button
            type="button"
            onClick={onRescan}
            disabled={scanning}
            className={cn(
              'text-fg/55 hover:text-accent hover:bg-fg/5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition',
              scanning && 'hover:text-fg/55 cursor-not-allowed opacity-60 hover:bg-transparent',
            )}
            title={scanning ? 'Scan in progress…' : 'Rescan dependencies (all projects)'}
          >
            {scanning ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            <span>{scanning ? 'Scanning' : 'Rescan'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
