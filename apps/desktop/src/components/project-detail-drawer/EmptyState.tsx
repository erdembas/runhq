export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-fg/60 text-[12px] font-medium">{title}</p>
      <p className="text-fg/40 max-w-[280px] text-[11px]">{hint}</p>
    </div>
  );
}
