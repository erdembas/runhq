interface LogXtermDetailTooltipProps {
  detail: string;
  left: number;
  title: string;
  top: number;
}

export function LogXtermDetailTooltip({ detail, left, title, top }: LogXtermDetailTooltipProps) {
  return (
    <div
      className="border-border/80 bg-surface-raised/98 text-fg pointer-events-none absolute z-30 max-w-[min(560px,calc(100%-24px))] rounded-md border px-3 py-2 text-[11px] shadow-2xl shadow-black/35 backdrop-blur"
      style={{ left, top }}
    >
      <div className="text-fg-muted mb-1.5 truncate text-[10px] font-semibold tracking-[0.08em] uppercase">
        {title}
      </div>
      <pre className="text-fg max-h-64 overflow-hidden font-mono leading-relaxed whitespace-pre-wrap">
        {detail}
      </pre>
    </div>
  );
}
