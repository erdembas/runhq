import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

export function NotScannedState({
  kind,
  onRescan,
  scanning,
}: {
  kind: 'audit' | 'outdated';
  onRescan: () => void;
  scanning: boolean;
}) {
  const copy =
    kind === 'audit'
      ? {
          title: 'No audit run yet',
          hint: 'Scan dependencies to fetch open CVEs and advisories for this project.',
        }
      : {
          title: 'No outdated check yet',
          hint: 'Scan dependencies to compare the current lockfile against the latest registry versions.',
        };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-fg/80 text-[13px] font-medium">{copy.title}</p>
      <p className="text-fg/45 max-w-[280px] text-[11px]">{copy.hint}</p>
      <button
        type="button"
        onClick={onRescan}
        disabled={scanning}
        className={cn(
          'bg-accent/15 text-accent hover:bg-accent/25 mt-1 inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-medium transition',
          scanning && 'cursor-not-allowed opacity-60',
        )}
      >
        {scanning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        {scanning ? 'Scanning…' : 'Scan dependencies'}
      </button>
    </div>
  );
}
