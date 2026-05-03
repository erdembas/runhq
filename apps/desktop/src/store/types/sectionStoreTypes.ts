import type { Section, SectionColor, SectionId, ServiceId } from '@/types';

export interface SectionStoreSlice {
  /**
   * Sidebar-only organisational groups. Sections are a pure UI concept —
   * they carry no runtime semantics and are never sent to the backend. A
   * service or stack may belong to at most one section; unassigned items
   * fall through to the "Unassigned" pseudo-section at the bottom.
   */
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
  /**
   * Per-bucket ordered list of sidebar items (services + stacks
   * interleaved) keyed by `service:<id>` or `stack:<id>`. The bucket
   * key is either a {@link SectionId} or the magic `__unassigned__`
   * sentinel.
   *
   * Items absent from the hint fall through to alphabetical order at
   * the end of the bucket — keeps freshly-added services from
   * disappearing when their key hasn't been recorded yet.
   *
   * Persisted in localStorage alongside the rest of the section
   * snapshot so a custom order survives reloads.
   */
  sectionItemOrder: Record<SectionId, string[]>;

  addSection: (name: string, color?: SectionColor) => SectionId;
  renameSection: (id: SectionId, name: string) => void;
  recolorSection: (id: SectionId, color: SectionColor) => void;
  deleteSection: (id: SectionId) => void;
  reorderSections: (ids: SectionId[]) => void;
  toggleSectionCollapsed: (id: SectionId) => void;
  /** Assign a service to a section, or pass `null` to move it to Unassigned. */
  assignServiceToSection: (serviceId: ServiceId, sectionId: SectionId | null) => void;
  assignStackToSection: (stackId: string, sectionId: SectionId | null) => void;
  /**
   * Atomically move a sidebar item (service or stack) into the given
   * bucket and slot it directly before `beforeKey` (or to the end if
   * `beforeKey` is null). Pass `targetSectionId: null` to drop into
   * Unassigned. Used by the in-section drag-to-reorder gesture so
   * "move + reorder" can't race against each other.
   */
  moveSidebarItem: (
    kind: 'service' | 'stack',
    id: string,
    targetSectionId: SectionId | null,
    beforeKey: string | null,
  ) => void;
}
