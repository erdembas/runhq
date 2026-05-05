import type { ServiceDef, Status } from '@runhq/cockpit-types';

/**
 * Phase-0 smoke component. Proves three things at the same time:
 *
 *   1. The package compiles standalone (`tsc --noEmit`).
 *   2. The cockpit-types contract crosses package boundaries
 *      cleanly (`ServiceDef` / `Status` resolve via the workspace
 *      symlink, not via a relative `../../desktop/src/types` hack).
 *   3. The marketing site can actually render a presentational
 *      component sourced from this package — i.e. the Next.js
 *      bundler tree-shakes it, no Tauri / Zustand transitive
 *      imports leak through.
 *
 * Real cockpit components land in Phase 1 alongside this file.
 */
export function HelloCockpit({
  service,
  status,
}: {
  service: Pick<ServiceDef, 'name' | 'cwd'>;
  status: Status;
}) {
  return (
    <div className="cockpit-hello">
      <strong>{service.name}</strong>
      <span> · </span>
      <code>{service.cwd}</code>
      <span> · </span>
      <em data-status={status}>{status}</em>
    </div>
  );
}
