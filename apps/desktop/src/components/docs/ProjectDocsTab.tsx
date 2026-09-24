import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useState } from 'react';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { ipc } from '@/lib/ipc';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
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
  i18n.useLocale();
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const requestedDoc = useWorkbenchStore((state) => state.projectDocRequests[serviceId]);
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
        // A document shortcut can arrive while discovery is still in flight.
        const request = useWorkbenchStore.getState().projectDocRequests[serviceId];
        const path = request?.cwd === cwd ? request.relativePath : sorted[0]?.relative_path;
        if (!path) {
          setLoading(false);
        } else {
          setActivePath(path);
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
  }, [serviceId, cwd]);

  useEffect(() => {
    if (requestedDoc?.cwd === cwd) setActivePath(requestedDoc.relativePath);
  }, [requestedDoc, cwd]);

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
  }, [serviceId, cwd, activePath, readRevision]);

  const refresh = useCallback(() => {
    // Refresh shares the cancellable read effect so a late response cannot replace
    // a subsequently selected document or a different project directory.
    setReadRevision((revision) => revision + 1);
  }, []);

  if (!loading && !error && docs.length === 0 && !activePath) {
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
            title={i18n.t('Drag to resize docs sidebar · double-click to reset')}
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
