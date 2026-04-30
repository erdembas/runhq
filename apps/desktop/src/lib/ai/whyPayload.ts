import type { ProjectOverview } from '@/types';

/**
 * Translate a `ProjectOverview` row into the payload `openAiChat` needs
 * to start a "Why is this project flagged?" conversation in the
 * right-side chat panel.
 *
 * We deliberately mirror what the legacy `ProjectExplainPopover` was
 * doing: a one-line headline ("name: stale 6w · 12 outdated · 3 CVEs")
 * plus a JSON facts blob (`runtime`, `is_stale`, `outdated`, `audit`).
 * The chat panel then sends this as a regular completion — the model
 * receives the same evidence it always did, just over the unified
 * chat-completion path instead of a dedicated `aiExplainProjectState`
 * endpoint. That lets the user pick a model, edit the prompt, follow
 * up, and persist the conversation into history.
 *
 * The `draftPrompt` is the user-facing question. We auto-send from the
 * Why? button so the model picker stays interactive but the user
 * doesn't have to retype the obvious question.
 */
export interface WhyChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

export function buildWhyChatPayload(p: ProjectOverview): WhyChatPayload {
  const flags: string[] = [];
  if (p.is_stale) flags.push(staleFragment(p.last_activity));
  const dirty = formatDirty(p.git_status);
  if (dirty) flags.push(dirty);
  if (p.outdated && p.outdated.total > 0) {
    const parts = [
      p.outdated.major ? `${p.outdated.major} major` : null,
      p.outdated.minor ? `${p.outdated.minor} minor` : null,
      p.outdated.patch ? `${p.outdated.patch} patch` : null,
    ].filter(Boolean);
    flags.push(`${p.outdated.total} outdated (${parts.join(', ') || 'mixed'})`);
  }
  if (p.audit) {
    const total = p.audit.critical + p.audit.high + p.audit.medium + p.audit.low;
    if (total > 0) {
      const parts = [
        p.audit.critical ? `${p.audit.critical} critical` : null,
        p.audit.high ? `${p.audit.high} high` : null,
        p.audit.medium ? `${p.audit.medium} medium` : null,
        p.audit.low ? `${p.audit.low} low` : null,
      ].filter(Boolean);
      flags.push(`${total} CVE${total === 1 ? '' : 's'} (${parts.join(', ')})`);
    }
  }
  // License contamination is a first-class flag now — without it the
  // "Why?" headline would say "stale 4mo · 62 outdated" on a project
  // that's *also* about to ship AGPL-tainted code, and the model would
  // never bring it up. Surface the warning class breakdown here so
  // the prioritisation in the answer accounts for license risk
  // alongside CVEs.
  const license = p.license;
  if (license && license.has_contamination) {
    const parts = [
      license.network_copyleft_count ? `${license.network_copyleft_count} network copyleft` : null,
      license.strong_copyleft_count ? `${license.strong_copyleft_count} strong copyleft` : null,
      license.proprietary_count ? `${license.proprietary_count} proprietary` : null,
    ].filter(Boolean);
    const totalWarnings =
      license.network_copyleft_count + license.strong_copyleft_count + license.proprietary_count;
    if (totalWarnings > 0) {
      flags.push(
        `${totalWarnings} license risk${totalWarnings === 1 ? '' : 's'} (${parts.join(', ')})`,
      );
    }
  }

  const headline = flags.length ? `${p.name}: ${flags.join(' · ')}` : `${p.name}: looks clean`;

  const facts: Record<string, unknown> = {
    name: p.name,
    runtime: p.runtime,
    is_running: p.is_running,
    is_stale: p.is_stale,
    last_activity: p.last_activity,
  };
  if (p.git_status) facts.git_status = p.git_status;
  if (p.outdated) facts.outdated = p.outdated;
  if (p.audit) facts.audit = p.audit;
  // License facts: include the full summary (counts + top 3 warnings)
  // so a follow-up "which license should I replace first?" has real
  // package names to point at, not a vague "you have GPL somewhere".
  // Skip when scan_supported is false to avoid sending phantom-zero
  // counts that the model would misread as "clean".
  if (license && license.scan_supported) {
    facts.license = {
      runtime: license.runtime,
      total_entries: license.total_entries,
      permissive: license.permissive_count + license.safe_count,
      weak_copyleft: license.weak_copyleft_count,
      strong_copyleft: license.strong_copyleft_count,
      network_copyleft: license.network_copyleft_count,
      proprietary: license.proprietary_count,
      unknown: license.unknown_count,
      has_contamination: license.has_contamination,
      top_warnings: license.top_warnings.map((w) => ({
        package: w.package,
        version: w.version,
        license: w.license,
        risk: w.risk,
      })),
    };
  }

  // System message ferried with EVERY send in the conversation so a
  // follow-up question ("ok, which CVE first?") still has the facts
  // grounded. Keeping the JSON in a fenced code block makes it
  // unambiguous to the model and easy to debug if the conversation
  // ever needs to be replayed against a different provider.
  const contextSystemMessage = [
    `User is asking about a flagged project from the RunHQ dashboard. Headline: "${headline}".`,
    'These are the project facts. Cite specific numbers when explaining the situation.',
    '',
    '```json',
    JSON.stringify(facts, null, 2),
    '```',
    '',
    'Lead with a one-line takeaway, then a short prioritised plan (3 bullets max). Be specific and actionable.',
    // License is the silent ship-killer in commercial software, so
    // bake the priority into the system prompt rather than relying on
    // the model to notice it on its own. Network copyleft (AGPL/SSPL)
    // outranks even critical CVEs for SaaS because a CVE is a one-day
    // patch, AGPL contamination is a re-architect.
    'Priority order when multiple flags compete: network-copyleft / strong-copyleft licenses ' +
      '> critical CVEs > major outdated bumps > everything else. If the project carries license ' +
      'contamination, NEVER bury it under outdated-package noise — call it out explicitly with ' +
      'the offending package name(s) from `license.top_warnings` and a one-line replacement hint.',
  ].join('\n');

  return {
    title: `Why? · ${p.name}`,
    context: { project: facts, headline },
    draftPrompt: `Why is "${p.name}" flagged, and what should I do first?`,
    contextSystemMessage,
  };
}

function staleFragment(lastActivity: string | null): string {
  if (!lastActivity) return 'stale (no recorded activity)';
  try {
    const diffMs = Date.now() - new Date(lastActivity).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'stale';
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 365) return `stale ${Math.floor(days / 365)}y`;
    if (days >= 30) return `stale ${Math.floor(days / 30)}mo`;
    if (days >= 7) return `stale ${Math.floor(days / 7)}w`;
    return `stale ${days}d`;
  } catch {
    return 'stale';
  }
}

function formatDirty(git: ProjectOverview['git_status']): string | null {
  if (!git) return null;
  const bits: string[] = [];
  if (git.is_dirty) {
    bits.push(`dirty (${git.dirty_count} change${git.dirty_count === 1 ? '' : 's'})`);
  }
  if (git.ahead > 0) bits.push(`${git.ahead} ahead`);
  if (git.behind > 0) bits.push(`${git.behind} behind`);
  return bits.length ? bits.join(', ') : null;
}
