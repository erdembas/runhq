import { useCallback, useEffect, useState } from 'react';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { ipc } from '@/lib/ipc';
import { useResizableWidth } from '@/lib/useResizableWidth';
import type { DocContent, ProjectDoc } from '@/types';
import { DocBody } from './project-docs/DocBody';
import { DocsEmptyState } from './project-docs/DocsEmptyState';
import { DocsSubNav } from './project-docs/DocsSubNav';
import { sortDocs } from './project-docs/docKindMeta';

interface Props {
  serviceId: string;
  cwd: string;
  onRunCommand: (command: string) => void;
}

export function ProjectDocsTab({ serviceId, cwd, onRunCommand }: Props) {
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navWidth = useResizableWidth({
    storageKey: 'runhq.docs.sidebar.width',
    defaultWidth: 260,
    min: 200,
    max: 420,
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setContent(null);
    setActivePath(null);
    setDocs([]);
    ipc
      .discoverProjectDocs(serviceId)
      .then((list) => {
        if (!alive) return;
        const sorted = sortDocs(list);
        setDocs(sorted);
        if (sorted.length === 0) {
          setLoading(false);
        } else {
          setActivePath(sorted[0]!.relative_path);
        }
      })
      .catch((err) => {
        if (!alive) return;
        console.error('docs: discover failed', err);
        setError(String(err));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serviceId]);

  useEffect(() => {
    if (!activePath) {
      setContent(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setContent(null);
    ipc
      .readProjectDoc(serviceId, activePath)
      .then((doc) => {
        if (!alive) return;
        setContent(doc);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('docs: read failed', err);
        setError(String(err));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, activePath]);

  const refresh = useCallback(() => {
    if (!activePath) return;
    setLoading(true);
    ipc
      .readProjectDoc(serviceId, activePath)
      .then((doc) => {
        setContent(doc);
        setLoading(false);
      })
      .catch((err) => {
        console.error('docs: refresh failed', err);
        setError(String(err));
        setLoading(false);
      });
  }, [serviceId, activePath]);

  if (!loading && !error && docs.length === 0) {
    return <DocsEmptyState cwd={cwd} />;
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {docs.length > 1 && (
        <aside
          className="border-border/60 bg-surface-raised relative flex shrink-0 border-r"
          style={{ width: navWidth.width }}
        >
          <div className="min-w-0 flex-1 overflow-y-auto">
            <DocsSubNav docs={docs} activePath={activePath} onSelect={setActivePath} />
          </div>
          <ResizeHandle
            handleProps={navWidth.handleProps}
            dragging={navWidth.dragging}
            className="absolute top-0 right-[-2px] h-full"
            title="Drag to resize docs sidebar · double-click to reset"
          />
        </aside>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <DocBody
          serviceId={serviceId}
          content={content}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onRunCommand={onRunCommand}
          onSelectDoc={setActivePath}
        />
      </div>
    </div>
  );
}
