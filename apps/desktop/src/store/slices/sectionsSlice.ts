import type { Section, SectionId, ServiceId } from '@/types';
import { nextSectionColor } from '@/lib/sectionColors';
import {
  UNASSIGNED_BUCKET,
  bucketOf,
  dropItemKey,
  genSectionId,
  initialSections,
  itemOrderKey,
  placeItemKey,
  saveSections,
} from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createSectionsSlice: AppStoreSlice = (set, get) => ({
  sections: initialSections.sections,
  serviceSection: initialSections.serviceSection,
  stackSection: initialSections.stackSection,
  collapsedSections: initialSections.collapsedSections,
  sectionItemOrder: initialSections.sectionItemOrder,
  addSection: (name, color) => {
    const id = genSectionId();
    const trimmed = name.trim() || 'New section';
    const s = get();
    const chosen = color ?? nextSectionColor(s.sections.map((x) => x.color));
    const nextSections: Section[] = [...s.sections, { id, name: trimmed, color: chosen }];
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
    return id;
  },
  renameSection: (id, name) => {
    const s = get();
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, name: trimmed } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  recolorSection: (id, color) => {
    const s = get();
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, color } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  deleteSection: (id) => {
    const s = get();
    const nextSections = s.sections.filter((sec) => sec.id !== id);
    // Any item still pointing at this section gets moved to Unassigned.
    const nextServiceSection: Record<ServiceId, SectionId> = {};
    for (const [k, v] of Object.entries(s.serviceSection)) {
      if (v !== id) nextServiceSection[k] = v;
    }
    const nextStackSection: Record<string, SectionId> = {};
    for (const [k, v] of Object.entries(s.stackSection)) {
      if (v !== id) nextStackSection[k] = v;
    }
    const { [id]: _c, ...nextCollapsed } = s.collapsedSections;
    void _c;
    // Migrate the deleted section's ordered items into Unassigned so
    // the user's manual ordering survives a section deletion. Items
    // that already have an explicit slot in Unassigned win — we just
    // append the orphans to the end.
    const orphan = s.sectionItemOrder[id] ?? [];
    const { [id]: _orderOmit, ...restOrder } = s.sectionItemOrder;
    void _orderOmit;
    let nextItemOrder: Record<SectionId, string[]> = restOrder;
    if (orphan.length > 0) {
      const existing = nextItemOrder[UNASSIGNED_BUCKET] ?? [];
      const seen = new Set(existing);
      const merged = [...existing];
      for (const k of orphan) {
        if (!seen.has(k)) {
          merged.push(k);
          seen.add(k);
        }
      }
      nextItemOrder = { ...nextItemOrder, [UNASSIGNED_BUCKET]: merged };
    }
    set({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: nextItemOrder,
    });
    saveSections({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: nextItemOrder,
    });
  },
  reorderSections: (ids) => {
    const s = get();
    const byId = new Map(s.sections.map((sec) => [sec.id, sec]));
    const ordered: Section[] = [];
    for (const id of ids) {
      const sec = byId.get(id);
      if (sec) {
        ordered.push(sec);
        byId.delete(id);
      }
    }
    // Any sections missing from `ids` are appended to preserve them.
    for (const sec of byId.values()) ordered.push(sec);
    set({ sections: ordered });
    saveSections({
      sections: ordered,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  toggleSectionCollapsed: (id) => {
    const s = get();
    const nextCollapsed = {
      ...s.collapsedSections,
      [id]: !s.collapsedSections[id],
    };
    set({ collapsedSections: nextCollapsed });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: nextCollapsed,
      sectionItemOrder: s.sectionItemOrder,
    });
  },
  assignServiceToSection: (serviceId, sectionId) => {
    const s = get();
    const next = { ...s.serviceSection };
    if (sectionId == null) {
      delete next[serviceId];
    } else {
      next[serviceId] = sectionId;
    }
    // Re-slot the item key in the order map: drop from the previous
    // bucket and append to the new one (if not already pinned there).
    // The "drag-to-reorder" path uses `moveSidebarItem` directly with
    // a precise insertion point; this entry point is the legacy
    // "move into section" gesture (overflow menu, section-header
    // drop) that simply parks the item at the end of the bucket.
    const bucket = bucketOf(sectionId);
    const key = itemOrderKey('service', serviceId);
    const cleaned = dropItemKey(s.sectionItemOrder, key);
    const list = cleaned[bucket] ?? [];
    const nextOrder: Record<SectionId, string[]> = {
      ...cleaned,
      [bucket]: list.includes(key) ? list : [...list, key],
    };
    set({ serviceSection: next, sectionItemOrder: nextOrder });
    saveSections({
      sections: s.sections,
      serviceSection: next,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },
  assignStackToSection: (stackId, sectionId) => {
    const s = get();
    const next = { ...s.stackSection };
    if (sectionId == null) {
      delete next[stackId];
    } else {
      next[stackId] = sectionId;
    }
    const bucket = bucketOf(sectionId);
    const key = itemOrderKey('stack', stackId);
    const cleaned = dropItemKey(s.sectionItemOrder, key);
    const list = cleaned[bucket] ?? [];
    const nextOrder: Record<SectionId, string[]> = {
      ...cleaned,
      [bucket]: list.includes(key) ? list : [...list, key],
    };
    set({ stackSection: next, sectionItemOrder: nextOrder });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: next,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },
  moveSidebarItem: (kind, id, targetSectionId, beforeKey) => {
    const s = get();
    const bucket = bucketOf(targetSectionId);
    const key = itemOrderKey(kind, id);
    // Re-place the key at the desired slot. `placeItemKey` handles
    // both the same-bucket reorder ("drop a service two rows up
    // inside its section") and the cross-bucket move ("drag from
    // Unassigned into the Backend section, slot above row N").
    const nextOrder = placeItemKey(s.sectionItemOrder, bucket, key, beforeKey);

    // Sync the section-assignment maps so the row also re-buckets.
    let nextServiceSection = s.serviceSection;
    let nextStackSection = s.stackSection;
    if (kind === 'service') {
      nextServiceSection = { ...s.serviceSection };
      if (targetSectionId == null) delete nextServiceSection[id];
      else nextServiceSection[id] = targetSectionId;
    } else {
      nextStackSection = { ...s.stackSection };
      if (targetSectionId == null) delete nextStackSection[id];
      else nextStackSection[id] = targetSectionId;
    }
    set({
      sectionItemOrder: nextOrder,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
    });
    saveSections({
      sections: s.sections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: s.collapsedSections,
      sectionItemOrder: nextOrder,
    });
  },
});
