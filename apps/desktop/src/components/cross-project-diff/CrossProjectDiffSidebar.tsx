import { Search, X } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { ServiceSection } from './ServiceSection';
import type { Selection, ServiceTree } from './types';

interface CrossProjectDiffSidebarProps {
  width: number;
  search: string;
  serviceTrees: ServiceTree[];
  anyLoading: boolean;
  collapsedServices: Set<string>;
  expandedFolders: Set<string>;
  selection: Selection | null;
  onSearchChange: (value: string) => void;
  onToggleService: (serviceId: string) => void;
  onToggleFolder: (path: string) => void;
  onSelect: (serviceId: string, source: 'unstaged' | 'staged', path: string) => void;
  onOpenInDiffViewer: (serviceId: string) => void;
}

export function CrossProjectDiffSidebar({
  width,
  search,
  serviceTrees,
  anyLoading,
  collapsedServices,
  expandedFolders,
  selection,
  onSearchChange,
  onToggleService,
  onToggleFolder,
  onSelect,
  onOpenInDiffViewer,
}: CrossProjectDiffSidebarProps) {
  return (
    <aside className="border-border flex shrink-0 flex-col border-r" style={{ width }}>
      <div className="border-border shrink-0 border-b p-2">
        <div className="relative">
          <Search
            size={12}
            className="text-fg/40 pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter by file or project…"
            className="border-border bg-surface text-fg placeholder:text-fg/40 focus:border-accent/60 h-7 w-full rounded border pr-6 pl-7 text-[12px] transition focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="text-fg/40 hover:text-fg absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label="Clear filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {serviceTrees.length === 0 && <EmptyState search={search} anyLoading={anyLoading} />}
        {serviceTrees.map((tree) => (
          <ServiceSection
            key={tree.project.service_id}
            tree={tree}
            collapsed={collapsedServices.has(tree.project.service_id)}
            expandedFolders={expandedFolders}
            onToggleService={() => onToggleService(tree.project.service_id)}
            onToggleFolder={onToggleFolder}
            selection={selection}
            onSelect={(source, path) => onSelect(tree.project.service_id, source, path)}
            onOpenInDiffViewer={() => onOpenInDiffViewer(tree.project.service_id)}
          />
        ))}
      </div>
    </aside>
  );
}
