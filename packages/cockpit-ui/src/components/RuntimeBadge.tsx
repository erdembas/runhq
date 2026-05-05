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
  node: { label: 'NODE', tone: 'text-status-running' },
  bun: { label: 'BUN', tone: 'text-cat-frontend' },
  deno: { label: 'DENO', tone: 'text-cat-frontend' },
  go: { label: 'GO', tone: 'text-cat-database' },
  rust: { label: 'RUST', tone: 'text-status-error' },
  dotnet: { label: '.NET', tone: 'text-cat-backend' },
  python: { label: 'PYTHON', tone: 'text-status-starting' },
  java: { label: 'JAVA', tone: 'text-status-error' },
  ruby: { label: 'RUBY', tone: 'text-status-error' },
  php: { label: 'PHP', tone: 'text-cat-backend' },
  docker: { label: 'DOCKER', tone: 'text-cat-frontend' },
};

export function RuntimeBadge({ runtime, className }: Props) {
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
