import { BookOpen, FileText, History, Layers, Scale, ScrollText, Users } from 'lucide-react';
import type { DocKind, ProjectDoc } from '@/types';

export const KIND_META: Record<DocKind, { icon: React.ReactNode; label: string; order: number }> = {
  readme: { icon: <BookOpen className="h-3 w-3" />, label: 'README', order: 0 },
  changelog: { icon: <History className="h-3 w-3" />, label: 'Changelog', order: 1 },
  contributing: { icon: <Users className="h-3 w-3" />, label: 'Contributing', order: 2 },
  architecture: { icon: <Layers className="h-3 w-3" />, label: 'Architecture', order: 3 },
  doc: { icon: <FileText className="h-3 w-3" />, label: 'Doc', order: 4 },
  other: { icon: <ScrollText className="h-3 w-3" />, label: 'Doc', order: 5 },
  license: { icon: <Scale className="h-3 w-3" />, label: 'License', order: 6 },
};

export function sortDocs(docs: ProjectDoc[]): ProjectDoc[] {
  return [...docs].sort((a, b) => {
    const oa = KIND_META[a.kind].order;
    const ob = KIND_META[b.kind].order;
    if (oa !== ob) return oa - ob;
    return a.relative_path.localeCompare(b.relative_path);
  });
}
