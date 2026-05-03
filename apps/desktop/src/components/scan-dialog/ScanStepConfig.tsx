import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CATEGORIES } from '@/lib/categories';
import { runtimeMeta } from '@/lib/runtimes';
import type { ProjectCandidate } from '@/types';
import type { ProjectConfig } from './types';

interface ScanStepConfigProps {
  candidates: ProjectCandidate[];
  selectedProjects: Set<string>;
  configs: Record<string, ProjectConfig>;
  addingCustom: string | null;
  customLabel: string;
  customCmd: string;
  onToggleSuggestion: (cwd: string, idx: number) => void;
  onSetCategory: (cwd: string, category: string) => void;
  onAddCustom: (cwd: string) => void;
  onRemoveCustom: (cwd: string, idx: number) => void;
  onSetAddingCustom: (cwd: string | null) => void;
  onSetCustomLabel: (v: string) => void;
  onSetCustomCmd: (v: string) => void;
}

export function ScanStepConfig({
  candidates,
  selectedProjects,
  configs,
  addingCustom,
  customLabel,
  customCmd,
  onToggleSuggestion,
  onSetCategory,
  onAddCustom,
  onRemoveCustom,
  onSetAddingCustom,
  onSetCustomLabel,
  onSetCustomCmd,
}: ScanStepConfigProps) {
  const selected = candidates.filter((c) => selectedProjects.has(c.cwd));

  return (
    <div className="space-y-3">
      {selected.map((c) => {
        const cfg = configs[c.cwd] ?? {
          selectedIndices: [],
          customCmds: [],
          category: 'other',
        };
        const isAdding = addingCustom === c.cwd;

        return (
          <div key={c.cwd} className="border-border bg-surface-raised rounded-app-sm border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-fg truncate text-[12px] font-semibold">{c.name}</div>
                <div className="text-fg-dim truncate text-[10px]" title={c.cwd}>
                  {c.cwd}
                </div>
              </div>
              <span
                className={cn(
                  'rounded-app-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] uppercase',
                  runtimeMeta(c.runtime).bg,
                  runtimeMeta(c.runtime).color,
                )}
              >
                {c.runtime}
              </span>
            </div>

            <div className="mt-2.5">
              <div className="text-fg-dim mb-1 text-[9px] font-semibold tracking-wider uppercase">
                Category
              </div>
              <div className="flex flex-wrap gap-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => onSetCategory(c.cwd, cat.key)}
                    className={cn(
                      'rounded-app-sm border px-2 py-0.5 text-[10px] transition',
                      cfg.category === cat.key
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-surface-muted text-fg-muted hover:border-border-strong hover:text-fg',
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2.5">
              <div className="text-fg-dim mb-1 text-[9px] font-semibold tracking-wider uppercase">
                Commands
              </div>
              <div className="flex flex-wrap gap-1">
                {c.suggestions.map((s, i) => {
                  const selected = cfg.selectedIndices.includes(i);
                  return (
                    <button
                      key={`${s.label}-${i}`}
                      onClick={() => onToggleSuggestion(c.cwd, i)}
                      className={cn(
                        'rounded-app-sm border px-1.5 py-0.5 text-[10px] transition',
                        selected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface-muted text-fg-muted hover:border-border-strong hover:text-fg',
                      )}
                      title={s.cmd}
                    >
                      {s.label}
                    </button>
                  );
                })}
                {cfg.customCmds.map((cc, i) => (
                  <span
                    key={`custom-${i}`}
                    className="border-accent/30 bg-accent/5 text-accent rounded-app-sm inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px]"
                    title={cc.cmd}
                  >
                    {cc.label}
                    <button
                      type="button"
                      className="hover:text-status-error ml-0.5 transition"
                      onClick={() => onRemoveCustom(c.cwd, i)}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>

              {isAdding ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    value={customLabel}
                    onChange={(e) => onSetCustomLabel(e.target.value)}
                    placeholder="Label"
                    className="border-border bg-surface-muted text-fg placeholder:text-fg-dim focus:border-accent rounded-app-sm h-5 w-20 border px-1.5 text-[10px] focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onAddCustom(c.cwd);
                      if (e.key === 'Escape') {
                        onSetAddingCustom(null);
                        onSetCustomLabel('');
                        onSetCustomCmd('');
                      }
                    }}
                    autoFocus
                  />
                  <input
                    value={customCmd}
                    onChange={(e) => onSetCustomCmd(e.target.value)}
                    placeholder="Command (e.g. make dev)"
                    className="border-border bg-surface-muted text-fg placeholder:text-fg-dim focus:border-accent rounded-app-sm h-5 min-w-0 flex-1 border px-1.5 text-[10px] focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onAddCustom(c.cwd);
                      if (e.key === 'Escape') {
                        onSetAddingCustom(null);
                        onSetCustomLabel('');
                        onSetCustomCmd('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => onAddCustom(c.cwd)}
                    disabled={!customLabel.trim() || !customCmd.trim()}
                    className="text-accent hover:text-accent/80 disabled:text-fg-dim text-[10px] font-medium transition"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetAddingCustom(null);
                      onSetCustomLabel('');
                      onSetCustomCmd('');
                    }}
                    className="text-fg-dim hover:text-fg text-[10px] transition"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetAddingCustom(c.cwd)}
                  className="text-fg-dim hover:text-fg hover:border-border rounded-app-sm mt-1.5 inline-flex items-center gap-1 border border-dashed border-transparent px-1.5 py-0.5 text-[10px] transition"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Custom command
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
