/**
 * 0.7.0 release highlights — the "AI assistant, on every surface" chapter.
 *
 * Scope decision: 5 highlights again, mirroring 0.6.0's rhythm. The
 * temptation here was to do one giant "AI" slide and leave it at that,
 * but the reality is that the AI surface area touches three distinct
 * audiences:
 *
 *   • Power users who care about *how* the model is wired (BYO endpoint,
 *     model picker per turn, token meter, language picker) — slide 1.
 *   • Project maintainers who want AI inside the flows they already use
 *     (Why? / Log Triage / Diff / Commit / Standup / CVE) — slide 2.
 *   • Security-minded users staring at advisory lists who want the model
 *     to do the *triage* work for them — slide 3.
 *   • Engineers who care about the chat substrate itself (multi-tab,
 *     persistent history, action hooks) — slide 4.
 *   • Everyone, on the reliability fix that turned local-model output
 *     from a flaky beta into something you can leave running — slide 5.
 *
 * Compressing those into 3 highlights would have buried the per-CVE
 * analyzer (which is the single most "wow-this-is-magic" surface for
 * teams running dependency audits) under the generic chat hub blurb.
 *
 * Asset slugs map 1:1 to `apps/desktop/public/whatsnew/0.7.0/<slug>-{light,dark}.webp`.
 * Files that don't exist yet fall back to the in-component gradient,
 * so this content can ship before screenshots are produced.
 */
import {
  Bot,
  Brain,
  GitCommit,
  Languages,
  LayoutGrid,
  MessageSquare,
  Pin,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { WhatsNewRelease } from '../types';

export const release_0_7_0: WhatsNewRelease = {
  version: '0.7.0',
  releasedAt: '2026-04-27',
  headline: 'Bring your own AI — every surface speaks now.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md#070',
  highlights: [
    {
      id: 'ai-chat-hub',
      title: 'AI Chat Hub — bring your own LLM',
      badge: 'new',
      blurb:
        'A unified right-rail chat panel backed by any OpenAI-compatible ' +
        'endpoint — point it at OpenAI, Azure, Together, OpenRouter, vLLM, ' +
        'Ollama, LiteLLM, anything that speaks the same wire format. Switch ' +
        'models per turn, pick the response language with a flag-and-search ' +
        "dropdown, and watch a live token meter against the active model's " +
        'context window so you never blindly burn the budget.',
      media: {
        src: '/whatsnew/0.7.0/ai-chat-hub',
        themeAware: true,
        alt: 'AI chat hub on the right rail with model picker, language flag dropdown, and live token meter',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Bot className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'One panel, every model',
        tint: 'accent',
      },
      cta: { kind: 'store-action', label: 'Open AI Settings', actionId: 'open-ai-settings' },
    },
    {
      id: 'ai-on-every-surface',
      title: 'AI on every surface',
      badge: 'new',
      blurb:
        'Every existing AI affordance now routes into the same chat hub ' +
        'with full history: Project · Why? · Log right-click triage · Diff ' +
        'Explain · Commit message generation · Standup polish, plus a new ' +
        'Dashboard "Analyze workspace" button that builds a global report ' +
        'across every project. Per-turn action hooks like "Use as commit ' +
        'message" or "Insert into standup" let the model write *into* your ' +
        'flow, not just at it.',
      media: {
        src: '/whatsnew/0.7.0/ai-surfaces',
        themeAware: true,
        alt: 'Multiple AI surfaces — Why? popover, log triage, diff explain, commit generator — all routing into the right-side chat hub',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Sparkles className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Six surfaces, one history',
        tint: 'violet',
        bullets: [
          {
            icon: <MessageSquare className="h-4 w-4" />,
            label: 'Project · Why?',
            sub: 'Health summary, on demand',
          },
          {
            icon: <Radio className="h-4 w-4" />,
            label: 'Log triage',
            sub: 'Right-click any error',
          },
          {
            icon: <LayoutGrid className="h-4 w-4" />,
            label: 'Diff explain',
            sub: '"What does this change?"',
          },
          {
            icon: <GitCommit className="h-4 w-4" />,
            label: 'Commit messages',
            sub: 'Use-as-commit hook',
          },
          {
            icon: <Pin className="h-4 w-4" />,
            label: 'Standup polish',
            sub: 'Insert-as-standup hook',
          },
          {
            icon: <Brain className="h-4 w-4" />,
            label: 'Workspace report',
            sub: 'Dashboard global analysis',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open AI Chat', actionId: 'open-ai-chat' },
    },
    {
      id: 'cve-deep-analysis',
      title: 'Per-CVE Deep Analysis',
      badge: 'new',
      blurb:
        'Click the sparkles next to any advisory and the chat hub opens ' +
        'with a five-section structured report — TL;DR · Where it bites · ' +
        'Worst case · Am I likely affected? · Fix — strict-prompted so the ' +
        "model can't fabricate symbols that aren't in your codebase. " +
        'Distinct from the bulk Triage flow: this is the "tell me about ' +
        '*this one*" affordance you reach for when GHSA pages are too ' +
        'generic to act on.',
      media: {
        src: '/whatsnew/0.7.0/cve-analysis',
        themeAware: true,
        alt: 'Single-advisory chat with TL;DR / Where it bites / Worst case / Am I affected? / Fix sections',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <ShieldAlert className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Read the GHSA *for* you',
        tint: 'amber',
      },
      cta: {
        kind: 'store-action',
        label: 'Open Dashboard',
        actionId: 'open-overview',
      },
    },
    {
      id: 'multi-tab-history',
      title: 'Multi-tab chat with persistent history',
      badge: 'new',
      blurb:
        'Up to five conversations in a Cursor-style tab strip with ' +
        'streaming indicators per tab, FIFO eviction that never closes the ' +
        'active or in-flight stream, and a History drawer that pulls every ' +
        'past chat from a local SQLite store. Conversations survive ' +
        'restarts and crashes — switch projects, come back tomorrow, your ' +
        '"why is this slow?" thread is still there with all the context.',
      media: {
        src: '/whatsnew/0.7.0/multi-tab',
        themeAware: true,
        alt: 'Five chat tabs in the right rail with streaming indicators and the history drawer open below',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <LayoutGrid className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Five chats, all remembered',
        tint: 'sky',
      },
      cta: { kind: 'store-action', label: 'Open AI Chat', actionId: 'open-ai-chat' },
    },
    {
      id: 'streaming-reliability',
      title: 'Streaming that actually finishes',
      badge: 'improved',
      blurb:
        'Fixed the class of bugs where local / reasoning-heavy models cut ' +
        'out mid-sentence, hid the answer inside <thinking> blocks, or ' +
        'silently terminated on a non-ASCII character. Reasoning is now ' +
        'collapsed into a calm Cursor-style pill, content-progress drives ' +
        'the idle timeout (instead of a flat 60s), stalled streams ' +
        'auto-continue, an "answer hidden in reasoning" heuristic nudges ' +
        'the model to actually print, partial turns surface a Continue ' +
        'banner — and the UTF-8 panic that killed the worker on em-dashes ' +
        'is gone with regression tests.',
      media: {
        src: undefined,
        themeAware: false,
        alt: '',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Zap className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Six reliability wins',
        tint: 'emerald',
        bullets: [
          {
            icon: <Brain className="h-4 w-4" />,
            label: 'Reasoning pill',
            sub: 'Calm, separate, scrollable',
          },
          {
            icon: <Zap className="h-4 w-4" />,
            label: 'Content-progress timeout',
            sub: 'No more 60s flat-cuts',
          },
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: 'Auto-continue',
            sub: 'Stalled streams resume',
          },
          {
            icon: <ShieldCheck className="h-4 w-4" />,
            label: 'Hidden-answer nudge',
            sub: "Print, don't just think",
          },
          {
            icon: <MessageSquare className="h-4 w-4" />,
            label: 'Continue banner',
            sub: 'One click to finish a turn',
          },
          {
            icon: <Languages className="h-4 w-4" />,
            label: 'UTF-8 panic fix',
            sub: 'Em-dashes no longer kill streams',
          },
        ],
      },
      cta: {
        kind: 'store-action',
        label: 'Read full changelog',
        actionId: 'open-changelog',
      },
    },
  ],
};
