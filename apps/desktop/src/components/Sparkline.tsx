import { useMemo } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  /** Newest-last samples. Values are expected to be non-negative, usually
   *  CPU %. Negative values are clamped to 0. */
  data: number[] | undefined;
  width?: number;
  height?: number;
  /** Y-axis ceiling. Defaults to `max(100, observed peak)` so a normal
   *  1-core-cap service renders with a stable 100%-headroom baseline,
   *  while a multi-core burst can auto-expand without clipping. */
  ceiling?: number;
  className?: string;
}

/** Tiny inline SVG sparkline. Uses a polyline fill + stroke, no axes, no
 *  grid — density over detail. The fill tapers to `accent`-tinted
 *  transparency so the line reads crisp against any surface color. */
export function Sparkline({ data, width = 120, height = 32, ceiling, className }: Props) {
  const path = useMemo(() => {
    if (!data || data.length === 0) return null;
    const safeData = data.map((v) => Math.max(0, v));
    const peak = Math.max(...safeData, 0);
    const yMax = ceiling ?? Math.max(100, peak);
    // Handle the common "only 1 sample" case — a single dot would be
    // invisible at this resolution; draw it as a centered flat line
    // instead so the slot still communicates "we're measuring".
    if (safeData.length === 1) {
      const y = height - (safeData[0]! / yMax) * height;
      return {
        line: `M 0 ${y.toFixed(1)} L ${width} ${y.toFixed(1)}`,
        area: `M 0 ${height} L 0 ${y.toFixed(1)} L ${width} ${y.toFixed(1)} L ${width} ${height} Z`,
      };
    }
    const step = width / (safeData.length - 1);
    const points = safeData.map((v, i) => {
      const x = i * step;
      const y = height - (v / yMax) * height;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return {
      line: `M ${points.join(' L ')}`,
      area: `M 0 ${height} L ${points.join(' L ')} L ${width} ${height} Z`,
    };
  }, [data, width, height, ceiling]);

  if (!path) {
    return (
      <div
        aria-hidden
        className={cn('flex items-center justify-center text-[9px]', className)}
        style={{ width, height }}
      >
        <span className="text-fg-dim/60">no data</span>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block', className)}
      aria-hidden
    >
      <path d={path.area} fill="rgb(var(--accent) / 0.18)" stroke="none" />
      <path
        d={path.line}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
