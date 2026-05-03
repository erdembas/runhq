import type { PersistedScan, ServiceId } from '@/types';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createOverviewSlice: AppStoreSlice = (set) => ({
  overview: null,
  overviewLoading: false,
  overviewScanning: false,
  lastScanAt: null,
  scanFreshnessByService: new Map<ServiceId, number>(),
  scanDurationByService: new Map<ServiceId, number | null>(),
  scanDeltasByService: new Map(),
  scanningServiceIds: new Set<ServiceId>(),
  setOverview: (v) => set({ overview: v }),
  setOverviewLoading: (v) => set({ overviewLoading: v }),
  setOverviewScanning: (v) => set({ overviewScanning: v }),
  patchOverviewScan: (result) =>
    set((s) => {
      if (!s.overview) return s;
      const byId = new Map(result.entries.map((e) => [e.service_id, e]));
      const projects = s.overview.projects.map((p) => {
        const hit = byId.get(p.service_id);
        // Merge `license` alongside `outdated` / `audit` so the
        // dashboard's `LicenseChip` lights up the moment the
        // workspace scan returns. Cards whose entry didn't carry a
        // license summary (runtime not supported, scan timed out)
        // keep their previous value rather than wiping the chip —
        // a transient timeout shouldn't erase yesterday's known
        // contamination.
        return hit
          ? {
              ...p,
              outdated: hit.outdated,
              audit: hit.audit,
              license: hit.license ?? p.license,
            }
          : p;
      });

      // Compute workspace-wide license totals from the merged
      // project list. The Rust side already returns these in
      // `result.total_license_warnings` etc., but recomputing from
      // `projects` keeps the source of truth consistent with how
      // the chips actually render — the filter chip count and the
      // hero priority bucket both walk `overview.projects`, so we
      // must agree with that same view.
      let totalLicenseWarnings = 0;
      let projectsWithLicenseRisk = 0;
      for (const p of projects) {
        const warnings =
          (p.license?.strong_copyleft_count ?? 0) +
          (p.license?.network_copyleft_count ?? 0) +
          (p.license?.proprietary_count ?? 0);
        totalLicenseWarnings += warnings;
        if (warnings > 0) projectsWithLicenseRisk += 1;
      }

      // Stamp per-project freshness from each entry's own
      // `scanned_at_ms`, not a single `Date.now()`. A 30-project
      // scan returns its results over several seconds; using the
      // batch's own per-entry timestamps keeps the UI honest about
      // which project finished first. Cache-hit entries reuse the
      // original scan's timestamp from the in-memory L1, so they
      // don't falsely advertise "scanned 0s ago".
      const freshness = new Map(s.scanFreshnessByService);
      const durations = new Map(s.scanDurationByService);
      const deltas = new Map(s.scanDeltasByService);
      let maxScannedAt = s.lastScanAt ?? 0;
      for (const e of result.entries) {
        freshness.set(e.service_id, e.scanned_at_ms);
        durations.set(e.service_id, e.duration_ms);
        if (e.scanned_at_ms > maxScannedAt) maxScannedAt = e.scanned_at_ms;

        // Compute delta only for fresh runs that have a prior row
        // to compare against. Cache hits expose neither
        // `previous_*` nor a meaningful "what changed", so we drop
        // any leftover delta for that service to avoid showing a
        // stale "+3" forever.
        if (!e.from_cache) {
          const liveOutdated = e.outdated?.total ?? 0;
          const liveVulns = e.audit
            ? e.audit.critical + e.audit.high + e.audit.medium + e.audit.low
            : 0;
          const dOutdated =
            e.previous_total_outdated != null ? liveOutdated - e.previous_total_outdated : null;
          const dVulns =
            e.previous_total_vulnerabilities != null
              ? liveVulns - e.previous_total_vulnerabilities
              : null;
          if ((dOutdated != null && dOutdated !== 0) || (dVulns != null && dVulns !== 0)) {
            deltas.set(e.service_id, { outdated: dOutdated, vulnerabilities: dVulns });
          } else {
            deltas.delete(e.service_id);
          }
        } else {
          deltas.delete(e.service_id);
        }
      }
      return {
        overview: {
          ...s.overview,
          projects,
          total_outdated: result.total_outdated,
          total_vulnerabilities: result.total_vulnerabilities,
          total_license_warnings: totalLicenseWarnings,
          projects_with_license_risk: projectsWithLicenseRisk,
          has_dependency_scan: true,
        },
        lastScanAt: maxScannedAt > 0 ? maxScannedAt : Date.now(),
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        scanDeltasByService: deltas,
      };
    }),
  patchScanEntry: (entry) =>
    set((s) => {
      // Single-project mirror of `patchOverviewScan`. Skip the heavy
      // recompute of total_outdated / total_vulnerabilities — those
      // numbers stay correct because we update *one* project's
      // contribution in place and adjust the global totals by the
      // delta.
      // Capture old project (pre-merge) so we can both render the new
      // license slot AND compute the delta against the workspace
      // totals without two `find()` walks per total.
      const oldProject = s.overview?.projects.find((p) => p.service_id === entry.service_id);
      const newLicense = entry.license ?? oldProject?.license ?? null;

      const oldLicenseWarnings = oldProject?.license
        ? (oldProject.license.strong_copyleft_count ?? 0) +
          (oldProject.license.network_copyleft_count ?? 0) +
          (oldProject.license.proprietary_count ?? 0)
        : 0;
      const newLicenseWarnings = newLicense
        ? (newLicense.strong_copyleft_count ?? 0) +
          (newLicense.network_copyleft_count ?? 0) +
          (newLicense.proprietary_count ?? 0)
        : 0;

      const overview = s.overview
        ? {
            ...s.overview,
            projects: s.overview.projects.map((p) =>
              p.service_id === entry.service_id
                ? {
                    ...p,
                    outdated: entry.outdated,
                    audit: entry.audit,
                    license: newLicense,
                  }
                : p,
            ),
            // Adjust workspace totals by the per-project delta so the
            // header chip ("12 advisories") doesn't drift after a
            // single rescan. Falls back to a cheap local recompute
            // when the previous-totals fields aren't available.
            total_outdated: (() => {
              const oldT = oldProject?.outdated?.total ?? 0;
              const newT = entry.outdated?.total ?? 0;
              return Math.max(0, s.overview!.total_outdated + (newT - oldT));
            })(),
            total_vulnerabilities: (() => {
              const oldA = oldProject?.audit;
              const oldT = oldA ? oldA.critical + oldA.high + oldA.medium + oldA.low : 0;
              const newA = entry.audit;
              const newT = newA ? newA.critical + newA.high + newA.medium + newA.low : 0;
              return Math.max(0, s.overview!.total_vulnerabilities + (newT - oldT));
            })(),
            total_license_warnings: Math.max(
              0,
              s.overview.total_license_warnings + (newLicenseWarnings - oldLicenseWarnings),
            ),
            projects_with_license_risk: Math.max(
              0,
              s.overview.projects_with_license_risk +
                (newLicenseWarnings > 0 ? 1 : 0) -
                (oldLicenseWarnings > 0 ? 1 : 0),
            ),
            has_dependency_scan: true,
          }
        : s.overview;

      const freshness = new Map(s.scanFreshnessByService);
      freshness.set(entry.service_id, entry.scanned_at_ms);
      const durations = new Map(s.scanDurationByService);
      durations.set(entry.service_id, entry.duration_ms);

      const deltas = new Map(s.scanDeltasByService);
      if (!entry.from_cache) {
        const liveOutdated = entry.outdated?.total ?? 0;
        const liveVulns = entry.audit
          ? entry.audit.critical + entry.audit.high + entry.audit.medium + entry.audit.low
          : 0;
        const dOutdated =
          entry.previous_total_outdated != null
            ? liveOutdated - entry.previous_total_outdated
            : null;
        const dVulns =
          entry.previous_total_vulnerabilities != null
            ? liveVulns - entry.previous_total_vulnerabilities
            : null;
        if ((dOutdated != null && dOutdated !== 0) || (dVulns != null && dVulns !== 0)) {
          deltas.set(entry.service_id, { outdated: dOutdated, vulnerabilities: dVulns });
        } else {
          deltas.delete(entry.service_id);
        }
      } else {
        deltas.delete(entry.service_id);
      }

      const lastScanAt = Math.max(s.lastScanAt ?? 0, entry.scanned_at_ms);

      return {
        overview,
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        scanDeltasByService: deltas,
        lastScanAt: lastScanAt > 0 ? lastScanAt : s.lastScanAt,
      };
    }),
  setScanningService: (serviceId, scanning) =>
    set((s) => {
      // We re-create the Set only when membership actually changes —
      // selectors that subscribe to scanningServiceIds via Set
      // identity won't re-render unless their service flipped.
      const has = s.scanningServiceIds.has(serviceId);
      if (scanning && has) return s;
      if (!scanning && !has) return s;
      const next = new Set(s.scanningServiceIds);
      if (scanning) next.add(serviceId);
      else next.delete(serviceId);
      return { scanningServiceIds: next };
    }),
  hydratePersistedScans: (rows) =>
    set((s) => {
      if (rows.length === 0) {
        return s;
      }

      // Two-step merge: (1) seed the freshness/duration maps so the
      // chips light up immediately, (2) splice the persisted
      // outdated/audit blobs into `overview.projects` so the
      // numerical chips (12 outdated, 3 advisories) render too. The
      // overview merge is a no-op when overview hasn't loaded yet —
      // the next `setOverview` will pick this up via the freshness
      // map alone.
      const freshness = new Map(s.scanFreshnessByService);
      const durations = new Map(s.scanDurationByService);
      const persistedById = new Map<string, PersistedScan>();
      let maxScannedAt = s.lastScanAt ?? 0;
      for (const row of rows) {
        // Don't clobber a fresher in-memory entry — the user might
        // have just kicked off a scan whose first results arrived
        // a tick before this hydration call resolved. Persisted
        // rows are at best as fresh as the scan that wrote them.
        const existing = freshness.get(row.service_id);
        if (existing == null || existing < row.scanned_at_ms) {
          freshness.set(row.service_id, row.scanned_at_ms);
          durations.set(row.service_id, row.duration_ms);
        }
        persistedById.set(row.service_id, row);
        if (row.scanned_at_ms > maxScannedAt) maxScannedAt = row.scanned_at_ms;
      }

      // The Rust side ALSO merges persisted scans into the overview
      // it returns from `get_project_overview`, so usually `overview`
      // already carries the audit/outdated data by the time this
      // runs. We splice anyway for the corner case where the
      // overview was fetched before persistence existed (older app
      // version's overview cached in memory) or where a service's
      // overview row is somehow missing the chips — defensive,
      // cheap, idempotent.
      const hydratedProjects = s.overview?.projects.map((p) => {
        const hit = persistedById.get(p.service_id);
        if (!hit) return p;
        return {
          ...p,
          outdated: p.outdated ?? hit.outdated,
          audit: p.audit ?? hit.audit,
          // Same "fill the gap, don't clobber" policy as the deps
          // hydration above: a fresh in-memory scan beats whatever
          // SQLite knows about; SQLite only fills holes.
          license: p.license ?? hit.license,
        };
      });

      // Recompute workspace license totals from the hydrated
      // projects. Persisted rows carry their own
      // `total_license_warnings`, but only after applying our
      // "don't clobber fresher in-memory data" merge policy can we
      // know which projects actually contribute.
      let totalLicenseWarnings = 0;
      let projectsWithLicenseRisk = 0;
      if (hydratedProjects) {
        for (const p of hydratedProjects) {
          const warnings =
            (p.license?.strong_copyleft_count ?? 0) +
            (p.license?.network_copyleft_count ?? 0) +
            (p.license?.proprietary_count ?? 0);
          totalLicenseWarnings += warnings;
          if (warnings > 0) projectsWithLicenseRisk += 1;
        }
      }

      const overview =
        s.overview && hydratedProjects
          ? {
              ...s.overview,
              projects: hydratedProjects,
              total_license_warnings: totalLicenseWarnings,
              projects_with_license_risk: projectsWithLicenseRisk,
              has_dependency_scan: s.overview.has_dependency_scan || rows.length > 0,
            }
          : s.overview;

      return {
        overview,
        scanFreshnessByService: freshness,
        scanDurationByService: durations,
        // Only advance the global "last scanned" if it's older than
        // the freshest persisted row — otherwise a hydration call
        // post-scan would rewind the badge.
        lastScanAt: maxScannedAt > (s.lastScanAt ?? 0) ? maxScannedAt : s.lastScanAt,
      };
    }),
});
