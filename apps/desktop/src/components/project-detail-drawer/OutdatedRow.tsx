import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { OutdatedPackage } from '@/types';
import { CopyButton } from './CopyButton';
import { IconBtn } from './IconBtn';
import { SelectCheckbox } from './SelectCheckbox';
import { bumpTone, registryFallbackUrl, upgradeCommandForOutdated, type BumpGroup } from './model';

export function OutdatedRow({
  pkg,
  selected,
  onToggle,
  onOpenUrl,
  runtime,
}: {
  pkg: OutdatedPackage;
  selected: boolean;
  onToggle: () => void;
  onOpenUrl: (url: string) => void;
  runtime: string | null;
}) {
  const tone = bumpTone((pkg.bump as BumpGroup | null) ?? 'other');
  const registryUrl = pkg.homepage || registryFallbackUrl(pkg.name);
  const cmd = upgradeCommandForOutdated(runtime, pkg);

  return (
    <li
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={cn(
        'group/row hover:bg-fg/3 focus-visible:bg-fg/3 relative flex cursor-pointer items-center gap-2 px-4 py-1.5 transition outline-none',
        selected && 'bg-accent/5',
      )}
    >
      <SelectCheckbox selected={selected} onToggle={onToggle} />
      <span className="text-fg min-w-0 flex-1 truncate text-[12px] font-medium">{pkg.name}</span>
      {/*
        Version column — both values right-aligned in fixed-width
        boxes so the right edge of the list is clean (users read
        from the right edge: the "latest" is what matters). The
        arrow sits in a fixed-width slot between them so its x
        position is stable across rows regardless of how long the
        current/latest strings happen to be.
      */}
      <div className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] tabular-nums">
        <span className="text-fg/45 inline-block w-[60px] text-right">{pkg.current || '—'}</span>
        <span className="text-fg/25 inline-block w-3 text-center">→</span>
        <span className={cn('inline-block w-[64px] text-right font-semibold', tone.text)}>
          {pkg.latest || '—'}
        </span>
      </div>
      {/*
        Actions slot — fixed width so rows don't reflow when icons fade
        in on hover, and so rows where cmd/registryUrl happen to be
        null still end their version column at the same x-coordinate
        as every other row. Previously this was a `shrink-0` flex box
        whose width tracked its children, which caused the adjacent
        version column to drift left whenever a row had fewer buttons.
      */}
      <div
        className={cn(
          'flex w-[44px] shrink-0 items-center justify-end gap-0.5 transition',
          'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
        )}
      >
        {cmd && <CopyButton value={cmd} label="Copy upgrade command" />}
        {registryUrl && (
          <IconBtn
            size="sm"
            label={pkg.homepage ? 'Open package page' : 'Open on npm'}
            onClick={() => onOpenUrl(registryUrl)}
          >
            <ExternalLink size={11} />
          </IconBtn>
        )}
      </div>
    </li>
  );
}
