import * as i18n from '@runhq/cockpit-ui/i18n';
import {
  Columns2,
  FoldVertical,
  GitBranch,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rows2,
  UnfoldVertical,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconTool } from './IconTool';
import type { DiffViewMode } from '@/components/git/DiffPane';

interface CrossProjectDiffTitlebarProps {
  isFullscreen: boolean;
  isMac: boolean;
  totalServices: number;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  anyLoading: boolean;
  viewMode: DiffViewMode;
  onRefresh: () => void;
  onViewModeChange: (mode: DiffViewMode) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function CrossProjectDiffTitlebar({
  isFullscreen,
  isMac,
  totalServices,
  totalFiles,
  totalAdditions,
  totalDeletions,
  anyLoading,
  viewMode,
  onRefresh,
  onViewModeChange,
  onExpandAll,
  onCollapseAll,
  onToggleFullscreen,
  onClose,
}: CrossProjectDiffTitlebarProps) {
  i18n.useLocale();
  return (
    <div
      {...(isFullscreen && isMac ? { 'data-tauri-drag-region': true } : {})}
      className={cn(
        'border-border flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-3',
        isFullscreen && isMac ? 'pl-[84px]' : 'pl-3',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch size={15} className="text-accent shrink-0" />
        <h2 className="text-fg shrink-0 text-[13px] font-semibold whitespace-nowrap">
          {i18n.t('Uncommitted Across Projects')}
        </h2>
        <span className="text-fg/30 shrink-0">·</span>
        <span className="text-fg/60 flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          <span>
            {i18n.rich('{totalServices} project{plural2}', {
              totalServices: totalServices,
              plural2: totalServices === 1 ? '' : 's',
            })}
          </span>
          <span className="text-fg/30">·</span>
          <span>
            {i18n.rich('{totalFiles} file{plural2}', {
              totalFiles: totalFiles,
              plural2: totalFiles === 1 ? '' : 's',
            })}
          </span>
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <>
              <span className="text-fg/30">·</span>
              <span>
                {totalAdditions > 0 && <span className="text-emerald-400">+{totalAdditions}</span>}
                {totalAdditions > 0 && totalDeletions > 0 && <span className="text-fg/30"> </span>}
                {totalDeletions > 0 && <span className="text-rose-400">−{totalDeletions}</span>}
              </span>
            </>
          )}
          {anyLoading && <RefreshCw size={11} className="text-fg/30 ml-1 animate-spin" />}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconTool
          onClick={onRefresh}
          tooltip={i18n.t('Refresh diffs')}
          disabled={anyLoading}
          icon={<RefreshCw size={13} className={anyLoading ? 'animate-spin' : ''} />}
        />
        <div className="bg-border/60 mx-1 h-5 w-px" />
        <IconTool
          onClick={() => onViewModeChange('side-by-side')}
          tooltip={i18n.t('Side-by-side')}
          active={viewMode === 'side-by-side'}
          icon={<Columns2 size={13} />}
        />
        <IconTool
          onClick={() => onViewModeChange('inline')}
          tooltip={i18n.t('Inline')}
          active={viewMode === 'inline'}
          icon={<Rows2 size={13} />}
        />
        <div className="bg-border/60 mx-1 h-5 w-px" />
        <IconTool
          onClick={onExpandAll}
          tooltip={i18n.t('Expand all')}
          icon={<UnfoldVertical size={13} />}
        />
        <IconTool
          onClick={onCollapseAll}
          tooltip={i18n.t('Collapse all')}
          icon={<FoldVertical size={13} />}
        />
        <div className="bg-border/60 mx-1 h-5 w-px" />
        <IconTool
          onClick={onToggleFullscreen}
          tooltip={isFullscreen ? i18n.t('Restore') : i18n.t('Fullscreen (F11)')}
          icon={isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        />
        <IconTool onClick={onClose} tooltip={i18n.t('Close (Esc)')} icon={<X size={14} />} />
      </div>
    </div>
  );
}
