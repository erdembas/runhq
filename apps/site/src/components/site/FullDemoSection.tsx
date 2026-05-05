import { LiteYouTube } from './LiteYouTube';

/**
 * Full-bleed "watch the demo" section. Lives between the React
 * dashboard mock and the runtime strip — gives visitors who want a
 * narrated walk-through a clear entry point without forcing the
 * full-demo download on every page load.
 *
 * Hosting choice: the demo lives on YouTube rather than our own CDN.
 * Reasons:
 *   - Adaptive bitrate streaming (HLS/DASH) for free, instead of
 *     forcing every visitor through a single high-bitrate WebM.
 *   - Player UX (chapters, captions, transcripts, picture-in-picture,
 *     2x speed) ships out of the box.
 *   - Zero egress cost, infinite cache.
 *
 * Performance: we use a "lite-embed" pattern via {@link LiteYouTube}.
 * Initial paint ships only a static thumbnail (`maxresdefault.jpg`,
 * ~30-100 KB) plus a play button. The 600 KB YouTube iframe
 * JavaScript and any tracking pixels load lazily, on click.
 *
 * Privacy: the embed origin is `youtube-nocookie.com`, which defers
 * cookie writes until the visitor actually plays the video. CSP in
 * `apps/site/_headers` whitelists this origin under `frame-src`.
 */
export function FullDemoSection() {
  return (
    <section id="demo" className="relative isolate scroll-mt-24" aria-labelledby="demo-heading">
      <div
        aria-hidden
        className="from-accent/6 absolute inset-0 -z-10 bg-[radial-gradient(circle_at_bottom,_var(--tw-gradient-stops))] via-transparent to-transparent"
      />
      <div className="mx-auto max-w-[1440px] px-4 pt-12 pb-20 sm:px-6 lg:pt-16 lg:pb-28 xl:px-10">
        <div className="mb-6 flex flex-col gap-2">
          <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
            Watch the loop · Full demo
          </span>
          <h2
            id="demo-heading"
            className="text-fg max-w-2xl text-[28px] leading-[1.1] font-semibold tracking-tight sm:text-[34px]"
          >
            The full daily loop, in five minutes.
          </h2>
          <p className="text-fg-muted max-w-2xl text-[14.5px] leading-relaxed">
            Discover repos, start the stack, chase logs, triage CVEs, ask AI for next actions —
            captured straight off a real workspace. Click play and you&rsquo;re in.
          </p>
        </div>

        <div className="border-border bg-surface scroll-zoom-in-late relative overflow-hidden rounded-xl border shadow-2xl">
          <LiteYouTube
            videoId="9rc44683e1s"
            title="RunHQ — the full daily loop"
            durationLabel="4:50"
            caption="Recorded on a real M1 workspace, no cuts"
          />
        </div>
      </div>
    </section>
  );
}
