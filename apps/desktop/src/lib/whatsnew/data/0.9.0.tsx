/**
 * 0.9.0 release highlights — the "make the cockpit feel like an IDE"
 * chapter.
 *
 * Scope decision: 6 highlights. Two flagship pieces frame the
 * release — the tabbed main view (slide 1) and the in-place AI
 * commit generator (slide 2) — with four supporting upgrades that
 * round out the IDE-parity story: a per-provider commit-language
 * override (slide 3), fullscreen terminal (slide 4), keyboard-first
 * dashboard search (slide 5), and a Sidebar drag-to-reorder gesture
 * with edge-aware drop indicators (slide 6).
 *
 * Why these six:
 *
 *   • Power users who keep five projects open at once — the tabbed
 *     shell finally lets log filters, terminal sessions, scroll
 *     positions, and split-pane heights survive a tab switch
 *     instead of being torn down on every navigation. Pinning + drag
 *     reorder fold in the Chrome / VSCode mental model — slide 1.
 *
 *   • Project maintainers who write commit messages all day — the
 *     AI generator drops out of the chat hub for this surface only,
 *     so a "Sparkles" click fills the textarea directly instead of
 *     bouncing through the right-rail panel. Reasoning models
 *     (DeepSeek-R1, GLM-4.x, Qwen-QwQ, OpenAI o-series) used to
 *     dump pages of "1. Analyze the request… 2. Determine the
 *     prefix…" monologue into the textarea; the new <commit>…
 *     </commit> sentinel-tag prompt contract neutralises that
 *     entire failure mode — slide 2.
 *
 *   • Multilingual teams whose chat language differs from their
 *     commit-history convention — Settings → AI grew a per-provider
 *     "Commit message language" override so chat in Türkçe / 日本語
 *     / Español can coexist with English commits (or any other
 *     split) without one setting hijacking the other — slide 3.
 *
 *   • Users running a long-tail terminal session that needs the
 *     full panel — the LogPanel toolbar grew a Maximize / Restore
 *     toggle that collapses the log list and splitter so the
 *     terminal fills the entire content area; Esc restores —
 *     slide 4.
 *
 *   • Workspace operators with 20-200 services who can't visually
 *     scan to the right one — the dashboard grew a `/` keyboard
 *     shortcut that focuses a free-text search box ranking matches
 *     across name / tag / port / command / cwd, with visibility-
 *     based filtering that keeps cards mounted to preserve sub-
 *     frame typing latency — slide 5.
 *
 *   • Sidebar power users who'd been asking for "drag this row two
 *     slots up" since 0.4 — every section now has edge-aware drop
 *     targets (top half / bottom half) with an inline insertion
 *     line and a per-bucket persistent order, so manual ordering
 *     finally beats alphabetical for new and existing services
 *     alike — slide 6.
 *
 * Asset slugs map 1:1 to `apps/desktop/public/whatsnew/0.9.0/<slug>-{light,dark}.webp`.
 * Files that don't exist yet fall back to the in-component gradient,
 * so this content can ship before screenshots are produced.
 */
import {
  ArrowLeftRight,
  ArrowUpDown,
  Bot,
  Brain,
  GitCommit,
  GripVertical,
  Keyboard,
  Languages,
  LayoutGrid,
  Layers,
  ListFilter,
  Maximize2,
  MousePointerClick,
  Pin,
  PinOff,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Tag,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import type { WhatsNewRelease } from '../types';

export const release_0_9_0: WhatsNewRelease = {
  version: '0.9.0',
  releasedAt: '2026-04-29',
  headline: 'Tabs, pins, and a commit generator that finally ships clean.',
  changelogUrl: 'https://github.com/erdembas/runhq/blob/main/CHANGELOG.md#090',
  highlights: [
    {
      id: 'tabbed-main-view',
      title: 'Tabbed main view — every project, kept warm',
      badge: 'new',
      blurb:
        'Replaces the mutually-exclusive Dashboard / LogPanel / ' +
        'StackDetail switcher with a Cursor-style tab strip pinned ' +
        'above the main content area. Every open service / stack ' +
        'lives in its own tab; the dashboard sits at the leftmost ' +
        'slot as a permanent home tab that can never be closed. ' +
        'Crucially, all tabs stay mounted via `display: none` while ' +
        'inactive — terminal sessions, log filters, split-pane ' +
        'heights, scroll positions, and AI conversation drafts ' +
        'survive every tab switch. Pinning, drag-to-reorder, ' +
        'middle-click close, and a VSCode-parity right-click menu ' +
        '(Pin / Unpin · Move Left / Right · Close · Close Others · ' +
        'Close to the Right · Close to the Left · Close All) round ' +
        "out the IDE feel. Bulk-close gestures never touch what you've " +
        'pinned, and pinned tabs persist across reloads so reopening ' +
        'a previously pinned service from the sidebar snaps it back ' +
        'into the pinned zone automatically.',
      media: {
        src: '/whatsnew/0.9.0/tabbed-main-view',
        // 0.9.0 motion clips ship dark-only by convention — see
        // public/whatsnew/0.9.0/README.md. The looping clip reads as an
        // embedded screen recording (border + rounded chrome around it),
        // so the dark→light edge against a light-mode modal frame plays
        // as media-vs-page rather than mismatched UI. Halves the bundle
        // and the capture work; static highlights in this same release
        // (e.g. commit-language) stay theme-aware where the value of
        // the screenshot *is* the chrome contrast.
        themeAware: false,
        alt: 'Main tab strip in motion: a service tab is pinned via right-click and snaps to the left, then a second tab is dragged from the right edge into the middle of the strip; the active tab streams logs while an inactive tab silently keeps its terminal session alive in the background',
        aspectRatio: '16/9',
        kind: 'video',
      },
      fallback: {
        icon: <Layers className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'IDE-parity tab shell',
        tint: 'accent',
        bullets: [
          {
            icon: <LayoutGrid className="h-4 w-4" />,
            label: 'State-preserving switches',
            sub: 'Terminal, scroll, splits all kept alive',
          },
          {
            icon: <Pin className="h-4 w-4" />,
            label: 'Chrome-parity pinning',
            sub: 'Pinned tabs survive Close All',
          },
          {
            icon: <ArrowLeftRight className="h-4 w-4" />,
            label: 'Drag-to-reorder',
            sub: 'dnd-kit, axis-locked, zone-aware',
          },
          {
            icon: <PinOff className="h-4 w-4" />,
            label: 'VSCode-style context menu',
            sub: 'Pin · Move · Close-Others / Right / Left / All',
          },
          {
            icon: <X className="h-4 w-4" />,
            label: 'Middle-click closes',
            sub: 'Hover X · ⌘W on the active tab',
          },
          {
            icon: <Save className="h-4 w-4" />,
            label: 'Pin set persists',
            sub: 'Re-opens snap back into the pinned zone',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
    {
      id: 'ai-commit-generator',
      title: 'AI commit messages — straight into the textarea',
      badge: 'new',
      blurb:
        'The Commit panel now generates messages directly into the ' +
        'textarea instead of routing through the chat hub. One ' +
        'click on the Sparkles button: zero providers configured ' +
        '→ inline error pointing to AI Settings · one provider ' +
        '→ instant generation, no extra clicks · two-or-more ' +
        '→ a small ModelChooserPopover anchored under the button ' +
        'so you pick the right model in place. Whatever you typed ' +
        'so far is forwarded as a hint, so "scope: api" or "make it ' +
        'imperative" steers the regenerate without losing your ' +
        'starting point. Most importantly: the prompt now uses an ' +
        'explicit `<commit>…</commit>` sentinel-tag contract so ' +
        'reasoning-heavy models (DeepSeek-R1, GLM-4.x / 5.x, Qwen-' +
        'QwQ, OpenAI o-series) stop dumping their "1. Analyze the ' +
        'request… 2. Determine the prefix…" monologue into your ' +
        "textarea — we extract only what's between the tags, with " +
        'a `<think>…</think>`-stripping fallback for models that ' +
        'forget the contract entirely. Regression tests cover both ' +
        'paths plus the multi-draft case where models retry inside ' +
        'placeholder tags before settling.',
      media: {
        src: '/whatsnew/0.9.0/ai-commit-generator',
        themeAware: false,
        alt: 'Commit panel with a staged diff in the file list: the ModelChooserPopover opens under the Sparkles button, a provider is selected, and a Conventional Commits message types itself into the textarea word-by-word as the model streams the response',
        aspectRatio: '16/9',
        kind: 'video',
      },
      fallback: {
        icon: <Wand2 className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'In-place, sentinel-tagged',
        tint: 'violet',
        bullets: [
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: 'One-click generate',
            sub: 'Single provider → fires immediately',
          },
          {
            icon: <MousePointerClick className="h-4 w-4" />,
            label: 'Multi-provider picker',
            sub: 'Anchored popover, no panel detour',
          },
          {
            icon: <GitCommit className="h-4 w-4" />,
            label: 'Hint-aware',
            sub: 'Your draft text steers the regenerate',
          },
          {
            icon: <ShieldCheck className="h-4 w-4" />,
            label: '<commit> sentinel tags',
            sub: 'Reasoning models can\u2019t leak monologue',
          },
          {
            icon: <Brain className="h-4 w-4" />,
            label: '<think> stripping fallback',
            sub: 'Defensive cleanup for older models',
          },
          {
            icon: <Bot className="h-4 w-4" />,
            label: 'Direct-fill, no chat hop',
            sub: 'Textarea + cursor placed at end',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Diff Viewer', actionId: 'open-cross-project-diff' },
    },
    {
      id: 'commit-language-override',
      title: 'Per-provider commit message language',
      badge: 'new',
      blurb:
        'Settings → AI grew a Commit message language picker that ' +
        'lives independently from the existing Response language ' +
        'setting. Three modes: **Inherit** (use whatever Response ' +
        'language is set to — the default, so existing providers ' +
        'don\u2019t silently change behaviour), **Auto** (no ' +
        'directive — the model decides, typically matching the ' +
        'diff\u2019s comment language), or any specific BCP-47 ' +
        'code. The split solves a real workflow we kept hearing ' +
        'about: "I want to chat in Türkçe but my open-source ' +
        'project commits English". Or vice versa — chat in English ' +
        'while writing commits in Japanese. The provider row in ' +
        'AI Settings now shows a small "✎" chip next to the ' +
        'response-language flag whenever the commit override is ' +
        'something other than Inherit, so what\u2019s configured is ' +
        'visible at a glance without opening the form.',
      media: {
        src: '/whatsnew/0.9.0/commit-language',
        themeAware: true,
        alt: 'AI Settings provider form with the Commit message language picker open, showing Inherit (resolved as Türkçe) at the top, Auto, then a flag-augmented BCP-47 list with English highlighted',
        aspectRatio: '16/9',
      },
      fallback: {
        icon: <Languages className="h-10 w-10" strokeWidth={1.6} />,
        caption: 'Chat in TR, commit in EN',
        tint: 'sky',
      },
      cta: { kind: 'store-action', label: 'Open AI Settings', actionId: 'open-ai-settings' },
    },
    {
      id: 'fullscreen-terminal',
      title: 'Fullscreen terminal',
      badge: 'new',
      blurb:
        'Long-running migration? Live `tail -f` on the production ' +
        'log? The LogPanel toolbar now has an Expand button next to ' +
        'the Terminal toggle that collapses the log list and the ' +
        'horizontal splitter so the embedded PTY fills the entire ' +
        'content area. The toggle is per-tab (each open service ' +
        'remembers its own preference), Esc restores the split ' +
        'view at any time, and closing the terminal panel itself ' +
        'silently drops the maximize state so re-opening lands in ' +
        'the familiar split layout instead of dumping you into a ' +
        'stale fullscreen.',
      media: {
        src: '/whatsnew/0.9.0/fullscreen-terminal',
        themeAware: false,
        alt: 'Service tab where the embedded terminal expands to fill the entire content area when Expand is clicked, the toolbar swaps Expand for Restore, and a quick Esc keypress collapses it back into the familiar split layout',
        aspectRatio: '16/9',
        kind: 'video',
      },
      fallback: {
        icon: <SquareTerminal className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Expand · Esc restores',
        tint: 'emerald',
        bullets: [
          {
            icon: <Maximize2 className="h-4 w-4" />,
            label: 'Toolbar Expand toggle',
            sub: 'Next to the Terminal button',
          },
          {
            icon: <Terminal className="h-4 w-4" />,
            label: 'Per-tab preference',
            sub: 'Each service remembers its own',
          },
          {
            icon: <Keyboard className="h-4 w-4" />,
            label: 'Esc to restore',
            sub: 'Split view back, scoped listener',
          },
          {
            icon: <X className="h-4 w-4" />,
            label: 'Auto-resets on close',
            sub: 'Re-open lands in split layout',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
    {
      id: 'dashboard-search',
      title: 'Dashboard search — `/` to find anything',
      badge: 'new',
      blurb:
        'A keyboard-first free-text search box now lives at the top ' +
        'of the dashboard. Press `/` from anywhere (when not already ' +
        'typing into another input) to focus, type to filter, Esc to ' +
        'clear and blur — same contract as GitHub / Linear. Matching ' +
        'is score-weighted across the fields you actually remember: ' +
        'name (10) · tags (5) · port (4) · command (3) · cwd path ' +
        '(2). Multi-field hits compound, so a project named ' +
        '"frontend-v2" tagged "frontend" beats one merely tagged ' +
        '"frontend" when you type the word. Implementation note ' +
        'worth surfacing: search is applied as a *visibility* ' +
        'filter, not a mount filter — every card stays mounted and ' +
        'non-matches collapse via `display: none`. That\u2019s what ' +
        'keeps typing latency sub-frame on a fully-populated ' +
        'workspace; flipping cards in/out of the React tree on every ' +
        'keystroke would otherwise re-run ~10 Zustand subscriptions, ' +
        'an AI hook, and SVG sparkline setup per card per character.',
      media: {
        src: '/whatsnew/0.9.0/dashboard-search',
        themeAware: false,
        alt: 'Dashboard hero where pressing "/" focuses the search input and a query is typed character by character, instantly narrowing the project grid down to three matching cards while the rest hide via display:none — sparklines and ports stay live on the surviving cards',
        aspectRatio: '16/9',
        kind: 'video',
      },
      fallback: {
        icon: <Search className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Slash-to-focus, score-ranked',
        tint: 'amber',
        bullets: [
          {
            icon: <Keyboard className="h-4 w-4" />,
            label: '/ to focus, Esc to clear',
            sub: 'Skipped while typing elsewhere',
          },
          {
            icon: <Tag className="h-4 w-4" />,
            label: 'Name · tag · port · cmd · cwd',
            sub: 'Weighted score, tie-breaks by name',
          },
          {
            icon: <ListFilter className="h-4 w-4" />,
            label: 'Visibility-only filter',
            sub: 'Cards stay mounted, no flicker',
          },
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: 'Sub-frame latency',
            sub: 'Even on 200-service rosters',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
    {
      id: 'sidebar-drag-reorder',
      title: 'Sidebar drag-to-reorder, with edge-aware drops',
      badge: 'improved',
      blurb:
        'Sections in the sidebar grew real per-row drag-to-reorder ' +
        'instead of "drop anywhere in the bucket → append at the ' +
        'end". Each row now owns the drop logic itself — hovering ' +
        'the **top half** previews "insert before this row", ' +
        'hovering the **bottom half** previews "insert after". A ' +
        '2 px insertion line glides between row boundaries via CSS ' +
        'opacity instead of injecting separate drop strips, so the ' +
        'highlight no longer pops in/out as you cross zone ' +
        'boundaries (the "feels like a forced drag" bug). Services ' +
        'and stacks interleave inside one ordered list per section ' +
        '— no more mandatory "stacks first, then services" — and ' +
        'a per-bucket order map persists in localStorage alongside ' +
        'the section snapshot. Items that haven\u2019t been moved ' +
        'yet fall through to alphabetical, so freshly-added services ' +
        'never disappear off the bottom of a bucket.',
      media: {
        src: '/whatsnew/0.9.0/sidebar-reorder',
        themeAware: false,
        alt: 'Sidebar drag-to-reorder in motion: a service row is picked up, lifts slightly, and is moved past two siblings while a thin accent insertion line tracks the destination — top-half hover lands above, bottom-half hover lands below — and snaps into place when released',
        aspectRatio: '16/9',
        kind: 'video',
      },
      fallback: {
        icon: <GripVertical className="h-7 w-7" strokeWidth={1.6} />,
        caption: 'Top-half · bottom-half drops',
        tint: 'violet',
        bullets: [
          {
            icon: <ArrowUpDown className="h-4 w-4" />,
            label: 'Edge-aware insertion line',
            sub: 'No layout-shift jitter',
          },
          {
            icon: <Layers className="h-4 w-4" />,
            label: 'Stacks + services interleave',
            sub: 'One ordered list per section',
          },
          {
            icon: <Save className="h-4 w-4" />,
            label: 'Persisted per-bucket order',
            sub: 'Survives reload + section moves',
          },
          {
            icon: <ListFilter className="h-4 w-4" />,
            label: 'Alphabetical fallback',
            sub: 'New services never vanish',
          },
        ],
      },
      cta: { kind: 'store-action', label: 'Open Dashboard', actionId: 'open-overview' },
    },
  ],
};
