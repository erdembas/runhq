import type { ContaminationWarning, LicenseRisk, LicenseScanResult } from '@/types';

/**
 * Translate a license-scan result into the payload shape `openAiChat`
 * needs to start a "Triage these license risks" conversation in the
 * right-side chat panel.
 *
 * Mirrors the advisory-payload pair (`buildAdvisoryChatPayload` /
 * `buildSingleAdvisoryChatPayload`):
 *
 *  - {@link buildLicenseChatPayload}        — bulk: "given N
 *    contamination warnings + a license distribution, what's my
 *    fix order?". Optimised for skim.
 *  - {@link buildSingleLicenseChatPayload}  — per-warning: "is
 *    this *really* GPL? am I obligated to open-source? what are
 *    the alternatives?". Optimised for decision-making on a
 *    single high-stakes dep swap.
 *
 * Why a separate payload pair instead of reusing the advisory one?
 * The questions are fundamentally different. Advisories ask "what
 * do I patch tonight to avoid getting popped?" — the model is in
 * security-engineer mode. License questions ask "which of these
 * packages will torpedo my commercial release?" — the model is in
 * IP-counsel-meets-engineer mode. The system prompts are tuned
 * accordingly, especially the explicit "you are not a lawyer; this
 * is engineering guidance" disclaimer that we don't need on the
 * CVE side.
 */
export interface LicenseChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

/**
 * Risk severity ranking for trimming the warning list when we have
 * to drop rows for length. Higher commercial impact = lower number =
 * survives the trim.
 *
 *   0 network_copyleft  AGPL/SSPL — ship-killer for SaaS, the
 *                        moment a single network call enters the
 *                        AGPL tree the entire service has to be
 *                        published.
 *   1 strong_copyleft   GPL family — infects on linking. Less
 *                        catastrophic than AGPL for SaaS but still
 *                        a "must replace before redistribution" call.
 *   2 proprietary       Commercial-only / unknown commercial —
 *                        usually fixable with a paid license, no
 *                        re-architecture needed; lowest of the
 *                        three contamination tiers.
 *   3 weak_copyleft     LGPL/MPL/EPL — usually fine if used
 *                        unmodified, but worth flagging.
 *   4 unknown           No license metadata, manual spot-check
 *                        territory.
 *   5 permissive/safe   MIT/BSD/Apache — non-warnings, included
 *                        only as flat counts in the system prompt
 *                        for context.
 */
const RISK_RANK: Record<LicenseRisk, number> = {
  network_copyleft: 0,
  strong_copyleft: 1,
  proprietary: 2,
  weak_copyleft: 3,
  unknown: 4,
  permissive: 5,
  safe: 5,
};

const MAX_WARNING_ROWS = 40;
const MAX_CHARS = 12_000;

interface BuildBulkInput {
  result: LicenseScanResult;
  projectName: string;
  runtime: string | null;
}

export function buildLicenseChatPayload(input: BuildBulkInput): LicenseChatPayload {
  const { result, projectName, runtime } = input;

  // Sort warnings by commercial impact so a trimmed prompt drops the
  // softest rows (proprietary) before the hardest (AGPL). Within
  // a risk tier, keep the original discovery order — the scanner
  // already produces it deterministically and reordering by package
  // name would muddle the "this AGPL package shows up via that GPL
  // transitive parent" narrative the model might pick up on.
  const warnings = [...result.contamination_warnings].sort(
    (a, b) => (RISK_RANK[a.risk] ?? 9) - (RISK_RANK[b.risk] ?? 9),
  );

  const total = warnings.length;
  const capped = warnings.slice(0, MAX_WARNING_ROWS);

  let body = '';
  let included = 0;
  let charCapped = false;
  for (const w of capped) {
    const line = renderBulkLine(w);
    if (body.length > 0 && body.length + line.length + 1 > MAX_CHARS) {
      charCapped = true;
      break;
    }
    if (body.length > 0) body += '\n';
    body += line;
    included += 1;
  }

  // Distribution row: gives the model a sense of "how dirty is the
  // tree?" in one line. A project where the *only* contamination is
  // 1 strong copyleft inside 2000 permissive packages is a different
  // conversation than one where 30 of 100 entries are AGPL.
  const distribution = [
    `permissive=${result.permissive_count + result.safe_count}`,
    `weak_copyleft=${result.weak_copyleft_count}`,
    `strong_copyleft=${result.strong_copyleft_count}`,
    `network_copyleft=${result.network_copyleft_count}`,
    `proprietary=${result.proprietary_count}`,
    `unknown=${result.unknown_count}`,
    `total_entries=${result.entries.length}`,
  ].join(' · ');

  const systemBase =
    'You are a senior open-source compliance engineer helping a developer ship ' +
    'commercial software while staying on the right side of their dependency licenses. ' +
    'You are NOT a lawyer; you provide engineering guidance based on the public, ' +
    'well-understood obligations of common OSS licenses (MIT, Apache-2.0, BSD, MPL, ' +
    'LGPL, GPL, AGPL, SSPL). When the situation is genuinely murky, say so and ' +
    'recommend formal legal review rather than guessing.\n\n' +
    'Answer in GitHub-flavoured Markdown using EXACTLY this four-section structure ' +
    '(no extra headings, no preamble):\n\n' +
    '### TL;DR\n' +
    'One or two sentences naming the single most expensive contamination on the list ' +
    'and the cheapest action that defuses it (replace / paid license / re-architect).\n\n' +
    '### Fix order\n' +
    'Numbered list, hottest first, at most six items. Each item:\n' +
    '  • Names the package(s) and the license class (AGPL, GPL, etc.).\n' +
    '  • Says in plain English **what the user is obligated to do** if they ship as-is ' +
    '(publish source, keep it internal, paid license, etc.) — be specific to the license.\n' +
    '  • Recommends an **action**: a named permissive alternative when one exists ' +
    '(e.g. `node-forge` → `@noble/hashes` / `crypto`-builtin), or a paid commercial ' +
    'license, or a build-time-only carve-out (dev/test deps that never ship).\n' +
    'Group multiple offenders that share the same parent or the same license class ' +
    'into one item.\n\n' +
    '### Distribution model assumptions\n' +
    'Two or three bullets calling out which deployment model your guidance assumes ' +
    '(SaaS / on-prem binary / open-source library) and which obligations change if ' +
    'that model is wrong. AGPL is dramatically less scary for an internal-only tool ' +
    'than for a public SaaS — make the model explicit so the user can correct you.\n\n' +
    '### Likely noise\n' +
    'One line OR omit the section. Use it ONLY when one or more rows are genuinely ' +
    'low-risk to defer (dev-only / build-only deps that never ship, weak copyleft used ' +
    'unmodified, unknowns the user can spot-check later).\n\n' +
    'Hard rules:\n' +
    '- NEVER invent licenses, alternative packages, or version numbers that are not ' +
    'in the supplied facts.\n' +
    '- Use backticks for every package name, license id, and command.\n' +
    '- Keep total length under 350 words.\n' +
    "- If a row's `license` field is genuinely ambiguous (dual-license, custom text), " +
    'flag it as "needs manual review" rather than guessing the obligation.';

  const trimNote: string[] = [];
  if (included < total) {
    trimNote.push(
      `Warnings: ${included} of ${total} (lower-impact rows trimmed for length — note this in your fix order)`,
    );
  } else {
    trimNote.push(`Warnings: ${included}`);
  }
  if (warnings.length > MAX_WARNING_ROWS) trimNote.push('[row cap]');
  if (charCapped) trimNote.push('[char cap]');

  const projectLine = projectName ? `Project: \`${projectName}\`` : '';
  const runtimeLine = runtime ? `Runtime: \`${runtime}\`` : '';
  const distributionLine = `Distribution: ${distribution}`;

  const contextSystemMessage = [
    systemBase,
    '',
    'Here are the contamination warnings the user is asking about. Cite real package names ' +
      'and license ids in backticks; do not paraphrase the license id.',
    '',
    [projectLine, runtimeLine, distributionLine, trimNote.join(' ')].filter(Boolean).join('\n'),
    '',
    '```',
    body || '(no warnings — analyse the distribution counts and call out any unknowns)',
    '```',
  ].join('\n');

  const titleSuffix = projectName
    ? `${projectName} · ${included} license warnings`
    : `${included} license warnings`;

  return {
    title: `Licenses · ${titleSuffix}`,
    context: {
      kind: 'license_triage',
      project_name: projectName,
      runtime,
      total,
      included,
      strong_copyleft: result.strong_copyleft_count,
      network_copyleft: result.network_copyleft_count,
      proprietary: result.proprietary_count,
    },
    draftPrompt: 'Triage these license warnings — what do I replace first to ship commercial?',
    contextSystemMessage,
  };
}

interface BuildSingleInput {
  warning: ContaminationWarning;
  /** Full result is passed (rather than just `warning`) so the model
   *  can see "you're hitting GPL via this transitive parent" — a
   *  fix that swaps the parent often defuses several warnings at
   *  once and we don't want the per-row prompt to miss that. */
  result: LicenseScanResult;
  projectName: string;
  runtime: string | null;
}

/**
 * Per-warning deep-dive prompt.
 *
 * Different from {@link buildLicenseChatPayload} (which ranks a *list*)
 * in shape and tone. The single-warning prompt is structured so the
 * answer is always the same shape — TL;DR, what this license requires,
 * am-I-obligated, alternatives, fix — which keeps follow-up Q&A
 * grounded ("you said `node-forge` is replaceable, by what?").
 */
export function buildSingleLicenseChatPayload(input: BuildSingleInput): LicenseChatPayload {
  const { warning, result, projectName, runtime } = input;

  const systemBase =
    'You are a senior open-source compliance engineer helping a developer ' +
    'evaluate ONE license-contamination warning before they ship commercial ' +
    'software. You are NOT a lawyer; offer engineering guidance grounded in ' +
    'the well-understood obligations of common OSS licenses (MIT, Apache-2.0, ' +
    'BSD, MPL, LGPL, GPL, AGPL, SSPL). When the package uses a custom or ' +
    "dual license you can't evaluate confidently from the id alone, recommend " +
    'formal legal review.\n\n' +
    'Answer in GitHub-flavoured Markdown using EXACTLY this five-section ' +
    'structure (no extra headings, no preamble):\n\n' +
    '### TL;DR\n' +
    'One or two sentences naming the license class (strong copyleft / ' +
    'network copyleft / proprietary) and the single most important takeaway ' +
    'for someone shipping a commercial product. If this is AGPL/SSPL, the ' +
    'TL;DR must mention the SaaS-trigger explicitly.\n\n' +
    '### What this license requires\n' +
    'Bullet list of the concrete obligations a commercial user takes on by ' +
    'shipping a product that links against this package. Cite the obligation ' +
    'classes by name (source disclosure, copyleft scope, network-trigger, ' +
    'patent grant, attribution). Skip historical context — focus on what the ' +
    'user must DO if they ship.\n\n' +
    '### Am I obligated?\n' +
    'A short verdict (Yes / Likely / Possibly / Unlikely / Need more info) ' +
    'followed by 1–3 bullets justifying the call. Anchor your reasoning on ' +
    'the supplied distribution model assumption (SaaS vs binary vs library) — ' +
    "if the user didn't specify, default to public-internet SaaS and say so. " +
    'If the dep appears dev-only / build-only based on the package name, ' +
    'downgrade the verdict accordingly and flag that assumption.\n\n' +
    '### Alternatives\n' +
    'Numbered list, at most three items. For each alternative, give:\n' +
    '  • The replacement package (real, well-known npm/cargo/PyPI name).\n' +
    '  • Its license (must be permissive: MIT/Apache-2.0/BSD/ISC).\n' +
    '  • One-line note on API parity ("drop-in", "API differs around X", ' +
    '"requires re-architecting Y").\n' +
    'If you do NOT know a real permissive alternative, say "no widely-adopted ' +
    'permissive alternative known — consider commercial license or removing ' +
    'the dep" rather than inventing one.\n\n' +
    '### Fix\n' +
    'Numbered steps. Lead with the install command in backticks (npm/yarn/' +
    'pnpm/pip/cargo matching the `runtime`). Mention if migrating away ' +
    'requires a code change. If no replacement exists, recommend one of: ' +
    'pinning to a known-good version + isolating behind a build flag, ' +
    'purchasing a commercial license, or vendoring + sandboxing the offending ' +
    'code path.\n\n' +
    'Hard rules:\n' +
    '- NEVER invent licenses, alternative packages, or version numbers that ' +
    "aren't in the supplied facts.\n" +
    '- Use backticks for every package name, license id, version, and command.\n' +
    '- Total length: under 400 words. Density over volume.\n' +
    '- If the license id is itself ambiguous (e.g. dual `(BSD-3-Clause OR ' +
    'GPL-2.0)`), explain the dual-license dynamic in TL;DR — the user almost ' +
    'always picks the permissive side.';

  const facts: string[] = [];
  facts.push(`- Package: \`${warning.package}\``);
  facts.push(`- Version: \`${warning.version}\``);
  facts.push(`- License: \`${warning.license}\``);
  facts.push(`- Risk class: ${warning.risk}`);
  if (warning.message) facts.push(`- Scanner note: ${warning.message}`);
  if (projectName) facts.push(`- Project: \`${projectName}\``);
  if (runtime) facts.push(`- Runtime: \`${runtime}\``);

  // Add a one-line "tree shape" so the model knows whether this
  // package is the only offender or one of many. Drives whether
  // it should recommend a per-package swap or a parent-level fix.
  const otherWarningsCount = Math.max(0, result.contamination_warnings.length - 1);
  if (otherWarningsCount > 0) {
    facts.push(
      `- Other contamination in this tree: ${otherWarningsCount} additional warning${otherWarningsCount === 1 ? '' : 's'}`,
    );
  }

  const contextSystemMessage = [
    systemBase,
    '',
    'Here is the single contamination warning the user wants you to analyse. ' +
      'Cite the package name, version, and license id verbatim from this list.',
    '',
    facts.join('\n'),
  ].join('\n');

  const projectTag = projectName ? ` · ${projectName}` : '';
  const title = `Analyze · ${warning.package}${projectTag}`;

  const draftPrompt =
    `Analyse this ${prettyRisk(warning.risk)} dependency \`${warning.package}\` v${warning.version} ` +
    `(\`${warning.license}\`). What does this license require, am I obligated if I ship commercial, ` +
    'and what are my replacement options?';

  return {
    title,
    context: {
      kind: 'license_single',
      project_name: projectName,
      runtime,
      package: warning.package,
      version: warning.version,
      license: warning.license,
      risk: warning.risk,
    },
    draftPrompt,
    contextSystemMessage,
  };
}

function renderBulkLine(w: ContaminationWarning): string {
  // Format mirrors the advisory bulk renderer for visual consistency
  // when both prompts land in the same chat surface.
  return `- [${prettyRisk(w.risk)}] \`${w.package}\` v${w.version} — \`${w.license}\``;
}

function prettyRisk(risk: LicenseRisk): string {
  switch (risk) {
    case 'network_copyleft':
      return 'network-copyleft';
    case 'strong_copyleft':
      return 'strong-copyleft';
    case 'weak_copyleft':
      return 'weak-copyleft';
    default:
      return risk;
  }
}
