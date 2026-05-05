import { Star } from 'lucide-react';

/**
 * Final call-to-action.
 *
 * Closing visual rhythm: the page opens with the logo + halo in
 * the hero, and closes with a smaller, dimmer reprise of the same
 * mark here. Visitors who scroll all the way through get a "logo
 * bracket" around the entire narrative — same bookend trick Apple
 * keynote pages use.
 */
export function FinalCta() {
  return (
    <section className="border-border/60 border-t bg-[rgb(var(--surface-muted)/0.4)] py-24">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 text-center">
        {/* Closing brand mark — smaller than the hero (h-14) and
            with a softer halo so it punctuates the scroll without
            re-stealing the spotlight. The same icon asset is used
            so retina caches stay warm across the page. */}
        <div className="relative mb-2 flex h-14 w-14 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-[-40%] -z-10 rounded-full opacity-60 blur-2xl"
            style={{
              background: 'radial-gradient(circle, rgba(251,146,60,0.3) 0%, transparent 70%)',
            }}
          />
          <img src="/icon.png" alt="" width={56} height={56} className="h-full w-full" />
        </div>

        <h2 className="text-fg text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Stop carrying your dev setup in terminal tabs.{' '}
          <em className="text-accent not-italic">Start from RunHQ.</em>
        </h2>
        <p className="text-fg-muted text-[14px]">
          Free · MIT · macOS · Linux · Windows · &lt; 100 MB RAM
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="#install"
            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex h-11 items-center rounded-lg px-5 text-[14px] font-semibold transition"
          >
            Get RunHQ
          </a>
          <a
            href="https://github.com/erdembas/runhq"
            className="border-border text-fg hover:border-accent/40 hover:text-accent inline-flex h-11 items-center gap-1.5 rounded-lg border px-5 text-[14px] font-semibold transition"
          >
            Star on GitHub
            <Star className="h-3.5 w-3.5 fill-current" />
          </a>
        </div>
        <p className="text-fg-dim text-[12px]">No account. No credit card. No telemetry.</p>
      </div>
    </section>
  );
}
