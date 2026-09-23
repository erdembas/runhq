'use client';

import * as i18n from '../i18n';
import { cn } from '../lib/cn';

export type RuntimeBadgeKey =
  | 'node'
  | 'bun'
  | 'deno'
  | 'go'
  | 'rust'
  | 'dotnet'
  | 'python'
  | 'java'
  | 'ruby'
  | 'php'
  | 'docker';

interface Props {
  runtime: RuntimeBadgeKey;
  className?: string;
}

/**
 * Tiny uppercase runtime chip used inside the sidebar service rows
 * (e.g. `GO`, `DOCKER`, `NODE`, `PYTHON`). Mirrors the desktop's
 * runtime registry colors but inlined here so cockpit-ui stays
 * self-contained.
 */
const META: Record<RuntimeBadgeKey, { label: string; tone: string }> = {
  node: {
    get label() {
      return i18n.t('NODE');
    },
    tone: 'text-status-running',
  },
  bun: {
    get label() {
      return i18n.t('BUN');
    },
    tone: 'text-cat-frontend',
  },
  deno: {
    get label() {
      return i18n.t('DENO');
    },
    tone: 'text-cat-frontend',
  },
  go: {
    get label() {
      return i18n.t('GO');
    },
    tone: 'text-cat-database',
  },
  rust: {
    get label() {
      return i18n.t('RUST');
    },
    tone: 'text-status-error',
  },
  dotnet: {
    get label() {
      return i18n.t('.NET');
    },
    tone: 'text-cat-backend',
  },
  python: {
    get label() {
      return i18n.t('PYTHON');
    },
    tone: 'text-status-starting',
  },
  java: {
    get label() {
      return i18n.t('JAVA');
    },
    tone: 'text-status-error',
  },
  ruby: {
    get label() {
      return i18n.t('RUBY');
    },
    tone: 'text-status-error',
  },
  php: {
    get label() {
      return i18n.t('PHP');
    },
    tone: 'text-cat-backend',
  },
  docker: {
    get label() {
      return i18n.t('DOCKER');
    },
    tone: 'text-cat-frontend',
  },
};

export function RuntimeBadge({ runtime, className }: Props) {
  i18n.useLocale();
  const meta = META[runtime];
  return (
    <span
      className={cn(
        'font-mono text-[9.5px] font-semibold tracking-[0.06em] uppercase',
        meta.tone,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
