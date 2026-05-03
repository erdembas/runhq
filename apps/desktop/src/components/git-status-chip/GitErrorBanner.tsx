import { X } from 'lucide-react';

interface GitErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export function GitErrorBanner({ message, onDismiss }: GitErrorBannerProps) {
  if (!message) return null;

  return (
    <div className="text-status-error bg-status-error/10 border-status-error/25 mt-2.5 flex max-h-24 items-start gap-1.5 overflow-y-auto rounded-md border px-2 py-1.5 text-[11px]">
      <span className="flex-1 wrap-break-word whitespace-pre-wrap">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-status-error/70 hover:text-status-error sticky top-0 shrink-0"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
