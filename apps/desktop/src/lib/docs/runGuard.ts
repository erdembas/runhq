/**
 * Decide whether a fenced code block surfaced in the DOCS tab is
 * safe to expose a "Run" affordance on, and surface a short reason
 * when it isn't.
 *
 * Threat model
 * ------------
 * The DOCS tab renders project-shipped Markdown. A malicious or
 * just-thoughtless README could contain commands like
 * `curl ... | bash` or `rm -rf node_modules && rm -rf ~`. We
 * mitigate by:
 *   1. Only enabling Run on shell-flavored fences (`bash`, `sh`,
 *      `shell`, `zsh`, `console`).
 *   2. Forbidding multi-line scripts — each invocation must be a
 *      single command. Multi-line scripts almost always need
 *      review (line-continuations / heredocs / chained `&&`).
 *   3. Requiring the command to start with one of an allow-list of
 *      well-known package managers / runtimes (npm/pnpm/yarn/bun,
 *      cargo, go, python/pip/poetry/uv, make/just, docker,
 *      gradle/mvn, dotnet, ruby/bundle, php/composer, git).
 *   4. Forbidding shell metacharacters that make tokenisation
 *      brittle: pipes (`|`), redirections (`<`, `>`), command
 *      separators (`;`, `&&`, `||`), backticks, command
 *      substitution (`$(`), and process substitution (`<(`).
 *   5. Forbidding outright dangerous tokens: `sudo`, `rm -rf`,
 *      `chmod`, `chown`, `eval`, `:(){`.
 *
 * The bar is intentionally low — when in doubt the user can still
 * COPY and run manually. We only show Run when we're highly
 * confident the command is "an `npm install`-style invocation",
 * not when it's "a chain of side-effects the README author wants
 * me to trust". Better to disable a legitimate run button than to
 * one-click-execute `rm -rf ~`.
 */

const RUNNABLE_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  // GitHub-flavored README convention: ```\n$ npm install\n```
  // is rendered as a `console` block by most highlighters; we
  // accept it but the `$ ` prompt is stripped before validation.
]);

const ALLOWED_PROGRAMS = new Set([
  // JavaScript runtimes / package managers
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'pnpx',
  'bunx',
  // Rust
  'cargo',
  'rustup',
  // Go
  'go',
  // Python
  'python',
  'python3',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'uvx',
  'pipx',
  // Build / task runners
  'make',
  'just',
  'task',
  // Containers
  'docker',
  'compose',
  'docker-compose',
  'podman',
  // JVM
  'gradle',
  'mvn',
  'mvnw',
  'gradlew',
  // .NET
  'dotnet',
  // Ruby
  'ruby',
  'bundle',
  'bundler',
  'rake',
  // PHP
  'php',
  'composer',
  'artisan',
  // Git (read-only sub-commands handled by FORBIDDEN guard below
  // for `git clean -fdx` etc.; commit/push are inherently safe).
  'git',
  // Tooling that shows up commonly in dev READMEs
  'eslint',
  'prettier',
  'tsc',
  'jest',
  'vitest',
  'playwright',
  'cypress',
  'biome',
  'turbo',
  'nx',
]);

const FORBIDDEN_TOKENS: ReadonlyArray<string | RegExp> = [
  'sudo',
  'eval',
  'exec',
  'source',
  '.',
  ':(){',
  // Catch `rm -rf` / `rm -fr` regardless of spacing.
  /\brm\s+-[rRfF]+/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  // `git clean -fdx`-style destructive flags. Specifically allow
  // `git status`, `git pull`, etc. but bail on anything with -fdx.
  /\bgit\s+clean\s+-[a-z]*[fdx]/,
];

const FORBIDDEN_METACHARS = ['|', ';', '&&', '||', '`', '$(', '<(', '>', '<'];

export interface RunGuardResult {
  /** When `true`, the frontend may render an enabled Run button. */
  runnable: boolean;
  /** Normalised command (prompt-stripped, single-line). */
  command: string;
  /**
   * Short human-readable reason why we refused. Surfaced as the
   * disabled-button tooltip; `null` when `runnable === true`.
   */
  reason: string | null;
}

/**
 * Strip a leading shell prompt (`$ `, `> `, `# `) so README blocks
 * authored as `$ npm install` still match the allow-list. We strip
 * one prompt per-line — multi-line scripts are caught downstream by
 * the line-count check.
 */
function stripPrompt(line: string): string {
  const m = line.match(/^\s*[$#>]\s+/);
  return m ? line.slice(m[0].length) : line;
}

/**
 * Inspect a fenced code block and decide whether to render a Run
 * button. The check is intentionally pure — no IPC calls, no DOM,
 * no React — so the caller can `useMemo` the result and the UI
 * stays in sync with the cached markdown content.
 *
 * @param language  The fence info-string (`bash`, `sh`, `shell`,
 *                  `console`, …). Empty / unknown languages are
 *                  conservatively rejected.
 * @param raw       The raw fenced-block text exactly as it appears
 *                  between the back-tick rows.
 */
export function evaluateRunCandidate(
  language: string | null | undefined,
  raw: string,
): RunGuardResult {
  const lang = (language ?? '').trim().toLowerCase();
  if (!RUNNABLE_LANGUAGES.has(lang)) {
    return {
      runnable: false,
      command: raw.trim(),
      reason: lang
        ? `Run is only available on shell blocks (got ${lang}).`
        : 'Run is only available on shell blocks.',
    };
  }

  // Drop comment-only and blank lines so a README that prefixes a
  // single command with `# install deps` still qualifies. Keep the
  // ORIGINAL text in `command` so the user copies what they saw.
  const lines = raw
    .split(/\r?\n/)
    .map(stripPrompt)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    return { runnable: false, command: raw.trim(), reason: 'Empty command.' };
  }
  if (lines.length > 1) {
    return {
      runnable: false,
      command: raw.trim(),
      reason: 'Multi-line scripts must be reviewed and run manually.',
    };
  }

  const command = lines[0]!;

  for (const meta of FORBIDDEN_METACHARS) {
    if (command.includes(meta)) {
      return {
        runnable: false,
        command,
        reason: `Command contains shell metacharacter "${meta}".`,
      };
    }
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (typeof token === 'string') {
      const re = new RegExp(`(^|\\s)${escapeRegExp(token)}(\\s|$)`);
      if (re.test(command)) {
        return {
          runnable: false,
          command,
          reason: `Command contains the forbidden token "${token}".`,
        };
      }
    } else if (token.test(command)) {
      return {
        runnable: false,
        command,
        reason: 'Command matches a destructive-pattern denylist.',
      };
    }
  }

  // The first whitespace-delimited token must be on the allow
  // list. We strip a leading `./` so `./mvnw build` still
  // qualifies (treated as the `mvnw` program). We do NOT strip
  // arbitrary path prefixes — `/usr/local/bin/curl install.sh`
  // would slip past the allow-list otherwise.
  const head = command.split(/\s+/)[0] ?? '';
  const candidate = head.startsWith('./') ? head.slice(2) : head;
  if (!ALLOWED_PROGRAMS.has(candidate)) {
    return {
      runnable: false,
      command,
      reason: `"${candidate}" is not on the run-allow-list. Copy and run manually if you trust it.`,
    };
  }

  return { runnable: true, command, reason: null };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
