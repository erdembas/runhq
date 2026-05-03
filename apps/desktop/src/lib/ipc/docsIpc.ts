import { invoke } from '@tauri-apps/api/core';
import type { DocContent, ProjectDoc } from '@/types';

export const docsIpc = {
  discoverProjectDocs: (serviceId: string) =>
    invoke<ProjectDoc[]>('discover_project_docs', { serviceId }),
  readProjectDoc: (serviceId: string, relativePath: string) =>
    invoke<DocContent>('read_project_doc', { serviceId, relativePath }),
  resolveDocImage: (serviceId: string, baseDir: string, src: string) =>
    invoke<string>('resolve_doc_image', { serviceId, baseDir, src }),
};
