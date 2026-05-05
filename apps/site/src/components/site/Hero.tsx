import { ArrowRight } from 'lucide-react';
import { HeroTypewriter } from './HeroTypewriter';
import { getReleaseInfo } from '@/lib/release';

/**
 * Marketing hero — single-column, copy-first, premium product-launch
 * styling.
 *
 * Layered visual stack (back-to-front):
 *
 *   1. `radial-gradient(circle_at_top)` accent wash — same warm
 *      glow the legacy hero had, kept as the base ambient light.
 *   2. Fine grid pattern (`bg-grid-fade`) masked with a radial
 *      `mask-image` so it dissolves into the gradient near the
 *      edges — gives the surface a "graph paper" depth cue without
 *      drawing the eye to the corners.
 *   3. Logo halo glow — three stacked blurred discs behind the
 *      icon, sized to overflow the icon footprint so the brand
 *      mark feels emissive instead of flat-pasted.
 *   4. Foreground content: logo + version pill + h1 + subtitle +
 *      CTA pair + metric chip strip + "built with" credit.
 *
 * Why no hero video / inline cockpit:
 *   - The full-fidelity `<DesktopDashboard />` mockup renders
 *     directly beneath the hero, so the product visual is already
 *     there. The hero's job is brand + headline + CTA, not a
 *     second product shot.
 *   - The narrated walk-through (FullDemoSection, YouTube
 *     lite-embed) carries the "see it in motion" demand.
 *   - Server Component, zero JS to first paint. Every animation
 *     below uses CSS-only `motion-safe` classes that respect
 *     `prefers-reduced-motion`.
 */
export async function Hero() {
  const release = await getReleaseInfo();
  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      {/* Background layer 1 — base radial accent wash. */}
      <div
        aria-hidden
        className="from-accent/10 absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,_var(--tw-gradient-stops))] via-transparent to-transparent"
      />

      {/* Background layer 2 — fine grid pattern, masked to fade out
          at the edges. The mask uses a radial gradient (transparent
          edges → opaque center) so the grid doesn't fight the
          accent wash near the corners. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border)) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 75%)',
        }}
      />

      <div className="relative mx-auto max-w-4xl px-4 pt-16 pb-14 text-center sm:px-6 lg:pt-24 lg:pb-24">
        {/* RunHQ brand mark. The PNG ships its own 3D shading,
            inner highlights and drop shadow (it's the same asset
            macOS uses in the Dock), so we deliberately do NOT add
            a `ring`, `rounded-*` clip, or extra shadow on top of
            it — those would fight the icon's built-in dimensional
            design and flatten it.
            
            Instead we sit the icon over a soft, *cool* white +
            warm-amber halo combo. Putting an orange halo behind an
            orange icon turned into orange-on-orange mush, so we
            split the glow into two complementary tones: a cool
            white inner glow that lifts the icon off the background
            and a warm amber outer wash that ties it to the accent
            theme. The whole block breathes via
            `motion-safe:animate-pulse` (skipped under
            prefers-reduced-motion).
            
            `fetchPriority="high"` flags the icon to the browser as
            an LCP-critical asset so it lands in the first paint. */}
        <div className="relative mx-auto mb-7 flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
          <span
            aria-hidden
            className="absolute inset-[-50%] -z-10 rounded-full opacity-70 blur-3xl motion-safe:animate-pulse"
            style={{
              background:
                'radial-gradient(circle, rgba(251,146,60,0.35) 0%, rgba(251,146,60,0.10) 40%, transparent 70%)',
            }}
          />
          <span
            aria-hidden
            className="absolute inset-[-12%] -z-10 rounded-full blur-2xl"
            style={{
              background:
                'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.05) 50%, transparent 80%)',
            }}
          />
          <img
            src="/icon.png"
            alt="RunHQ"
            width={112}
            height={112}
            className="relative h-full w-full"
            decoding="async"
            fetchPriority="high"
          />
        </div>

        {/* Version pill. The leading green dot animates as a "live"
            indicator — visual stand-in for "this is a shipping
            product, current release: vX". */}
        <span className="border-accent/40 bg-accent/10 text-accent mx-auto inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="bg-accent absolute inset-0 rounded-full opacity-75 motion-safe:animate-ping" />
            <span className="bg-accent relative h-1.5 w-1.5 rounded-full" />
          </span>
          <span className="font-mono tabular-nums">{release.version}</span>
          <span className="text-accent/60" aria-hidden>
            ·
          </span>
          <span className="text-accent/80">local-first dev cockpit</span>
        </span>

        {/* Two-line h1:
              line 1 — short, static, brand-led ("One cockpit.")
              line 2 — accent typewriter rotating five short value
                       props ("for every service.", "for every log
                       line.", …)
            
            The structure reads as a single sentence
              "One cockpit. for every service."
            so the typewriter never feels disconnected from the
            stem. Same visual weight on both lines (font-size and
            tracking), only colour changes — `text-fg` for the
            stem, `text-accent` for the rotation. */}
        <h1
          id="hero-heading"
          className="text-fg mt-7 text-[48px] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-[64px] lg:text-[76px]"
        >
          One cockpit.
          <br />
          <em className="text-accent not-italic">
            <HeroTypewriter />
          </em>
        </h1>

        <p className="text-fg-muted mx-auto mt-6 max-w-xl text-[16px] leading-relaxed sm:text-[18px]">
          Your editor edits code. <strong className="text-fg">RunHQ runs it.</strong>
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#install"
            className="bg-accent text-accent-fg hover:bg-accent-hover shadow-accent/30 hover:shadow-accent/40 group inline-flex h-12 items-center gap-1.5 rounded-lg px-6 text-[14.5px] font-semibold shadow-xl transition hover:-translate-y-0.5"
          >
            Install free
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>
          <a
            href="#demo"
            className="border-border bg-surface/40 text-fg-muted hover:text-fg hover:border-accent/40 hover:bg-surface group inline-flex h-12 items-center gap-1.5 rounded-lg border px-5 text-[14.5px] font-medium backdrop-blur-sm transition"
          >
            <span className="bg-accent/15 text-accent flex h-5 w-5 items-center justify-center rounded-full">
              <span className="ml-0.5 inline-block border-y-[4px] border-l-[6px] border-y-transparent border-l-current" />
            </span>
            Watch the 5-min demo
          </a>
        </div>

        {/* Metric chip strip — replaces the legacy plain-bullet
            list. Each chip carries a status dot or icon so the eye
            reads the row as "live signals" instead of marketing
            copy. Uses font-mono for the numeric / brand tokens to
            inherit the same typographic register as the cockpit
            log + terminal primitives. */}
        <ul className="text-fg-muted mx-auto mt-9 flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[12px]">
          <li className="border-border/60 bg-surface/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 backdrop-blur-sm">
            <span className="bg-status-running h-1.5 w-1.5 rounded-full" />
            <span className="font-mono">Native · Tauri + Rust</span>
          </li>
          <li className="border-border/60 bg-surface/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 backdrop-blur-sm">
            <span className="font-mono tabular-nums">&lt; 100 MB RAM</span>
          </li>
          <li className="border-border/60 bg-surface/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 backdrop-blur-sm">
            <span className="font-mono tabular-nums">10 runtimes</span>
          </li>
          <li className="border-border/60 bg-surface/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 backdrop-blur-sm">
            <span className="font-mono">MIT</span>
          </li>
          <li className="border-border/60 bg-surface/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 backdrop-blur-sm">
            <span className="bg-status-running h-1.5 w-1.5 rounded-full" />
            <span>Zero telemetry</span>
          </li>
        </ul>
      </div>

      {/* Bottom edge fade — bridges the hero gradient into the
          DesktopDashboard section underneath without a hard line. */}
      <div
        aria-hidden
        className="from-surface pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t to-transparent"
      />
    </section>
  );
}
