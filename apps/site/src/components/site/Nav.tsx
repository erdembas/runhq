/**
 * Sticky top navigation.
 *
 * Anchor set is tuned to the SEO surface — `Compare` and `FAQ` live
 * in the bar specifically so:
 *   1. Visitors arriving from "X alternative" or product-question
 *      queries see a one-click route to the matching section.
 *   2. Google's anchor-link sitelink mining is given high-priority
 *      hits to the `#alternatives` and `#faq` IDs (paired with the
 *      sitemap entries in `app/sitemap.ts`).
 *
 * Server Component on purpose — no interactive state, smooth-
 * scroll anchors come from `scroll-smooth` on `<html>`.
 */
export function Nav() {
  return (
    <header className="border-border/60 bg-surface/80 supports-[backdrop-filter]:bg-surface/60 sticky top-0 z-50 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <a href="#" className="text-fg flex items-center gap-2 text-[14px] font-semibold">
          <img src="/icon.png" alt="" width={22} height={22} className="rounded-md" />
          <span>RunHQ</span>
        </a>
        <nav
          className="text-fg-muted hidden items-center gap-5 text-[13px] md:flex"
          aria-label="Primary"
        >
          <a className="hover:text-fg transition" href="#demo">
            Demo
          </a>
          <a className="hover:text-fg transition" href="#loop">
            Tour
          </a>
          <a className="hover:text-fg transition" href="#features">
            Features
          </a>
          <a className="hover:text-fg transition" href="#alternatives">
            Compare
          </a>
          <a className="hover:text-fg transition" href="#install">
            Install
          </a>
          <a className="hover:text-fg transition" href="#faq">
            FAQ
          </a>
          <a
            className="hover:text-fg transition"
            href="https://github.com/erdembas/runhq"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
        <a
          href="#install"
          className="bg-accent text-accent-fg hover:bg-accent-hover ml-auto inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-semibold transition"
        >
          Get RunHQ
        </a>
      </div>
    </header>
  );
}
