/**
 * First-run onboarding tour.
 *
 * A 4-step modal carousel that introduces the three things a new user cannot
 * discover on their own by looking at the UI:
 *
 *   1. That RunHQ exists as a proper app (brand moment / reassurance).
 *   2. The global shortcut (⌘/Ctrl + Shift + K) and the in-app shortcut
 *      (⌘/Ctrl + K), because the Quick Action window is the single biggest
 *      force multiplier and is otherwise invisible.
 *   3. That closing the window hides to the menu bar rather than quits — this
 *      is a behaviour that routinely traps new users of tray-resident apps.
 *
 * Dismissal is sticky via localStorage (`runhq.onboarding.tour.v1`); the user
 * can re-open the tour from Shortcut settings (entry point wired in App.tsx).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, Keyboard, Rocket, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { markTourSeen } from '@/lib/onboarding';
import { MOD_LABEL, MOD_SYMBOL } from '@/lib/platform';
import { Kbd } from '@/components/ui/Kbd';

interface Props {
  onClose: () => void;
  reopened?: boolean;
}

const MOD = MOD_SYMBOL;

interface Slide {
  id: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  visual: React.ReactNode;
}

function HeroLogo() {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 rounded-[24px]"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgb(var(--accent) / 0.45), transparent 65%)',
        }}
      />
      <img src="/runhq.svg" alt="" className="relative h-24 w-24 drop-shadow-xl" />
    </div>
  );
}

function ShortcutVisual() {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>⇧</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">— from anywhere</span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">— inside RunHQ</span>
      </div>
    </div>
  );
}

function TrayVisual() {
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

function AiHubVisual() {
  // Minimalist mockup of the right-rail chat panel. Drawn in CSS rather
  // than as a screenshot so it stays sharp at every zoom level and
  // re-themes automatically. Shows just enough surface to anchor the
  // copy: a model pill, a short reasoning trace, and the answer body —
  // the three artefacts the user will recognise once they actually
  // open the panel.
  return (
    <div className="border-border bg-surface-raised/80 rounded-app-md w-full max-w-[280px] overflow-hidden border shadow-md">
      <div className="border-border bg-surface-overlay/60 flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
          <Bot className="h-3 w-3" /> AI Assistant
        </span>
        <span className="border-border bg-surface-muted text-fg-dim rounded-full border px-1.5 py-px font-mono text-[9px]">
          gpt-4o
        </span>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="text-fg-muted text-[10.5px] leading-snug">Why is this build failing?</div>
        <div className="border-accent/30 bg-accent/5 rounded border-l-2 px-2 py-1.5">
          <div className="text-fg-dim mb-1 text-[9px] font-medium tracking-wide uppercase">
            Thinking
          </div>
          <div className="text-fg-dim/80 line-clamp-2 text-[10px] leading-snug italic">
            Stack trace points at a missing peer dep after the Tailwind v4 bump…
          </div>
        </div>
        <div className="text-fg space-y-1 text-[10.5px] leading-snug">
          <div>
            <strong className="font-semibold">Root cause:</strong> peer-dep mismatch.
          </div>
          <div className="text-fg-muted">Run `pnpm install --strict-peers`.</div>
        </div>
      </div>
    </div>
  );
}

function ReadyVisual() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-accent/15 text-accent flex h-16 w-16 items-center justify-center rounded-full">
        <Rocket className="h-8 w-8" strokeWidth={1.8} />
      </div>
      <div className="text-fg-dim text-center text-[12px] leading-relaxed">
        You can re-open this tour anytime from
        <span className="text-fg ml-1 font-medium">Settings → Shortcuts</span>.
      </div>
    </div>
  );
}

export function WelcomeTour({ onClose, reopened = false }: Props) {
  const [i, setI] = useState(0);

  const slides: Slide[] = useMemo(
    () => [
      {
        id: 'welcome',
        icon: <Sparkles className="h-4 w-4" />,
        eyebrow: 'Welcome',
        title: 'Meet RunHQ',
        body: (
          <>
            Your local dev services — Node, Go, .NET, Python, Docker and friends — all in{' '}
            <span className="text-fg font-medium">one window</span>. Native, offline, and entirely
            under your control.
          </>
        ),
        visual: <HeroLogo />,
      },
      {
        id: 'shortcuts',
        icon: <Keyboard className="h-4 w-4" />,
        eyebrow: 'Keyboard superpowers',
        title: 'Summon Quick Action from anywhere',
        body: (
          <>
            Press <Kbd>{MOD}</Kbd> <Kbd>⇧</Kbd> <Kbd>K</Kbd> from{' '}
            <span className="text-fg font-medium">any app</span> to open Quick Action — a floating
            command bar for starting services, jumping between them, or scanning a new project.
            Inside RunHQ, the plain <Kbd>{MOD}</Kbd> <Kbd>K</Kbd> does the same.
          </>
        ),
        visual: <ShortcutVisual />,
      },
      {
        id: 'tray',
        icon: (
          <span className="relative flex h-2 w-2">
            <span className="bg-status-running absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
            <span className="bg-status-running relative inline-flex h-2 w-2 rounded-full" />
          </span>
        ),
        eyebrow: 'Always running',
        title: 'Lives in your menu bar',
        body: (
          <>
            Closing the window <span className="text-fg font-medium">doesn&apos;t quit</span> RunHQ
            — it keeps supervising your services in the background. Click the tray icon or press{' '}
            <Kbd>{MOD}</Kbd> <Kbd>⇧</Kbd> <Kbd>K</Kbd> to bring it back. To actually exit, use{' '}
            <span className="text-fg font-medium">Quit</span> from the tray menu.
          </>
        ),
        visual: <TrayVisual />,
      },
      {
        id: 'ai',
        icon: <Bot className="h-4 w-4" />,
        eyebrow: 'Bring your own AI',
        title: 'AI Assistant on every surface',
        body: (
          <>
            Plug any <span className="text-fg font-medium">OpenAI-compatible</span> endpoint
            (OpenAI, Azure, OpenRouter, Ollama, vLLM, LiteLLM…) into{' '}
            <span className="text-fg font-medium">Settings → AI</span>. Then ask{' '}
            <span className="text-fg font-medium">Why?</span> on any project, right-click any log
            line for triage, generate commit messages, polish your standup, or analyse a CVE — every
            answer lands in the same persistent chat on the right rail.
          </>
        ),
        visual: <AiHubVisual />,
      },
      {
        id: 'ready',
        icon: <Rocket className="h-4 w-4" />,
        eyebrow: 'Ready',
        title: "You're all set",
        body: (
          <>
            Add services from the sidebar, group them into stacks, and hit <Kbd>{MOD}</Kbd>{' '}
            <Kbd>⇧</Kbd> <Kbd>K</Kbd> whenever you need to move fast.
          </>
        ),
        visual: <ReadyVisual />,
      },
    ],
    [],
  );

  const last = slides.length - 1;
  const isLast = i === last;
  const isFirst = i === 0;

  const finish = useCallback(() => {
    if (!reopened) markTourSeen();
    else markTourSeen(); // reopened still writes — treats manual open as "seen once"
    onClose();
  }, [onClose, reopened]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setI((n) => n + 1);
  }, [isLast, finish]);

  const prev = useCallback(() => {
    setI((n) => Math.max(0, n - 1));
  }, []);

  // Focus management so keyboard users get ⌨ traversal out of the gate.
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, finish]);

  const slide = slides[i]!;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-6 backdrop-blur-md"
      onClick={finish}
      role="dialog"
      aria-modal="true"
      aria-labelledby="runhq-tour-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-overlay animate-fade-in rounded-app-lg relative w-full max-w-lg overflow-hidden border shadow-2xl"
      >
        {/* Ambient ember glow — matches the brand mark */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 h-48 w-72 -translate-x-1/2 opacity-70"
          style={{
            background: 'radial-gradient(closest-side, rgb(var(--accent) / 0.35), transparent 70%)',
          }}
        />

        <div className="relative flex flex-col">
          <div className="flex items-center justify-between px-5 pt-4">
            <span className="text-fg-dim inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
              <span className="text-accent">{slide.icon}</span>
              {slide.eyebrow}
            </span>
            {!reopened && (
              <button
                type="button"
                onClick={finish}
                className="text-fg-dim hover:text-fg text-[11px] font-medium transition-colors"
              >
                Skip tour
              </button>
            )}
          </div>

          <div className="flex flex-col items-center gap-5 px-8 pt-6 pb-2">
            <div className="flex min-h-[120px] w-full items-center justify-center">
              {slide.visual}
            </div>
            <div className="space-y-2 text-center">
              <h2
                id="runhq-tour-title"
                className="text-fg text-[18px] font-semibold tracking-tight"
              >
                {slide.title}
              </h2>
              <p className="text-fg-muted mx-auto max-w-sm text-[13px] leading-relaxed">
                {slide.body}
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 px-5">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Go to step ${idx + 1}`}
                aria-current={idx === i}
                onClick={() => setI(idx)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  idx === i ? 'bg-accent w-6' : 'bg-border hover:bg-fg-dim/60 w-1.5',
                )}
              />
            ))}
          </div>

          <div className="bg-surface-raised/60 border-border mt-5 flex items-center justify-between gap-2 border-t px-4 py-3">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className={cn(
                'text-fg-dim hover:text-fg inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                isFirst && 'invisible',
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <span className="text-fg-dim font-mono text-[11px]">
              {i + 1} / {slides.length}
            </span>

            <button
              ref={primaryRef}
              type="button"
              onClick={next}
              className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Get started
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hint export so call sites can refer to the labeled modifier in copy. */
export const WELCOME_TOUR_MOD_LABEL = MOD_LABEL;
