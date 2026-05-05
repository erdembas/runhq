'use client';

import { useEffect, useState } from 'react';

/**
 * Phrases the hero rotates through. Each one is a self-contained
 * value prop that reads naturally when prefixed with "One cockpit.".
 *
 * Edit guidance:
 *   - Keep them under ~24 chars so the line never wraps inside the
 *     h1 on mobile (≥ 320px).
 *   - End with a period — the visual rhythm is "type it · pause ·
 *     erase it", and a terminal sentence reads better than a
 *     fragment.
 *   - Order is intentional (service → log → port → CVE → machine):
 *     the loop walks outward from a single service to the whole
 *     workstation so visitors who only see the first 1-2 cycles
 *     still get the gist.
 */
const PHRASES = [
  'for every service.',
  'for every log line.',
  'for every stuck port.',
  'for every CVE.',
  'for your whole machine.',
];

/** Type / erase / hold pacing (ms). Calibrated against superset.sh
 *  + linear.app hero tickers — fast enough that one full phrase
 *  costs < 2 s, slow enough the eye reads each character. */
const TYPE_MS = 45;
const ERASE_MS = 22;
const HOLD_MS = 1500;

/**
 * Hero typewriter ticker.
 *
 * Why a tiny client component instead of a CSS-only `steps()`
 * animation:
 *   - Pure CSS typewriter only works for a single fixed-length
 *     phrase. We rotate through five, so we need state.
 *   - The full state machine is ~25 lines + zero deps. Tree-shakes
 *     down to ~700 bytes after gzip.
 *
 * SSR strategy: the initial state seeds `text` to `PHRASES[0]`
 * fully typed, so the server-rendered HTML reads as a complete
 * sentence. Crawlers index that copy, hydration kicks in client-
 * side and the cycle starts on the next tick. No layout shift on
 * first paint, no flash of empty headline.
 *
 * Accessibility:
 *   - `prefers-reduced-motion: reduce` short-circuits the loop —
 *     visitors with motion sensitivity see the seed phrase,
 *     statically, forever.
 *   - The animated span is `aria-hidden`, and an sr-only sibling
 *     carries a flat sentence summarising the rotation. Screen
 *     readers hear "RunHQ — one cockpit for every service, every
 *     log, every port, every CVE, your whole machine." once,
 *     instead of the same thing five times stuttering one
 *     character at a time.
 *
 * Caret: a 3px-wide accent block, blinking via the
 * `animate-caret-blink` utility (declared in globals.css).
 * `step-end` timing makes the blink hard on/off — terminal feel
 * rather than a smooth fade.
 */
export function HeroTypewriter() {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState<string>(PHRASES[0] ?? '');
  const [phase, setPhase] = useState<'typing' | 'erasing'>('typing');

  useEffect(() => {
    // Reduced-motion: never animate. Visitor sees the SSR seed
    // forever — zero distraction.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const phrase = PHRASES[idx] ?? '';
    const isTyping = phase === 'typing';

    if (isTyping) {
      // Still adding characters? Schedule the next one.
      if (text.length < phrase.length) {
        const t = setTimeout(() => setText(phrase.slice(0, text.length + 1)), TYPE_MS);
        return () => clearTimeout(t);
      }
      // Fully typed — hold the phrase before erasing it.
      const t = setTimeout(() => setPhase('erasing'), HOLD_MS);
      return () => clearTimeout(t);
    }

    // Erasing.
    if (text.length > 0) {
      const t = setTimeout(() => setText(text.slice(0, -1)), ERASE_MS);
      return () => clearTimeout(t);
    }

    // Erased to empty — advance to the next phrase. Wraps around.
    setIdx((i) => (i + 1) % PHRASES.length);
    setPhase('typing');
  }, [text, phase, idx]);

  return (
    <>
      <span aria-hidden className="inline-flex items-baseline">
        <span>{text}</span>
        <span className="bg-accent animate-caret-blink ml-1.5 inline-block h-[0.78em] w-[4px] translate-y-[0.05em] motion-reduce:animate-none" />
      </span>
      {/* Flat summary for screen readers — the rotating animation
          would otherwise announce as a stream of partial words. */}
      <span className="sr-only">
        for every service, every log line, every stuck port, every CVE — for your whole machine.
      </span>
    </>
  );
}
