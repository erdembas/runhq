import type { ReactNode } from 'react';

export function ZeroState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon}
      <p className="text-fg/80 text-[13px] font-medium">{title}</p>
      <p className="text-fg/45 max-w-[280px] text-[11px]">{hint}</p>
    </div>
  );
}
