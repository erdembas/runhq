import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { useSyncedTheme } from '@/lib/theme';
import { Zap, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { Kbd } from '@/components/ui/Kbd';

/**
 * In-app replacement for a macOS-style "still running in the menu bar" toast.
 *
 * Renders inside a small (360×104) transparent, always-on-top, borderless
 * Tauri window — see `lib.rs::setup` for the window definition. Lives in the
 * top-right corner of the primary monitor so it reads as a system alert
 * without triggering `UserNotifications` (and without a permission prompt).
 *
 * Lifecycle:
 *   1. Rust emits `runhq://tray-hint-show` right before `window.show()` on
 *      the hint window — that's our cue to kick off the enter animation.
 *   2. After `AUTO_DISMISS_MS` (or an explicit click / ×), we play the exit
 *      animation then call `window.hide()` (not `close()` — we reuse the
 *      same window for subsequent shows without paying webview startup
 *      again). The window is pre-warmed at app launch.
 */

const AUTO_DISMISS_MS = 5_500;
const EXIT_ANIMATION_MS = 260;

type Phase = 'enter' | 'visible' | 'exit';

/**
 * Light/dark palettes for the hint banner. The dark palette mirrors the
 * `.glass` surfaces used across the main app; the light palette leans on
 * ember accent borders + near-white glass so the brand still reads even
 * when the OS is in light mode.
 *
 * Kept as JS objects (rather than CSS variables) because this webview
 * boots before the app CSS is fully ready and we want zero-flicker
 * theming.
 */
const PALETTES = {
  dark: {
    surface: 'linear-gradient(180deg, rgba(23, 17, 13, 0.92) 0%, rgba(17, 12, 9, 0.92) 100%)',
    border: '1px solid rgba(251, 146, 60, 0.28)',
    shadow:
      '0 12px 32px -8px rgba(0, 0, 0, 0.55), 0 2px 6px -2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    title: 'rgb(253, 240, 222)',
    body: 'rgb(180, 170, 158)',
    boltBg: 'linear-gradient(180deg, #FB923C 0%, #FDBA74 100%)',
    boltShadow: '0 4px 10px -2px rgba(251, 146, 60, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
    boltFill: '#1a120c',
    closeIdleBg: 'transparent',
    closeIdleColor: 'rgb(140, 132, 122)',
    closeHoverBg: 'rgba(255, 255, 255, 0.06)',
    closeHoverColor: 'rgb(220, 214, 206)',
  },
  light: {
    surface:
      'linear-gradient(180deg, rgba(255, 253, 250, 0.95) 0%, rgba(250, 245, 239, 0.95) 100%)',
    border: '1px solid rgba(251, 146, 60, 0.38)',
    shadow:
      '0 12px 32px -8px rgba(120, 72, 30, 0.22), 0 2px 6px -2px rgba(120, 72, 30, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
    title: 'rgb(31, 20, 12)',
    body: 'rgb(96, 84, 70)',
    boltBg: 'linear-gradient(180deg, #FB923C 0%, #F97316 100%)',
    boltShadow: '0 4px 10px -2px rgba(234, 88, 12, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
    boltFill: '#FFF7ED',
    closeIdleBg: 'transparent',
    closeIdleColor: 'rgb(140, 128, 114)',
    closeHoverBg: 'rgba(23, 17, 13, 0.06)',
    closeHoverColor: 'rgb(50, 38, 26)',
  },
} as const;

function readIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}

export function TrayHintBanner() {
  i18n.useLocale();
  // Primary theme sync path: Tauri event bus. The `storage` listener
  // below stays as a belt-and-suspenders fallback for the rare case
  // where the event bus isn't ready yet (cold webview boot).
  useSyncedTheme();

  const [phase, setPhase] = useState<Phase>('enter');
  // Track the `dark` class on <html>. The inline boot script in
  // `tray-hint.html` seeds this from localStorage + prefers-color-scheme
  // before React hydrates, and the MutationObserver keeps us in sync if
  // the user toggles theme from the main window mid-session.
  const [isDark, setIsDark] = useState<boolean>(readIsDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });

    // Main window writes `rhq-theme` to localStorage when the user toggles
    // theme. Same origin → the `storage` event fires here, even though we
    // live in a separate webview. We mirror the class on <html> so our
    // observer above (and any Tailwind class using `.dark`) picks it up.
    const onStorage = (e: globalThis.StorageEvent) => {
      if (e.key !== 'rhq-theme') return;
      const next =
        e.newValue === 'dark' ||
        (!e.newValue && window.matchMedia('(prefers-color-scheme: dark)').matches);
      el.classList.toggle('dark', next);
    };
    window.addEventListener('storage', onStorage);

    return () => {
      obs.disconnect();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const palette = isDark ? PALETTES.dark : PALETTES.light;
  // Platform detection matches the rest of the app — we favour `navigator
  // .platform` over `userAgentData.platform` so tests and older WebKit
  // builds behave the same.
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    let dismissTimer: number | undefined;
    let exitTimer: number | undefined;
    let enterTimer: number | undefined;

    const beginExit = () => {
      setPhase('exit');
      exitTimer = window.setTimeout(() => {
        void getCurrentWindow().hide();
      }, EXIT_ANIMATION_MS);
    };

    const arm = () => {
      // Reset any pending timers from a previous show — the window is
      // pre-warmed and reused, so a second close-to-tray shouldn't inherit
      // the previous run's dismissal schedule.
      if (dismissTimer) window.clearTimeout(dismissTimer);
      if (exitTimer) window.clearTimeout(exitTimer);
      if (enterTimer) window.clearTimeout(enterTimer);

      // The enter frame needs to land AFTER the component mounts with
      // `enter` → we give one RAF so the transform/opacity transitions
      // actually animate instead of snapping.
      setPhase('enter');
      enterTimer = window.setTimeout(() => setPhase('visible'), 16);
      dismissTimer = window.setTimeout(beginExit, AUTO_DISMISS_MS);
    };

    // Arm once on initial mount (the window is visible right now — that's
    // how we got here).
    arm();

    // And re-arm on every subsequent show so the hint feels fresh.
    let unlisten: (() => void) | undefined;
    void listen('runhq://tray-hint-show', () => arm()).then((u) => {
      unlisten = u;
    });

    return () => {
      if (dismissTimer) window.clearTimeout(dismissTimer);
      if (exitTimer) window.clearTimeout(exitTimer);
      if (enterTimer) window.clearTimeout(enterTimer);
      unlisten?.();
    };
  }, []);

  const dismiss = () => {
    setPhase('exit');
    window.setTimeout(() => {
      void getCurrentWindow().hide();
    }, EXIT_ANIMATION_MS);
  };

  // Style literals (rather than Tailwind classes) keep the banner rendering
  // identical whether the app's CSS reset has loaded yet or not — the hint
  // window boots fast and we don't want a flash of unstyled content.
  const offscreenTransform = 'translate3d(24px, -8px, 0)';
  const onscreenTransform = 'translate3d(0, 0, 0)';

  return (
    <div
      style={{
        height: '100%',
        padding: '12px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        onClick={dismiss}
        style={{
          width: '100%',
          maxWidth: 336,
          padding: '14px 14px 14px 16px',
          borderRadius: 14,
          cursor: 'pointer',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          // Ember-tinted glass. Matches the accent gradient used on the
          // primary CTA so the banner reads as a RunHQ surface, not a
          // system toast pretending to be one.
          background: palette.surface,
          border: palette.border,
          boxShadow: palette.shadow,
          backdropFilter: 'blur(16px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
          color: palette.title,
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
          opacity: phase === 'visible' ? 1 : 0,
          transform: phase === 'visible' ? onscreenTransform : offscreenTransform,
          transition:
            'opacity 240ms cubic-bezier(0.2, 0, 0.2, 1), transform 240ms cubic-bezier(0.2, 0, 0.2, 1)',
          willChange: 'opacity, transform',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 32,
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 9,
            background: palette.boltBg,
            boxShadow: palette.boltShadow,
            color: palette.boltFill,
          }}
        >
          <Zap style={{ width: 16, height: 16 }} strokeWidth={2.4} fill={palette.boltFill} />
        </span>

        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: palette.title,
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
            }}
          >
            {i18n.t('RunHQ is still running')}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: palette.body,
              lineHeight: 1.4,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{i18n.t('Press')}</span>
            <Kbd className="text-[10px]">{mod}</Kbd>
            <Kbd className="text-[10px]">⇧</Kbd>
            <Kbd className="text-[10px]">K</Kbd>
            <span>{i18n.t('to bring it back.')}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          aria-label={i18n.t('Dismiss')}
          style={{
            flex: '0 0 auto',
            width: 20,
            height: 20,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            background: palette.closeIdleBg,
            color: palette.closeIdleColor,
            border: 'none',
            cursor: 'pointer',
            transition: 'background 120ms, color 120ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = palette.closeHoverBg;
            e.currentTarget.style.color = palette.closeHoverColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = palette.closeIdleBg;
            e.currentTarget.style.color = palette.closeIdleColor;
          }}
        >
          <X style={{ width: 12, height: 12 }} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
