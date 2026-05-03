import type { Section, SectionId, ServiceId } from '@/types';

const SECTIONS_KEY = 'runhq.sections.v1';

/**
 * Bucket key used by {@link sectionItemOrder} to address the
 * "Unassigned" pseudo-section. Mirrors the constant in
 * `components/sidebar/dnd.ts` — duplicated to keep the store free of
 * sidebar imports.
 */
export const UNASSIGNED_BUCKET: SectionId = '__unassigned__';

export function bucketOf(sectionId: SectionId | null | undefined): SectionId {
  return sectionId ?? UNASSIGNED_BUCKET;
}

export function itemOrderKey(kind: 'service' | 'stack', id: string): string {
  return `${kind}:${id}`;
}

export function genSectionId(): SectionId {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return `sec_${g.crypto.randomUUID()}`;
  }
  return `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strip an item key from every bucket. Returns a new map only if a
 * bucket actually changed so unchanged callers don't flush identity
 * unnecessarily.
 */
export function dropItemKey(
  order: Record<SectionId, string[]>,
  key: string,
): Record<SectionId, string[]> {
  let changed = false;
  const next: Record<SectionId, string[]> = {};
  for (const [bucket, list] of Object.entries(order)) {
    const filtered = list.filter((k) => k !== key);
    if (filtered.length !== list.length) changed = true;
    next[bucket] = filtered;
  }
  return changed ? next : order;
}

/**
 * Insert `key` into `bucket` directly before `beforeKey` (or at the
 * end when `beforeKey` is null/missing). Always strips the key from
 * every bucket first so a single call covers both "reorder within
 * bucket" and "move across buckets".
 */
export function placeItemKey(
  order: Record<SectionId, string[]>,
  bucket: SectionId,
  key: string,
  beforeKey: string | null,
): Record<SectionId, string[]> {
  const cleaned = dropItemKey(order, key);
  const list = cleaned[bucket] ? [...cleaned[bucket]] : [];
  if (beforeKey == null) {
    list.push(key);
  } else {
    const idx = list.indexOf(beforeKey);
    if (idx < 0) list.push(key);
    else list.splice(idx, 0, key);
  }
  return { ...cleaned, [bucket]: list };
}

interface SectionsSnapshot {
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
  sectionItemOrder: Record<SectionId, string[]>;
}

function emptySections(): SectionsSnapshot {
  return {
    sections: [],
    serviceSection: {},
    stackSection: {},
    collapsedSections: {},
    sectionItemOrder: {},
  };
}

function loadSections(): SectionsSnapshot {
  if (typeof window === 'undefined') return emptySections();
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    if (!raw) return emptySections();
    const parsed = JSON.parse(raw) as Partial<SectionsSnapshot>;
    // Defensive: strip malformed entries rather than crashing the sidebar on
    // a corrupted prefs file.
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s): s is Section =>
            !!s &&
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            typeof s.color === 'string',
        )
      : [];
    return {
      sections,
      serviceSection:
        parsed.serviceSection && typeof parsed.serviceSection === 'object'
          ? (parsed.serviceSection as Record<ServiceId, SectionId>)
          : {},
      stackSection:
        parsed.stackSection && typeof parsed.stackSection === 'object'
          ? (parsed.stackSection as Record<string, SectionId>)
          : {},
      collapsedSections:
        parsed.collapsedSections && typeof parsed.collapsedSections === 'object'
          ? (parsed.collapsedSections as Record<SectionId, boolean>)
          : {},
      sectionItemOrder: (() => {
        const raw = parsed.sectionItemOrder;
        if (!raw || typeof raw !== 'object') return {};
        const out: Record<SectionId, string[]> = {};
        for (const [bucket, list] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(list)) {
            out[bucket] = list.filter((k): k is string => typeof k === 'string');
          }
        }
        return out;
      })(),
    };
  } catch {
    return emptySections();
  }
}

export function saveSections(snapshot: SectionsSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(snapshot));
  } catch {
    // Same non-fatal policy as sidebar prefs.
  }
}

export const initialSections = loadSections();
