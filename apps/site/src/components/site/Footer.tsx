/** Mirrors docs/index.html L848-867. */
export function Footer() {
  return (
    <footer className="border-border/60 border-t py-10">
      <div className="text-fg-muted mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-[12px] sm:flex-row sm:justify-between">
        <div className="text-fg flex items-center gap-2 font-semibold">
          <img src="/icon.png" alt="" width={20} height={20} className="rounded-md" />
          <span>RunHQ</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>MIT licensed</span>
          <span className="text-fg-dim/40">·</span>
          <a className="hover:text-fg" href="https://github.com/erdembas/runhq">
            GitHub
          </a>
          <span className="text-fg-dim/40">·</span>
          <a className="hover:text-fg" href="https://github.com/erdembas/runhq/issues">
            Issues
          </a>
          <span className="text-fg-dim/40">·</span>
          <a
            className="hover:text-fg"
            href="https://github.com/erdembas/runhq/blob/main/CHANGELOG.md"
          >
            Changelog
          </a>
          <span className="text-fg-dim/40">·</span>
          <span>
            by{' '}
            <a className="hover:text-fg" href="https://github.com/erdembas">
              @erdembas
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
