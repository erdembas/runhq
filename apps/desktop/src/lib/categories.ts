import * as i18n from '@runhq/cockpit-ui/i18n';
/**
 * Service categories.
 *
 * The backend stores an arbitrary `tags: string[]` on every service. In the
 * UI we interpret `tags[0]` as the primary category and map it to a color.
 * Users can still type any value — unknown tags fall through to "other".
 */
export type CategoryKey =
  'frontend' | 'backend' | 'database' | 'infra' | 'worker' | 'tooling' | 'other';

export interface Category {
  key: CategoryKey;
  label: string;
  /** Tailwind text-cat-* class. */
  color: string;
  /** Tailwind bg tint (e.g. "bg-cat-frontend/10"). */
  bg: string;
  /** Solid Tailwind bg class, used for small dot indicators. */
  dot: string;
  /** Tailwind ring color (e.g. "ring-cat-frontend/20"). */
  ring: string;
  description: string;
}

// All class strings are listed as literals so Tailwind's JIT picks them up.
export const CATEGORIES: Category[] = [
  {
    key: 'frontend',
    get label() {
      return i18n.t('Frontend');
    },
    color: 'text-cat-frontend',
    bg: 'bg-cat-frontend/10',
    dot: 'bg-cat-frontend',
    ring: 'ring-cat-frontend/20',
    get description() {
      return i18n.t('Web UIs, SPAs, static sites.');
    },
  },
  {
    key: 'backend',
    get label() {
      return i18n.t('Backend');
    },
    color: 'text-cat-backend',
    bg: 'bg-cat-backend/10',
    dot: 'bg-cat-backend',
    ring: 'ring-cat-backend/20',
    get description() {
      return i18n.t('APIs, servers, RPC endpoints.');
    },
  },
  {
    key: 'database',
    get label() {
      return i18n.t('Database');
    },
    color: 'text-cat-database',
    bg: 'bg-cat-database/10',
    dot: 'bg-cat-database',
    ring: 'ring-cat-database/20',
    get description() {
      return i18n.t('Local databases and data stores.');
    },
  },
  {
    key: 'infra',
    get label() {
      return i18n.t('Infra');
    },
    color: 'text-cat-infra',
    bg: 'bg-cat-infra/10',
    dot: 'bg-cat-infra',
    ring: 'ring-cat-infra/20',
    get description() {
      return i18n.t('Infrastructure, containers, gateways.');
    },
  },
  {
    key: 'worker',
    get label() {
      return i18n.t('Worker');
    },
    color: 'text-cat-worker',
    bg: 'bg-cat-worker/10',
    dot: 'bg-cat-worker',
    ring: 'ring-cat-worker/20',
    get description() {
      return i18n.t('Background jobs, queues, cron.');
    },
  },
  {
    key: 'tooling',
    get label() {
      return i18n.t('Tooling');
    },
    color: 'text-cat-tooling',
    bg: 'bg-cat-tooling/10',
    dot: 'bg-cat-tooling',
    ring: 'ring-cat-tooling/20',
    get description() {
      return i18n.t('Watchers, codegen, dev scripts.');
    },
  },
  {
    key: 'other',
    get label() {
      return i18n.t('Other');
    },
    color: 'text-cat-other',
    bg: 'bg-cat-other/10',
    dot: 'bg-cat-other',
    ring: 'ring-cat-other/20',
    get description() {
      return i18n.t('Everything else.');
    },
  },
];

const CATEGORY_BY_KEY: Record<CategoryKey, Category> = CATEGORIES.reduce(
  (acc, c) => {
    i18n.useLocale();
    acc[c.key] = c;
    return acc;
  },
  {} as Record<CategoryKey, Category>,
);

export function categoryForTags(tags: string[]): Category {
  const raw = (tags[0] ?? '').trim().toLowerCase();
  const match = CATEGORIES.find((c) => c.key === raw);
  return match ?? CATEGORY_BY_KEY.other;
}

export function isKnownCategory(key: string): key is CategoryKey {
  return CATEGORIES.some((c) => c.key === key);
}
