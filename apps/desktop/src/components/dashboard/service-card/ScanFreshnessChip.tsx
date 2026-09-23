import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const SCAN_AGING_MS = 24 * 60 * 60_000;
const SCAN_STALE_MS = 7 * 24 * 60 * 60_000;

function scanAgeLabel(scannedAtMs: number, now: number): string {
  const diff = Math.max(0, now - scannedAtMs);
  if (diff < 60_000) return i18n.t('just now');
  if (diff < 3_600_000) return i18n.t('{value1}m ago', { value1: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return i18n.t('{value1}h ago', { value1: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000)
    return i18n.t('{value1}d ago', { value1: Math.floor(diff / 86_400_000) });
  if (diff < 30 * 86_400_000)
    return i18n.t('{value1}w ago', { value1: Math.floor(diff / (7 * 86_400_000)) });
  return i18n.t('{value1}mo ago', { value1: Math.floor(diff / (30 * 86_400_000)) });
}

interface ScanFreshnessChipProps {
  visible?: boolean;
  scannedAtMs: number;
  durationMs: number | null;
  rescanning: boolean;
  onRescan?: () => void;
}

export function ScanFreshnessChip({
  visible = true,
  scannedAtMs,
  durationMs,
  rescanning,
  onRescan,
}: ScanFreshnessChipProps) {
  i18n.useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [visible]);

  const age = now - scannedAtMs;
  const tone =
    age >= SCAN_STALE_MS
      ? 'bg-tone-danger/10 text-tone-danger-fg'
      : age >= SCAN_AGING_MS
        ? 'bg-tone-warning/10 text-tone-warning-fg'
        : 'bg-fg-dim/10 text-fg-dim';
  const recommendation =
    age >= SCAN_STALE_MS
      ? i18n.t(' — rescan recommended')
      : age >= SCAN_AGING_MS
        ? i18n.t(' — consider rescanning')
        : '';

  const tooltip = rescanning
    ? i18n.t('Rescanning this project…')
    : i18n.t('Last scanned {value1}{value2}{recommendation}{value4}', {
        value1: new Date(scannedAtMs).toLocaleString(i18n.getFormatLocale()),
        value2:
          durationMs != null
            ? i18n.t(' (took {value1}s)', {
                value1: i18n.number(durationMs / 1000, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                  useGrouping: false,
                }),
              })
            : '',
        recommendation: recommendation,
        value4: onRescan ? i18n.t(' · click to rescan') : '',
      });

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
      aria-label={i18n.t('Last scanned {value1}', { value1: scanAgeLabel(scannedAtMs, now) })}
    >
      <History className="h-3 w-3" />
      {label}
    </span>
  );
}
