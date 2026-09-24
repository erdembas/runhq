import { useAppStore } from '@/store/useAppStore';
import type { SectionColor } from '@/types';

/** Reveal custom sections without changing their contents or other filters. */
export function showSidebarSections(sectionId?: string) {
  const store = useAppStore.getState();
  store.setSidebarGroupBy('none');
  store.setSearch('');
  if (sectionId && store.collapsedSections[sectionId]) store.toggleSectionCollapsed(sectionId);
}

export function createVisibleSection(
  name: string,
  color: SectionColor,
  item?: { kind: 'service' | 'stack'; id: string },
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const store = useAppStore.getState();
  const id = store.addSection(trimmed, color);
  if (item?.kind === 'service') store.assignServiceToSection(item.id, id);
  else if (item?.kind === 'stack') store.assignStackToSection(item.id, id);
  showSidebarSections(id);
  return id;
}
