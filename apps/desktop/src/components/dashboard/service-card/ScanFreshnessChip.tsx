import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const SCAN_AGING_MS = 24 * 60 * 60_000;
const SCAN_STALE_MS = 7 * 24 * 60 * 60_000;

function scanAgeLabel(scannedAtMs: number, now: number): string {
  const diff = Math.max(0, now - scannedAtMs);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / (7 * 86_400_000))}w ago`;
  return `${Math.floor(diff / (30 * 86_400_000))}mo ago`;
}

interface ScanFreshnessChipProps {
  scannedAtMs: number;
  durationMs: number | null;
  rescanning: boolean;
  onRescan?: () => void;
}

export function ScanFreshnessChip({
  scannedAtMs,
  durationMs,
  rescanning,
  onRescan,
}: ScanFreshnessChipProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const age = now - scannedAtMs;
  const tone =
    age >= SCAN_STALE_MS
      ? 'bg-tone-danger/10 text-tone-danger-fg'
      : age >= SCAN_AGING_MS
        ? 'bg-tone-warning/10 text-tone-warning-fg'
        : 'bg-fg-dim/10 text-fg-dim';
  const recommendation =
    age >= SCAN_STALE_MS
      ? ' — rescan recommended'
      : age >= SCAN_AGING_MS
        ? ' — consider rescanning'
        : '';

  const tooltip = rescanning
    ? 'Rescanning this project…'
    : `Last scanned ${new Date(scannedAtMs).toLocaleString()}${
        durationMs != null ? ` (took ${(durationMs / 1000).toFixed(1)}s)` : ''
      }${recommendation}${onRescan ? ' · click to rescan' : ''}`;

  const label = rescanning ? 'scanning…' : scanAgeLabel(scannedAtMs, now);
  const sharedClass = cn(
    'rounded-app-sm inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition',
    tone,
    onRescan && !rescanning && 'cursor-pointer hover:brightness-110',
    rescanning && 'opacity-70 cursor-wait',
  );

  if (onRescan) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!rescanning) onRescan();
        }}
        disabled={rescanning}
        className={sharedClass}
        title={tooltip}
        aria-label={tooltip}
      >
        {rescanning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <History className="h-3 w-3" />
        )}
        {label}
      </button>
    );
  }

  return (
    <span
      className={sharedClass}
      title={tooltip}
      aria-label={`Last scanned ${scanAgeLabel(scannedAtMs, now)}`}
    >
      <History className="h-3 w-3" />
      {label}
    </span>
  );
}
