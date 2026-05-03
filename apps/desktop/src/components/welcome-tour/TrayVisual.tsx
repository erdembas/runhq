export function TrayVisual() {
  return (
    <div className="relative w-full">
      <div
        aria-hidden
        className="from-surface-muted/70 via-surface-raised/40 pointer-events-none absolute inset-x-0 top-0 h-8 rounded-t-[10px] bg-gradient-to-b to-transparent"
      />
      <div className="border-border bg-surface-raised relative flex items-center gap-2 rounded-t-[10px] border border-b-0 px-3 py-1.5">
        <span className="text-fg-dim ml-auto text-[11px] tracking-tight">macOS menu bar</span>
        <span
          className="bg-surface-muted border-border flex h-5 w-5 items-center justify-center rounded-md border"
          aria-label="RunHQ tray icon"
        >
          <img src="/runhq.svg" alt="" className="h-4 w-4" />
        </span>
      </div>
      <div className="border-border bg-surface-overlay rounded-b-[10px] border border-t-0 px-3 py-2">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-fg">Show RunHQ</span>
          <span className="text-fg-dim font-mono text-[10px]">click tray</span>
        </div>
        <div className="bg-border/60 my-1.5 h-px" />
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-fg-dim">Quit</span>
          <span className="text-fg-dim font-mono text-[10px]">exits the app</span>
        </div>
      </div>
    </div>
  );
}
