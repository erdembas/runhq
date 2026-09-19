import type { AgentTool } from '@runhq/cockpit-types';

/** A connection's account is edited as KEY=value lines, the same way its arguments are. */
export const environmentLines = (env: AgentTool['env']) =>
  Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

/**
 * Parse the editor's text into an environment. The first `=` separates the name from the value, so
 * a value may contain `=`. A malformed line is reported rather than dropped: silently discarding it
 * would start the connection against the wrong account.
 */
export function parseEnvironmentLines(text: string): {
  env: Record<string, string>;
  invalid: string | null;
} {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) return { env, invalid: line };
    env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { env, invalid: null };
}
