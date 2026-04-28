/**
 * 0.7.0 release highlights — the "AI assistant, on every surface" chapter.
 *
 * Scope decision: 6 highlights. The first five tell the AI story; the
 * sixth covers the dependency-hygiene work that ships in the same
 * release because it's the substrate the per-CVE analyzer reasons
 * about — no point selling "AI explains your advisories" if the
 * advisory data is stale, untracked, or invisible after a restart.
 *
 * Provider narrative (slide 1): we lead with **Huawei Cloud MaaS** as
 * the recommended path. It's the only first-party-supported gateway
 * that exposes a curated catalog of high-quality open-source models
 * (GLM-4.5 / 5.1, DeepSeek-V3.x / R1, Qwen2.5 / 3, Llama 3.x, Yi,
 * Baichuan, …) under one OpenAI-compatible endpoint, with predictable
 * pricing and Turkish-region latency through Mersel. RunHQ's hero
 * banner already tells users it was built on HWC MaaS — the chat hub
 * doubles down on that story. Other OpenAI-compatible clouds (OpenAI,
 * Azure, OpenRouter, Groq, Together, DeepSeek direct, Anthropic via
 * LiteLLM) are mentioned as also-supported, and local servers
 * (Ollama, LM Studio, vLLM, llama.cpp) ship as the privacy-first
 * fallback for users who can't or won't egress.
 *
 * The six audiences we tell apart:
 *
 *   • Power users picking a provider — sold on HWC MaaS first, told
 *     about cloud/local fallbacks afterwards — slide 1.
 *   • Project maintainers who want AI inside the flows they already use
 *     (Why? / Log Triage / Diff / Commit / Standup / CVE) — slide 2.
 *     The new under-button model-picker popover lives here too.
 *   • Security-minded users staring at advisory lists who want the model
 *     to do the *triage* work for them — slide 3.
 *   • Engineers who care about the chat substrate itself (multi-tab,
 *     persistent history, action hooks) — slide 4.
 *   • Everyone, on the reliability fix that turned reasoning-heavy
 *     model output from a flaky beta into something you can leave
 *     running — slide 5.
 *   • Workspace operators tracking dependency drift across N projects
 *     who need persistence, freshness, and per-project rescan — slide 6.
 *
 * Asset slugs map 1:1 to `apps/desktop/public/whatsnew/0.7.0/<slug>-{light,dark}.webp`.
 * Files that don't exist yet fall back to the in-component gradient,
 * so this content can ship before screenshots are produced.
 */
import {
  Bot,
  Brain,
  Cloud,
  Cpu,
  Database,
  GitCommit,
  History,
  Languages,
  LayoutGrid,
  Lock,
  MessageSquare,
  MousePointerClick,
  Package,
  Pin,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
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
      title: 'AI Chat Hub — bring your own model',
      badge: 'new',
      blurb:
        'A unified right-rail chat panel that works with any ' +
        'OpenAI-compatible endpoint — cloud or local. Huawei Cloud MaaS ' +
        'is the recommended path for open-source models (GLM, DeepSeek, ' +
        'Qwen, Llama under one curated catalog); OpenAI, Azure, ' +
        'OpenRouter, Groq, and Ollama / LM Studio / vLLM / llama.cpp all ' +
        'plug in the same way. Configure once and the same hub powers ' +
        'Why? · Log triage · Diff explain · Commit messages · CVE ' +
        'analysis · workspace reports · standup polish. Switch models ' +
        'per turn, pick a reply language, and watch a live token meter ' +
        "tick against the active model's context window.",
      media: {
        src: '/whatsnew/0.7.0/ai-chat-hub',
        themeAware: true,
        alt: 'AI Settings with a Huawei Cloud MaaS provider, an OpenAI provider, and the right-rail chat hub streaming an answer with the model picker, flag dropdown, and token meter visible',
        aspectRatio: '16/9',
      },
      fallback: {
        // Bullet variant on the *intro* highlight is unusual — but the
        // pitch is "Huawei Cloud MaaS first, everything else also works".
        // Bullet 1 leads with HWC MaaS as the recommended path; bullets
        // 2–3 establish the cloud breadth and local fallback so we don't
        // over-promise lock-in; bullets 4–6 cover the chat ergonomics.
        icon: <Bot className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Huawei Cloud MaaS — open-source by default',
        tint: 'accent',
        bullets: [
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: 'Huawei Cloud MaaS — recommended',
            sub: 'GLM-4.5 · GLM-5.1 · DeepSeek-V3 · Qwen2.5 · Llama 3.x',
          },
          {
            icon: <Cloud className="h-4 w-4" />,
            label: 'Other OpenAI-compatible clouds',
            sub: 'OpenAI · Azure · OpenRouter · Groq · Together',
          },
          {
            icon: <Cpu className="h-4 w-4" />,
            label: 'Local servers (privacy fallback)',
            sub: 'Ollama · LM Studio · vLLM · llama.cpp',
          },
          {
            icon: <Brain className="h-4 w-4" />,
            label: 'Per-turn model switch',
            sub: 'Cheap GLM for chit-chat, R1 / DeepSeek for refactors',
          },
          {
            icon: <Lock className="h-4 w-4" />,
            label: 'Your endpoint, your rules',
            sub: 'No RunHQ proxy, direct app → MaaS / cloud / local',
          },
          {
            icon: <Languages className="h-4 w-4" />,
            label: 'Reply in your language',
            sub: '40+ locales with flags & search',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open AI Settings', actionId: 'open-ai-settings' },
    },
    {
      id: 'ai-on-every-surface',
      title: 'AI on every surface — pick a model from the trigger itself',
      badge: 'new',
      blurb:
        'Every existing AI affordance now routes into the same chat hub ' +
        'with full history: Project · Why? · Log right-click triage · Diff ' +
        'Explain · Commit message generation · Standup polish, plus a new ' +
        'Dashboard "Analyze workspace" button that builds a global report ' +
        'across every project. New in 0.7.0: when you have multiple ' +
        'providers configured, clicking any AI button pops a small ' +
        'model-chooser popover *directly under the trigger* — pick once, ' +
        'panel opens and streams in one motion. Single-provider setups ' +
        'skip the popover entirely and dispatch immediately, so casual ' +
        'use never asks twice. Per-turn action hooks like "Use as commit ' +
        'message" or "Insert into standup" let the model write *into* ' +
        'your flow, not just at it.',
      media: {
        src: '/whatsnew/0.7.0/ai-surfaces',
        themeAware: true,
        alt: 'Why? button on a project card with the model-chooser popover open under it, listing two providers; the chat panel is visible on the right rail showing the auto-sent answer streaming in',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Sparkles className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Seven surfaces, one history',
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
          {
            icon: <ShieldAlert className="h-4 w-4" />,
            label: 'Per-CVE deep dive',
            sub: 'Sparkles on every advisory',
          },
          {
            icon: <MousePointerClick className="h-4 w-4" />,
            label: 'Model picker, in place',
            sub: 'Popover under each AI button',
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
        'Fixed the entire class of bugs where reasoning-heavy models ' +
        '(GLM-5.1, DeepSeek-R1, Qwen-QwQ on Huawei Cloud MaaS, plus their ' +
        'local equivalents) cut out mid-sentence, hid the answer inside ' +
        '<thinking> blocks, or silently killed the worker on a non-ASCII ' +
        'character. Reasoning is now collapsed into a calm Cursor-style ' +
        'pill, content-progress drives the idle timeout (instead of a ' +
        'flat 60s — models that pause to think for 90s no longer get hung ' +
        'up on), stalled streams auto-continue, an "answer hidden in ' +
        'reasoning" heuristic nudges the model to actually print, partial ' +
        'turns surface a Continue banner — and the UTF-8 panic that ' +
        'killed the worker on em-dashes is gone with regression tests. ' +
        'Net effect: GLM, DeepSeek and Qwen reasoning variants went from ' +
        '"flaky beta" to "you can leave it running on the long workspace ' +
        'report and come back to a finished answer".',
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
    {
      id: 'dependency-hygiene',
      title: 'Dependency hygiene — persisted, dated, diff-aware',
      badge: 'new',
      blurb:
        'Every npm outdated / cargo audit / pip audit run is now stored ' +
        'in a local SQLite cache (`dependency_scans.db`) so the dashboard ' +
        'paints audit/outdated chips instantly on cold start instead of ' +
        'flashing empty for 30 seconds while the workspace re-scans. Each ' +
        'card surfaces a "Last scanned 3h ago" chip — click it to rescan ' +
        'just that project (no more re-running 30 scans to verify one ' +
        'lodash advisory), color-coded amber after 24 hours and red after ' +
        '7 days. After a rescan, audit/outdated chips show a delta badge ' +
        '("+3 since last scan") so you immediately see what changed since ' +
        'last time. A small amber "N stale" pill sits next to the ' +
        'Rescan deps button to flag projects past the 7-day window — ' +
        'click it to sequentially rescan only those (skipping cache ' +
        'lookups for the fresh ones). Settings → Keyboard Shortcuts ' +
        'grows a "Reset scan cache" section with a typed-confirmation ' +
        'gate for the rare nuclear option. Removed services drop their ' +
        'cached scan row automatically — no orphans, no ghost chips.',
      media: {
        src: '/whatsnew/0.7.0/dependency-hygiene',
        themeAware: true,
        alt: 'Service cards showing freshness chips ("3h ago"), audit chip with "+2" delta badge, and the dashboard header with a "Rescan deps" button followed by an amber "4 stale" pill',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Package className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Scans that survive restarts',
        tint: 'emerald',
        bullets: [
          {
            icon: <Database className="h-4 w-4" />,
            label: 'Persistent scan cache',
            sub: 'SQLite — survives restarts',
          },
          {
            icon: <History className="h-4 w-4" />,
            label: 'Per-card freshness',
            sub: '"Scanned 3h ago" + age tone',
          },
          {
            icon: <RefreshCw className="h-4 w-4" />,
            label: 'Per-project rescan',
            sub: 'One service, no batch sweep',
          },
          {
            icon: <TrendingUp className="h-4 w-4" />,
            label: 'Delta badges',
            sub: '"+3 since last scan"',
          },
          {
            icon: <Zap className="h-4 w-4" />,
            label: '"N stale" pill',
            sub: 'Click to sweep just the >7-day ones',
          },
          {
            icon: <Trash2 className="h-4 w-4" />,
            label: 'Reset cache, with brakes',
            sub: 'Type "reset" to confirm',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
  ],
};
