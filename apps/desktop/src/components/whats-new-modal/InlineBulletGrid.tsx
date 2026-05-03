import type { HighlightFallback } from '@/lib/whatsnew';

export function InlineBulletGrid({ fallback }: { fallback: HighlightFallback }) {
  if (!fallback.bullets || fallback.bullets.length === 0) return null;

  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {fallback.bullets.map((bullet, index) => (
        <li
          key={index}
          className="bg-surface-raised/40 border-border/70 text-fg flex items-start gap-2 rounded-lg border px-2.5 py-2"
        >
          <span className="bg-surface-muted/70 text-fg/85 ring-border/70 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1">
            {bullet.icon}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
            <span className="text-fg truncate text-[11.5px] font-semibold tracking-tight">
              {bullet.label}
            </span>
            {bullet.sub && (
              <span className="text-fg-dim truncate font-mono text-[10px] tracking-tight">
                {bullet.sub}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
