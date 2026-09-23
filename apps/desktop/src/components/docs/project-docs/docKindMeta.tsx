import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { BookOpen, FileText, History, Layers, Scale, ScrollText, Users } from 'lucide-react';
import type { DocKind, ProjectDoc } from '@/types';

export const KIND_META: Record<DocKind, { icon: React.ReactNode; label: string; order: number }> = {
  readme: {
    icon: <BookOpen className="h-3 w-3" />,
    get label() {
      return i18n.t('README');
    },
    order: 0,
  },
  changelog: {
    icon: <History className="h-3 w-3" />,
    get label() {
      return i18n.t('Changelog');
    },
    order: 1,
  },
  contributing: {
    icon: <Users className="h-3 w-3" />,
    get label() {
      return i18n.t('Contributing');
    },
    order: 2,
  },
  architecture: {
    icon: <Layers className="h-3 w-3" />,
    get label() {
      return i18n.t('Architecture');
    },
    order: 3,
  },
  doc: {
    icon: <FileText className="h-3 w-3" />,
    get label() {
      return i18n.t('Doc');
    },
    order: 4,
  },
  other: {
    icon: <ScrollText className="h-3 w-3" />,
    get label() {
      return i18n.t('Doc');
    },
    order: 5,
  },
  license: {
    icon: <Scale className="h-3 w-3" />,
    get label() {
      return i18n.t('License');
    },
    order: 6,
  },
};

export function sortDocs(docs: ProjectDoc[]): ProjectDoc[] {
  return [...docs].sort((a, b) => {
    const oa = KIND_META[a.kind].order;
    const ob = KIND_META[b.kind].order;
    if (oa !== ob) return oa - ob;
    return a.relative_path.localeCompare(b.relative_path);
  });
}
