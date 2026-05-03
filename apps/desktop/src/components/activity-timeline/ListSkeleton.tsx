import { cn } from '@/lib/cn';

export function ListSkeleton({ isInline, padX }: { isInline: boolean; padX: string }) {
  void isInline;
  return (
    <div className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={cn('border-border/20 flex items-start gap-3 border-b py-3', padX)}>
          <div className="bg-fg/5 mt-0.5 h-5 w-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="bg-fg/5 h-3 w-16 rounded" />
              <div className="bg-fg/5 h-3 w-24 rounded" />
              <div className="bg-fg/5 ml-auto h-3 w-10 rounded" />
            </div>
            <div className="bg-fg/5 h-2.5 rounded" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
