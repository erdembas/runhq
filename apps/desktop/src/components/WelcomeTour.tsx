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
import { AiHubVisual } from '@/components/welcome-tour/AiHubVisual';
import { HeroLogo } from '@/components/welcome-tour/HeroLogo';
import { ReadyVisual } from '@/components/welcome-tour/ReadyVisual';
import { ShortcutVisual } from '@/components/welcome-tour/ShortcutVisual';
import { TrayVisual } from '@/components/welcome-tour/TrayVisual';
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
