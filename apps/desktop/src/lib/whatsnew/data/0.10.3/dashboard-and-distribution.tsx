import { Callout } from '@/components/whatsnew/inline';
import type { ReleaseSection } from '../../types';

export const dashboardAndDistributionSections: ReleaseSection[] = [
  {
    id: 'dashboard-organisation',
    title: 'Dashboard organisation',
    subsections: [
      {
        id: 'hide-from-dashboard',
        title: 'Hide-from-dashboard',
        badge: 'new',
        body: (
          <>
            <p>
              Some services live in the workspace only because you want their git / docs / notes
              trail handy — you don&apos;t need them cluttering the dashboard between the things you
              actually run. Toggle the new <strong>Hide from dashboard</strong> flag (eye-off icon
              in the service header, or the inline switch in the Advanced editor) and the card
              disappears from the dashboard grid while staying fully reachable from the sidebar,
              search, and quick actions.
            </p>

            <ul className="text-fg-muted my-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                A <strong>persistent hidden-services toggle chip</strong> sits next to the search
                bar so you can re-reveal them in one click when you need to. The chip&apos;s
                open/closed state is remembered per workspace.
              </li>
              <li>
                Hidden cards render with a subtle <strong>EyeOff badge</strong> when revealed, so
                you can tell them apart from the always-visible ones without re-opening the service.
              </li>
              <li>
                The card overflow menu and the service header both expose a quick{' '}
                <strong>Show / Hide on dashboard</strong> action — no more burying the toggle inside
                the Advanced editor tab.
              </li>
            </ul>
          </>
        ),
      },

      {
        id: 'dashboard-polish',
        title: 'Filter bar + card overflow menu polish',
        badge: 'improved',
        body: (
          <>
            <p>
              The dashboard&apos;s filter strip used to be a stack of chip groups that grew another
              row every time we added an axis. It now lives on a <strong>single top row</strong>:
              search input on the left, then <strong>Attention</strong> and <strong>Git</strong>{' '}
              dropdowns (each with a prefixed uppercase label so the axis is unambiguous), then the
              Hidden toggle, Group, and Sort controls — one continuous bar instead of a chip wall.
            </p>

            <Callout tone="success" title="Filtering no longer freezes the UI">
              Switching between filter options used to lock the dashboard for ~150–300 ms while
              React mounted / unmounted card trees. The grid now mounts every eligible card once and
              toggles visibility via CSS (<code>display: none</code>), with{' '}
              <code>useTransition</code> driving the filter state update. Switching between
              &quot;All&quot; and any other filter is instant.
            </Callout>

            <p>
              The card overflow menu (⋯ on each card) now renders through a{' '}
              <strong>
                portal to <code>document.body</code>
              </strong>{' '}
              with viewport-relative positioning, so it can no longer be clipped by the card&apos;s
              own <code>overflow: hidden</code>. A module-level pubsub registry enforces{' '}
              <strong>only-one-open-at-a-time</strong> across the dashboard — opening a new menu
              automatically closes the previous one. Item styling now matches{' '}
              <code>EditorDropdown</code> for visual consistency.
            </p>
          </>
        ),
      },
    ],
  },

  {
    id: 'install-and-distribution',
    title: 'Install & distribution',
    subsections: [
      {
        id: 'install-distribution',
        title: 'macOS notarization, ARM64 builds, smarter landing page',
        badge: 'improved',
        body: (
          <>
            <p>The install pipeline picked up several upgrades across 0.10.1 / 0.10.2 / 0.10.3:</p>

            <ul className="text-fg-muted my-2 flex flex-col gap-2 text-[13.5px] leading-relaxed">
              <li>
                <strong>macOS Developer ID notarization</strong> wired into the release CI, gated on
                signing secrets so forks without certificates still build. First-launch Gatekeeper
                prompt is gone for users on Apple-built binaries.
              </li>
              <li>
                <strong>ARM64 builds</strong> are first-class on every supported OS, and the landing
                page <strong>auto-detects OS + arch</strong> so the download CTA points at the right
                binary instead of forcing the visitor to read filename suffixes.
              </li>
              <li>
                <strong>Version-less Linux asset aliases</strong> let scripted installs and package
                recipes pin to <code>runhq-linux-x86_64.AppImage</code> /{' '}
                <code>runhq-linux-aarch64.deb</code> instead of chasing the latest version number
                across release tags.
              </li>
              <li>
                <strong>Linux + manual installs</strong> hand off cleanly to the GitHub Releases
                page (winget references removed, install instructions updated to reflect what
                actually ships).
              </li>
              <li>
                <strong>Content-Security-Policy</strong> on the docs site now permits the GitHub API
                request used by the &quot;latest release&quot; widget, so the landing page stops
                404&apos;ing the version pill on first paint.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
];
