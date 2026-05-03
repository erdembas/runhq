import { FolderSearch, Loader2 } from 'lucide-react';

export function ScanLoadingOverlay({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border-border bg-surface-overlay flex flex-col items-center gap-4 border px-10 py-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex h-12 w-12 items-center justify-center">
          <div className="bg-accent/20 absolute inset-0 animate-ping" />
          <div className="bg-accent flex h-12 w-12 items-center justify-center shadow-lg">
            <FolderSearch className="h-5 w-5 text-white" />
          </div>
        </div>
        <div className="text-center">
          <div className="text-fg text-[11px] font-semibold">Scanning folder…</div>
          <div className="text-fg-dim mt-1 max-w-xs truncate text-[10px]" title={path}>
            {path}
          </div>
        </div>
        <Loader2 className="text-accent h-4 w-4 animate-spin" />
      </div>
    </div>
  );
}
