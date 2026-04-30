import type { WorkspaceFacts } from '@/lib/ai/workspaceSummary';

/**
 * Translate a `WorkspaceFacts` snapshot into the payload `openAiChat`
 * needs to start a "Analyze workspace" conversation in the right-side
 * chat panel.
 *
 * This replaces the dedicated `AiWorkspaceReportDialog`/`ai_analyze_workspace`
 * surface — the dialog mounted its own stream and copy buttons. Now that
 * every AI surface routes through the chat hub we hand the same JSON
 * facts blob over as a one-shot prompt, the chat panel inherits the
 * model picker / persistence / follow-up behaviour for free.
 *
 * The system prompt is kept structurally identical to the legacy
 * `build_workspace_report_prompt` so regenerations still produce the
 * **TL;DR / Risk hotspots / Quick wins / Steady state** layout the user
 * has built muscle memory for.
 */
export interface WorkspaceReportChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

/** Same character ceiling the Rust prompt builder uses to tail-trim. We
 *  apply it on the client too so we don't pay to round-trip a 50K JSON
 *  blob just to have it truncated downstream. */
const MAX_FACTS_CHARS = 12_000;

export function buildWorkspaceReportChatPayload(facts: WorkspaceFacts): WorkspaceReportChatPayload {
  const projectCount = facts.workspace.project_count;

  const factsJson = JSON.stringify(facts, null, 2);
  const trimmedNote =
    factsJson.length > MAX_FACTS_CHARS
      ? '\n\n[snapshot truncated — only the first portion of the workspace was sent]'
      : '';
  const factsBody =
    factsJson.length > MAX_FACTS_CHARS ? factsJson.slice(0, MAX_FACTS_CHARS) : factsJson;

  const systemBase =
    "You are RunHQ's portfolio-review assistant — an experienced tech lead reading a one-page workspace snapshot for a working engineer. " +
    'Answer in GitHub-flavoured Markdown using exactly four sections in this order: ' +
    '**TL;DR** (one sentence — the single most important thing to do today), ' +
    "**Risk hotspots** (up to four bullets, each naming a specific project and the concrete reason it's risky — network/strong copyleft license contamination, RCE-class CVEs, repeated crashes, dirty trees blocking deploys, weeks of staleness on a critical service), " +
    '**Quick wins** (up to three bullets — things shippable in under 30 minutes: a `cargo update`, a clean stash-and-pull, an obvious `npm audit fix`, swapping a single AGPL/GPL package for a permissive alternative), ' +
    '**Steady state** (one line — what\'s quietly healthy and doesn\'t need attention; if everything is on fire, say "nothing"). ' +
    'Cite real project names from the facts in backticks. Cite real numbers — never round vaguely ("a few CVEs" is wrong; "3 critical CVEs in `belgehub-mobile`" is right). ' +
    'Suggested commands go in backticks. ' +
    'When a section has no qualifying projects, write "None." rather than padding it with weak items. ' +
    // License is the silent ship-killer in commercial software. Bake
    // it into the priority ordering so the model doesn't bury an
    // AGPL contamination under "12 outdated packages" noise — by the
    // time you discover an AGPL leak in code review, you've already
    // shipped.
    'Priority order in Risk hotspots: network-copyleft (AGPL/SSPL) and strong-copyleft (GPL) ' +
    'license contamination > critical CVEs > major outdated bumps > stale/dirty/everything else. ' +
    'When a project carries license contamination from `license.top_warnings`, name the offending ' +
    'package(s) explicitly — "`finsel-mobile` ships `node-forge` under `(BSD-3-Clause OR GPL-2.0)` ' +
    '(strong copyleft)" — never paraphrase to a vague "license issue". ' +
    "Never invent projects, packages, or CVE/license details that aren't in the facts. " +
    'Keep the entire response under 250 words.';

  const contextSystemMessage = [
    systemBase,
    '',
    'Here is the workspace snapshot. The `workspace` object holds aggregate counts; ' +
      '`projects` is an array, ordered by importance (highest-risk first).',
    '',
    '```json',
    factsBody,
    '```' + trimmedNote,
  ].join('\n');

  return {
    title: 'Workspace report',
    context: {
      kind: 'workspace_report',
      project_count: projectCount,
      cve_critical: facts.workspace.cve_critical,
      cve_high: facts.workspace.cve_high,
      outdated_packages: facts.workspace.outdated_packages,
      stale_projects: facts.workspace.stale_projects,
      dirty_projects: facts.workspace.dirty_projects,
      license_network_copyleft: facts.workspace.license_network_copyleft,
      license_strong_copyleft: facts.workspace.license_strong_copyleft,
      license_proprietary: facts.workspace.license_proprietary,
      projects_with_license_risk: facts.workspace.projects_with_license_risk,
    },
    draftPrompt: 'Review this workspace snapshot and tell me where to focus.',
    contextSystemMessage,
  };
}
