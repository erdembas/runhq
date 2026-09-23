import * as i18n from '@runhq/cockpit-ui/i18n';
/**
 * Section palette.
 *
 * Sections are purely organisational — they do not encode status or runtime —
 * so their colors are drawn from a neutral, theme-agnostic palette instead of
 * the semantic tokens (accent, status-*, cat-*). Eight hues cover typical
 * workspaces without hitting decision fatigue.
 *
 * Values are hex strings and applied via inline `style` to sidestep Tailwind
 * JIT safelisting, which would otherwise need a literal class for every
 * palette member.
 */
import type { SectionColor } from '@/types';

export interface SectionColorMeta {
  key: SectionColor;
  label: string;
  /** Solid dot / header accent. Tuned to read on both light and dark chrome. */
  solid: string;
  /** Soft tint used behind the section header when collapsed/hovered. */
  soft: string;
}

export const SECTION_COLORS: SectionColorMeta[] = [
  {
    key: 'blue',
    get label() {
      return i18n.t('Blue');
    },
    solid: '#3b82f6',
    soft: 'rgba(59,130,246,0.12)',
  },
  {
    key: 'green',
    get label() {
      return i18n.t('Green');
    },
    solid: '#10b981',
    soft: 'rgba(16,185,129,0.12)',
  },
  {
    key: 'orange',
    get label() {
      return i18n.t('Orange');
    },
    solid: '#f97316',
    soft: 'rgba(249,115,22,0.12)',
  },
  {
    key: 'purple',
    get label() {
      return i18n.t('Purple');
    },
    solid: '#a855f7',
    soft: 'rgba(168,85,247,0.12)',
  },
  {
    key: 'pink',
    get label() {
      return i18n.t('Pink');
    },
    solid: '#ec4899',
    soft: 'rgba(236,72,153,0.12)',
  },
  {
    key: 'cyan',
    get label() {
      return i18n.t('Cyan');
    },
    solid: '#06b6d4',
    soft: 'rgba(6,182,212,0.12)',
  },
  {
    key: 'yellow',
    get label() {
      return i18n.t('Yellow');
    },
    solid: '#eab308',
    soft: 'rgba(234,179,8,0.12)',
  },
  {
    key: 'slate',
    get label() {
      return i18n.t('Slate');
    },
    solid: '#64748b',
    soft: 'rgba(100,116,139,0.14)',
  },
];

const BY_KEY: Record<SectionColor, SectionColorMeta> = SECTION_COLORS.reduce(
  (acc, c) => {
    acc[c.key] = c;
    return acc;
  },
  {} as Record<SectionColor, SectionColorMeta>,
);

export function sectionColor(key: SectionColor): SectionColorMeta {
  return BY_KEY[key] ?? BY_KEY.slate;
}

/** Picks the next palette entry that isn't already in use, falling back to
 *  round-robin once every color is taken. Keeps freshly-created sections
 *  visually distinct by default without forcing the user through a picker. */
export function nextSectionColor(used: SectionColor[]): SectionColor {
  for (const c of SECTION_COLORS) {
    if (!used.includes(c.key)) return c.key;
  }
  const idx = used.length % SECTION_COLORS.length;
  return SECTION_COLORS[idx]!.key;
}
