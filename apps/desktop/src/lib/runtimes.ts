import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { CommandEntry } from '@/types';

export interface RuntimeMeta {
  key: string;
  label: string;
  color: string;
  bg: string;
}

// Text shades are split by theme on purpose. The `-400` hues were tuned for
// the dark mode (vivid on charcoal) but on the light ivory surface they
// collapse into a washed-out, near-grayscale blur — NODE / DOCKER / JAVA
// badges become indistinguishable. `-600` shades keep the same family hue
// but carry enough luminance contrast against `bg-*-500/15` on white to
// read as a real color chip. Dark keeps the legendary original.
export const RUNTIMES: RuntimeMeta[] = [
  {
    key: 'node',
    get label() {
      return i18n.t('Node');
    },
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/15',
  },
  {
    key: 'dotnet',
    get label() {
      return i18n.t('.NET');
    },
    color: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-500/15',
  },
  {
    key: 'java',
    get label() {
      return i18n.t('Java');
    },
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/15',
  },
  {
    key: 'go',
    get label() {
      return i18n.t('Go');
    },
    color: 'text-cyan-700 dark:text-cyan-400',
    bg: 'bg-cyan-500/15',
  },
  {
    key: 'rust',
    get label() {
      return i18n.t('Rust');
    },
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/15',
  },
  {
    key: 'python',
    get label() {
      return i18n.t('Python');
    },
    color: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-500/15',
  },
  {
    key: 'ruby',
    get label() {
      return i18n.t('Ruby');
    },
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/15',
  },
  {
    key: 'php',
    get label() {
      return i18n.t('PHP');
    },
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/15',
  },
  {
    key: 'docker',
    get label() {
      return i18n.t('Docker');
    },
    color: 'text-sky-700 dark:text-sky-400',
    bg: 'bg-sky-500/15',
  },
];

const RUNTIME_MAP: Record<string, RuntimeMeta> = RUNTIMES.reduce(
  (acc, r) => {
    acc[r.key] = r;
    return acc;
  },
  {} as Record<string, RuntimeMeta>,
);

const UNKNOWN: RuntimeMeta = {
  key: 'other',
  get label() {
    return i18n.t('Other');
  },
  color: 'text-fg-muted',
  bg: 'bg-surface-muted',
};

export function runtimeMeta(key: string): RuntimeMeta {
  return RUNTIME_MAP[key] ?? UNKNOWN;
}

export function runtimeFromTags(tags: string[]): string | null {
  const prefix = 'runtime:';
  for (const t of tags) {
    if (t.startsWith(prefix)) return t.slice(prefix.length);
  }
  return null;
}

const CMD_PATTERNS: [RegExp, string][] = [
  [/\bdotnet\b/, 'dotnet'],
  [/\bmvn\b|\.\/mvnw|gradle\b|\.\/gradlew/, 'java'],
  [/\bgo (run|build|test)\b/, 'go'],
  [/\bcargo\b/, 'rust'],
  [/\bpython\b|\bpip\b|\bflask\b|\bdjango\b|\buv\b|\bpoetry\b/, 'python'],
  [/\bruby\b|\bbundle\b|\brails\b|\brackup\b/, 'ruby'],
  [/\bphp\b|\bcomposer\b|\bartisan\b/, 'php'],
  [/\bdocker\s+compose\b|\bdocker\s+build\b/, 'docker'],
  [/\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b|\bnpx\b/, 'node'],
];

export function inferRuntimeFromCmds(cmds: CommandEntry[]): string | null {
  for (const [pattern, runtime] of CMD_PATTERNS) {
    for (const c of cmds) {
      if (pattern.test(c.cmd)) return runtime;
    }
  }
  return null;
}
