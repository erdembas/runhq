import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { runtimeMeta } from '@/lib/runtimes';
import type { ProjectCandidate } from '@/types';

interface ScanStepProjectsProps {
  candidates: ProjectCandidate[];
  selectedProjects: Set<string>;
  onToggle: (cwd: string) => void;
}

export function ScanStepProjects({
  candidates,
  selectedProjects,
  onToggle,
}: ScanStepProjectsProps) {
  return (
    <div className="space-y-1.5">
      {candidates.map((c) => {
        const selected = selectedProjects.has(c.cwd);
        return (
          <button
            key={c.cwd}
            type="button"
            onClick={() => onToggle(c.cwd)}
            className={cn(
              'border-border bg-surface-raised rounded-app-sm w-full border p-2.5 text-left transition',
              selected && 'border-accent/60 bg-accent/5',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-fg truncate text-[11px] font-medium">{c.name}</div>
                {c.project_name && c.project_name !== c.name ? (
                  <div className="text-fg-dim truncate text-[10px]">
                    <span className="text-fg-muted">Project:</span> {c.project_name}
                  </div>
                ) : (
                  <div className="text-fg-dim truncate text-[10px]" title={c.cwd}>
                    {c.cwd}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-app-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] uppercase',
                    runtimeMeta(c.runtime).bg,
                    runtimeMeta(c.runtime).color,
                  )}
                >
                  {c.runtime}
                </span>
                <div
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition',
                    selected ? 'border-accent bg-accent text-white' : 'border-border-strong',
                  )}
                >
                  {selected && <X className="h-2.5 w-2.5" strokeWidth={3} />}
                </div>
              </div>
            </div>
            <div className="text-fg-dim mt-1 flex flex-wrap gap-1">
              {c.suggestions.map((s) => (
                <span
                  key={s.label}
                  className="bg-surface-muted rounded-app-sm px-1.5 py-0.5 text-[9px]"
                  title={s.cmd}
                >
                  {s.label}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
