import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  i18n.useLocale();
  const [i, setI] = useState(0);

  const slides: Slide[] = useMemo(
    () => [
      {
        id: 'welcome',
        icon: <Sparkles className="h-4 w-4" />,
        eyebrow: i18n.t('Welcome'),
        title: i18n.t('Meet RunHQ'),
        body: (
          <>
            {i18n.rich(
              'Your local dev services — Node, Go, .NET, Python, Docker and friends — all in {value1}. Native, offline, and entirely under your control.',
              { value1: <span className="text-fg font-medium">{i18n.t('one window')}</span> },
            )}
          </>
        ),
        visual: <HeroLogo />,
      },
      {
        id: 'shortcuts',
        icon: <Keyboard className="h-4 w-4" />,
        eyebrow: i18n.t('Keyboard superpowers'),
        title: i18n.t('Summon Quick Action from anywhere'),
        body: (
          <>
            {i18n.rich(
              'Press {value1} {value2} {value3} from {value4} to open Quick Action — a floating command bar for starting services, jumping between them, or scanning a new project. Inside RunHQ, the plain {value5} {value6} does the same.',
              {
                value1: <Kbd>{MOD}</Kbd>,
                value2: <Kbd>⇧</Kbd>,
                value3: <Kbd>K</Kbd>,
                value4: <span className="text-fg font-medium">{i18n.t('any app')}</span>,
                value5: <Kbd>{MOD}</Kbd>,
                value6: <Kbd>K</Kbd>,
              },
            )}
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
        eyebrow: i18n.t('Always running'),
        title: i18n.t('Lives in your menu bar'),
        body: (
          <>
            {i18n.rich(
              'Closing the window {value1} RunHQ — it keeps supervising your services in the background. Click the tray icon or press {value2} {value3} {value4} to bring it back. To actually exit, use {value5} from the tray menu.',
              {
                value1: <span className="text-fg font-medium">{i18n.t("doesn't quit")}</span>,
                value2: <Kbd>{MOD}</Kbd>,
                value3: <Kbd>⇧</Kbd>,
                value4: <Kbd>K</Kbd>,
                value5: <span className="text-fg font-medium">{i18n.t('Quit')}</span>,
              },
            )}
          </>
        ),
        visual: <TrayVisual />,
      },
      {
        id: 'ai',
        icon: <Bot className="h-4 w-4" />,
        eyebrow: i18n.t('Bring your own AI'),
        title: i18n.t('AI Assistant on every surface'),
        body: (
          <>
            {i18n.rich(
              'Plug any {value1} endpoint (OpenAI, Azure, OpenRouter, Ollama, vLLM, LiteLLM…) into {value2}. Then ask {value3} on any project, right-click any log line for triage, generate commit messages, polish your standup, or analyse a CVE — every answer lands in the same persistent chat on the right rail.',
              {
                value1: <span className="text-fg font-medium">{i18n.t('OpenAI-compatible')}</span>,
                value2: <span className="text-fg font-medium">{i18n.t('Settings → AI')}</span>,
                value3: <span className="text-fg font-medium">{i18n.t('Why?')}</span>,
              },
            )}
          </>
        ),
        visual: <AiHubVisual />,
      },
      {
        id: 'ready',
        icon: <Rocket className="h-4 w-4" />,
        eyebrow: i18n.t('Ready'),
        title: i18n.t("You're all set"),
        body: (
          <>
            {i18n.rich(
              'Add services from the sidebar, group them into stacks, and hit {value1} {value2} {value3} whenever you need to move fast.',
              { value1: <Kbd>{MOD}</Kbd>, value2: <Kbd>⇧</Kbd>, value3: <Kbd>K</Kbd> },
            )}
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
                {i18n.t('Skip tour')}
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
                aria-label={i18n.t('Go to step {value1}', { value1: idx + 1 })}
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
              {i18n.rich('{value1}Back', { value1: <ArrowLeft className="h-3.5 w-3.5" /> })}
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
                  {i18n.rich('{value1}Get started', { value1: <Check className="h-3.5 w-3.5" /> })}
                </>
              ) : (
                <>{i18n.rich('Next{value1}', { value1: <ArrowRight className="h-3.5 w-3.5" /> })}</>
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
