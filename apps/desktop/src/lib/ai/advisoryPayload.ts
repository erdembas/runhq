import type { Advisory } from '@/types';

/**
 * Translate a list of `Advisory` rows into the payload `openAiChat`
 * needs to start a "Triage these CVEs" conversation in the right-side
 * chat panel.
 *
 * Pre-Phase 6 advisory triage lived in an inline panel inside the
 * project detail drawer (a dedicated `useAiStream` + `AiAnswer` block
 * at the top of the advisories list). Routing through `openAiChat`
 * means model picking, history, and follow-ups come for free at the
 * cost of one less local panel.
 *
 * Severity-ranked sort is intentional: when the chat panel ends up
 * trimming the prompt for length, we want the lowest-severity rows
 * dropped, not arbitrary alphabetical ones.
 */
export interface AdvisoryChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  moderate: 2,
  low: 3,
  info: 4,
  informational: 4,
  unknown: 5,
};

const MAX_ROWS = 60;
const MAX_CHARS = 12_000;

interface AdvisoryRowInput {
  id: string | null;
  package: string;
  severity: string;
  title?: string | null;
  vulnerable_range?: string | null;
  fix_version?: string | null;
}

export function buildAdvisoryChatPayload(input: {
  advisories: Advisory[];
  projectName: string;
  runtime: string | null;
}): AdvisoryChatPayload {
  const { advisories, projectName, runtime } = input;

  const rows: AdvisoryRowInput[] = advisories.map((a) => ({
    id: a.id,
    package: a.package,
    severity: a.severity,
    title: a.title,
    vulnerable_range: a.vulnerable_range,
    fix_version: a.fix_version,
  }));

  rows.sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity.toLowerCase()] ?? 5) -
      (SEVERITY_RANK[b.severity.toLowerCase()] ?? 5),
  );

  const total = rows.length;
  const capped = rows.slice(0, MAX_ROWS);

  let body = '';
  let included = 0;
  let charCapped = false;
  for (const r of capped) {
    const line = renderLine(r);
    if (body.length > 0 && body.length + line.length + 1 > MAX_CHARS) {
      charCapped = true;
      break;
    }
    if (body.length > 0) body += '\n';
    body += line;
    included += 1;
  }

  const systemBase =
    'You are a senior application-security engineer triaging a `npm audit`/`pip-audit`/`cargo audit` result for a working developer. ' +
    'Answer in GitHub-flavoured Markdown. Lead with **TL;DR** in one or two sentences naming the single most urgent action. ' +
    'Follow with a **Fix order** numbered list of at most six items; each item names the package, why it matters in plain English (DoS vs RCE vs prototype pollution vs path traversal — be specific to the advisory), and the exact upgrade or mitigation in backticks. ' +
    'Group multiple advisories on the same package into one item. ' +
    'If many advisories share a transitive parent, say so and recommend bumping the parent rather than each leaf. ' +
    'Add a final **Likely noise** section (one line) only when one or more rows are genuinely safe to defer (dev-only deps with no exposure, info-severity, etc.); otherwise omit the section. ' +
    "Never invent CVE details, packages, or fix versions that aren't in the supplied rows. " +
    'When evidence is thin (no fix version, range unspecified) say so in one phrase rather than guessing. ' +
    'Keep total length under 300 words.';

  const trimNote: string[] = [];
  if (included < total) {
    trimNote.push(
      `Advisories: ${included} of ${total} (lower-severity rows trimmed for length — your ranking should explicitly note that the trimmed tail wasn't reviewed)`,
    );
  } else {
    trimNote.push(`Advisories: ${included}`);
  }
  if (rows.length > MAX_ROWS) trimNote.push('[row cap]');
  if (charCapped) trimNote.push('[char cap]');

  const projectLine = projectName ? `Project: \`${projectName}\`` : '';
  const runtimeLine = runtime ? `Runtime: \`${runtime}\`` : '';

  const contextSystemMessage = [
    systemBase,
    '',
    'Here are the advisory rows the user is asking about. Cite real package names and versions in backticks.',
    '',
    [projectLine, runtimeLine, trimNote.join(' ')].filter(Boolean).join('\n'),
    '',
    '```',
    body,
    '```',
  ].join('\n');

  const titleSuffix = projectName
    ? `${projectName} · ${included} advisories`
    : `${included} advisories`;

  return {
    title: `Triage · ${titleSuffix}`,
    context: {
      kind: 'advisory_triage',
      project_name: projectName,
      runtime,
      total,
      included,
    },
    draftPrompt: 'Triage these advisories — what do I fix first?',
    contextSystemMessage,
  };
}

function renderLine(r: AdvisoryRowInput): string {
  const parts: string[] = [];
  parts.push(`- [${r.severity}] \`${r.package}\``);
  if (r.vulnerable_range) parts.push(`range \`${r.vulnerable_range}\``);
  if (r.fix_version) parts.push(`fix \`${r.fix_version}\``);
  if (r.title) parts.push(`— ${r.title}`);
  if (r.id) parts.push(`(${r.id})`);
  return parts.join(' ');
}

/**
 * Per-CVE deep-dive prompt. Different from {@link buildAdvisoryChatPayload}
 * (which ranks a *list*) in shape and tone:
 *
 *  - Triage = "given N rows, what do I fix first?". Optimised for skim.
 *  - Per-CVE = "given this one row, explain what it actually is, where I'm
 *    exposed, what's the worst case, and how to fix". Optimised for
 *    decision-making on a single high-stakes upgrade.
 *
 * The system message is structured so the answer is always the same
 * shape — TL;DR, exposure surface, worst case, am-I-affected, fix —
 * which keeps follow-up Q&A grounded ("you said 'likely affected', why?").
 *
 * We deliberately avoid asking the model to fetch the GHSA URL or the
 * upstream commit; chat-hub providers don't have web access and the
 * model would either refuse or hallucinate. The CVE id + package +
 * severity + title + range/fix is what we have, that's what the
 * model gets, and the prompt nudges the model to *say* when evidence
 * is thin instead of inventing details.
 */
export function buildSingleAdvisoryChatPayload(input: {
  advisory: Advisory;
  projectName: string;
  runtime: string | null;
}): AdvisoryChatPayload {
  const { advisory, projectName, runtime } = input;

  const systemBase =
    'You are a senior application-security engineer helping a working developer ' +
    'evaluate a single CVE / advisory. Answer in GitHub-flavoured Markdown using ' +
    'EXACTLY this five-section structure (no extra headings, no preamble):\n\n' +
    '### TL;DR\n' +
    'One or two sentences naming the vulnerability class (RCE, prototype pollution, ' +
    'SSRF, ReDoS, path traversal, prototype-poisoning DoS, etc.) and the single most ' +
    'important takeaway.\n\n' +
    '### Where it bites\n' +
    'Bullet list of the concrete attack surfaces that exercise this code path in a ' +
    'typical app of the supplied `runtime`. Be specific: "any endpoint that parses ' +
    'user-supplied YAML", "any `fs.readFile` call whose path is built from `req.params`", ' +
    'etc. Skip generic platitudes.\n\n' +
    '### Worst case\n' +
    'One paragraph. What an attacker actually gets if they land the exploit — data ' +
    'exfil scope, code execution context (browser vs server vs build pipeline), blast ' +
    'radius. Use plain English. No CVSS theatre.\n\n' +
    '### Am I likely affected?\n' +
    'A short verdict (Likely / Possibly / Unlikely / Need more info) followed by 1–3 ' +
    'bullets justifying the call from the supplied facts (severity, range, fix version, ' +
    "package role). If it's a dev-only / build-time dep, say so and downgrade the verdict " +
    'accordingly. If evidence is thin (no fix version, range unspecified), say "Need more ' +
    'info" — never guess.\n\n' +
    '### Fix\n' +
    'Numbered steps. Lead with the upgrade command in backticks (npm/yarn/pnpm/pip/cargo ' +
    'matching the `runtime`). Mention if the bump is breaking. If no fix version exists, ' +
    'recommend pinning to a known-good range, removing the dep, or applying a runtime ' +
    'mitigation (input validation, WAF rule, feature flag) — be concrete.\n\n' +
    'Hard rules:\n' +
    "- NEVER invent CVE details, fix versions, or commit hashes that aren't in the " +
    'supplied facts.\n' +
    "- If you don't know the exploit mechanics from the title alone, say so in TL;DR " +
    'rather than fabricating them.\n' +
    '- Total length: under 350 words. Density over volume.\n' +
    '- Use backticks for every package name, version, command, and code identifier.';

  const facts: string[] = [];
  facts.push(`- Package: \`${advisory.package}\``);
  facts.push(`- Severity: ${advisory.severity}`);
  if (advisory.id) facts.push(`- Advisory id: ${advisory.id}`);
  if (advisory.title) facts.push(`- Title: ${advisory.title}`);
  if (advisory.vulnerable_range) {
    facts.push(`- Vulnerable range: \`${advisory.vulnerable_range}\``);
  }
  if (advisory.fix_version) {
    facts.push(`- Fix version: \`${advisory.fix_version}\``);
  } else {
    facts.push('- Fix version: not yet published');
  }
  if (advisory.url) facts.push(`- Reference: ${advisory.url}`);
  if (projectName) facts.push(`- Project: \`${projectName}\``);
  if (runtime) facts.push(`- Runtime: \`${runtime}\``);

  const contextSystemMessage = [
    systemBase,
    '',
    'Here is the single advisory the user wants you to analyse. ' +
      'Cite the package name, version range, and fix version verbatim from this list.',
    '',
    facts.join('\n'),
  ].join('\n');

  // Title format mirrors the conversation history's "Triage · …" so
  // both surfaces sit next to each other in the History drawer with
  // a consistent verb prefix the user can scan for.
  const idTag = advisory.id ?? advisory.package;
  const projectTag = projectName ? ` · ${projectName}` : '';
  const title = `Analyze · ${idTag}${projectTag}`;

  const draftPrompt =
    `Analyse this ${advisory.severity.toLowerCase()} advisory` +
    (advisory.id ? ` (${advisory.id})` : '') +
    ` against \`${advisory.package}\`. ` +
    "Where am I exposed, what's the worst case, am I likely affected, and how do I fix it?";

  return {
    title,
    context: {
      kind: 'advisory_single',
      project_name: projectName,
      runtime,
      advisory_id: advisory.id,
      package: advisory.package,
      severity: advisory.severity,
    },
    draftPrompt,
    contextSystemMessage,
  };
}
