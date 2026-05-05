import { DesktopDashboard, type DesktopDashboardSection as Section } from '@runhq/cockpit-ui';
import {
  DASH_BRANCH_BY_SERVICE,
  DASH_LAST_SCAN_BY_SERVICE,
  DASH_LOG_PREVIEW,
  DASH_RUNTIME_BY_SERVICE,
  DASH_SAMPLES,
  DASH_SECTION_BY_SERVICE,
  DASH_SECTIONS,
  DASH_SERVICES,
  DASH_STATUSES,
} from '@/lib/fixtures/dashboard';
import { getReleaseInfo } from '@/lib/release';

/**
 * Full-fidelity dashboard mock that lives directly under the hero.
 * Renders the actual cockpit-ui composite with the dashboard fixtures
 * so visitors see the real product the moment the page paints — no
 * "marketing screenshot" abstraction layer in between.
 *
 * The composite is `'use client'` (it owns selected-service state for
 * the sidebar + tab bar). This wrapper stays a Server Component so
 * the section header and chrome ship zero JS.
 */
export async function DesktopDashboardSection() {
  const release = await getReleaseInfo();

  const sections: Section[] = DASH_SECTIONS.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    serviceIds: DASH_SERVICES.filter((svc) => DASH_SECTION_BY_SERVICE[svc.id] === s.id).map(
      (svc) => svc.id,
    ),
  }));

  return (
    <section id="dashboard" className="relative isolate" aria-labelledby="dashboard-eyebrow">
      <div
        aria-hidden
        className="from-accent/8 absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] via-transparent to-transparent"
      />
      <div className="mx-auto max-w-[1440px] px-4 pt-4 pb-16 sm:px-6 lg:pt-8 lg:pb-24 xl:px-10">
        <div className="mb-6 flex flex-col gap-2">
          <span
            id="dashboard-eyebrow"
            className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase"
          >
            The full cockpit
          </span>
          <h2 className="text-fg max-w-2xl text-[28px] leading-[1.1] font-semibold tracking-tight sm:text-[34px]">
            One window. Every project. Every running command.
          </h2>
          <p className="text-fg-muted max-w-2xl text-[14.5px] leading-relaxed">
            What you&rsquo;re looking at below is the actual React surface RunHQ ships — sidebar,
            tab strip, dashboard body and status bar pulled straight from the desktop package and
            re-rendered here with a fixture workspace.
          </p>
        </div>

        <DesktopDashboard
          services={DASH_SERVICES}
          sections={sections}
          statuses={DASH_STATUSES}
          samples={DASH_SAMPLES}
          runtimes={DASH_RUNTIME_BY_SERVICE}
          branches={DASH_BRANCH_BY_SERVICE}
          lastScans={DASH_LAST_SCAN_BY_SERVICE}
          logTails={DASH_LOG_PREVIEW}
          attentionCount={1}
          version={release.version}
          releaseNotesHref="https://github.com/erdembas/runhq/releases/latest"
          className="scroll-zoom-in-late"
        />
      </div>
    </section>
  );
}
