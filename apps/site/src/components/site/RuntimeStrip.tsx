/**
 * Auto-discovered runtimes strip — the horizontal "what RunHQ
 * understands" rail directly under the hero. Mirrors
 * docs/index.html L237-255. Server Component, zero JS.
 */
const RUNTIMES = [
  'Node.js',
  'Bun',
  'Deno',
  'Go',
  'Rust',
  '.NET',
  'Python',
  'Java · Maven',
  'Java · Gradle',
  'Ruby',
  'PHP',
  'Docker Compose',
];

export function RuntimeStrip() {
  return (
    <section
      aria-label="Supported runtimes"
      className="border-border/60 border-y bg-gradient-to-b from-transparent to-[rgb(var(--surface-muted)/0.4)] py-5"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6">
        <div className="text-fg-dim text-[10.5px] font-semibold tracking-[0.18em] uppercase">
          Auto-discovers
        </div>
        <div className="text-fg-muted flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[12px]">
          {RUNTIMES.map((rt, i) => (
            <span key={rt} className="flex items-center gap-4">
              <span>{rt}</span>
              {i < RUNTIMES.length - 1 && (
                <span className="text-fg-dim/40" aria-hidden>
                  ·
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
