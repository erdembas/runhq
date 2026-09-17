import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentItem } from '@runhq/cockpit-types';
import {
  AgentCanvas,
  agentCanvasDownloadName,
  agentCanvasStorageKey,
  buildAgentCanvasDocument,
  extractAgentCanvasArtifacts,
  readAgentCanvasEdit,
  type AgentCanvasArtifact,
} from '@runhq/cockpit-ui';
import { ROOMY_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { ipc } from '@/lib/ipc';
import { installAgentCanvasFramePolicy } from './agentCanvasPreviewPolicy';

const CANVAS_PROMPT =
  'Create an interactive project dashboard as a single, self-contained HTML code block. Include all styles and scripts inline, without external dependencies.';

function loadEdit(key: string, original: string) {
  try {
    return {
      source: readAgentCanvasEdit(localStorage.getItem(key), original) ?? original,
      error: null,
    };
  } catch {
    return {
      source: original,
      error: 'Local storage is unavailable. Edits will last until this canvas is closed.',
    };
  }
}

function CanvasSession({ sessionId, items }: { sessionId: string; items: AgentItem[] }) {
  const artifacts = useMemo(() => extractAgentCanvasArtifacts(items), [items]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts.at(-1);
  return (
    <CanvasEditor
      key={selected ? agentCanvasStorageKey(sessionId, selected.id) : sessionId}
      sessionId={sessionId}
      artifacts={artifacts}
      selected={selected}
      onSelect={setSelectedId}
    />
  );
}

function CanvasEditor({
  sessionId,
  artifacts,
  selected,
  onSelect,
}: {
  sessionId: string;
  artifacts: AgentCanvasArtifact[];
  selected?: AgentCanvasArtifact;
  onSelect: (id: string) => void;
}) {
  const storageKey = agentCanvasStorageKey(sessionId, selected?.id ?? '');
  const original = selected?.source ?? '';
  const saved = useMemo(() => loadEdit(storageKey, original), [storageKey, original]);
  const [edit, setEdit] = useState({ original, source: saved.source });
  const [error, setError] = useState<string | null>(null);
  const [previewEndpoint, setPreviewEndpoint] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const source = edit.original === original ? edit.source : saved.source;
  const kind = selected?.kind;
  const previewDocument = useMemo(
    () => (kind && kind !== 'markdown' ? buildAgentCanvasDocument(kind, source) : ''),
    [kind, source],
  );
  const nativePreview = isTauri();
  useEffect(() => {
    if (!nativePreview || !kind || kind === 'markdown') return;
    let active = true;
    void ipc
      .agentCanvasUrl()
      .then((url) => {
        installAgentCanvasFramePolicy(document, url);
        if (active) setPreviewEndpoint(url);
      })
      .catch(() => {
        if (active)
          setPreviewError(
            'Could not start the local preview. Source editing and file export are still available.',
          );
      });
    return () => {
      active = false;
    };
  }, [nativePreview, kind]);
  const preview = useMemo(() => {
    if (!nativePreview || !kind || kind === 'markdown') return {};
    if (previewError) return { status: previewError };
    if (!previewEndpoint) return { status: 'Starting the local preview…' };
    try {
      const encoded = encodeURIComponent(previewDocument);
      if (previewDocument.length > 500000 || encoded.length > 1500000) {
        return {
          status:
            'This artifact is too large for live preview. Edit its source or save it as a file.',
        };
      }
      return { url: `${previewEndpoint}#${encoded}` };
    } catch {
      return { status: 'The source contains invalid text. Edit its source before previewing.' };
    }
  }, [nativePreview, kind, previewError, previewEndpoint, previewDocument]);
  const updateSource = (next: string) => {
    setEdit({ original, source: next });
    setError(null);
    try {
      if (next === original) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify({ original, source: next }));
    } catch {
      setError('This edit could not be saved locally. Keep this canvas open or save it as a file.');
    }
  };
  const download = async () => {
    if (!selected || saving) return;
    setSaving(true);
    let url: string | undefined;
    try {
      if (nativePreview) {
        await ipc.agentCanvasSave(agentCanvasDownloadName(selected), source);
        setError(null);
        return;
      }
      const mime = { html: 'text/html', svg: 'image/svg+xml', markdown: 'text/markdown' }[
        selected.kind
      ];
      url = URL.createObjectURL(new window.Blob([source], { type: `${mime};charset=utf-8` }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = agentCanvasDownloadName(selected);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      const downloadUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setError(null);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setError('The file could not be downloaded. You can copy its contents from Source.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <AgentCanvas
      artifacts={artifacts}
      selectedId={selected?.id ?? null}
      onSelect={onSelect}
      source={source}
      onSourceChange={updateSource}
      previewDocument={previewDocument}
      previewUrl={preview.url}
      previewStatus={preview.status}
      modified={source !== original}
      onReset={() => updateSource(original)}
      onDownload={download}
      saving={saving}
      error={error ?? saved.error}
      promptCopied={promptCopied}
      onCopyPrompt={() => {
        void navigator.clipboard
          .writeText(CANVAS_PROMPT)
          .then(() => {
            setPromptCopied(true);
            setError(null);
          })
          .catch(() => setError('Could not copy the prompt. Select and copy the example above.'));
      }}
      markdownPreview={
        selected?.kind === 'markdown' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              ...ROOMY_MARKDOWN_COMPONENTS,
              // Keep generated Markdown inside the canvas; remote images must not fetch from the host.
              img: ({ alt }) => (
                <span className="border-border text-fg-dim my-3 block rounded-lg border border-dashed p-4 text-[12px]">
                  {alt || 'Image'} · Image resource omitted
                </span>
              ),
              a: ({ children, href }) => (
                <span className="text-accent underline decoration-dotted" title={href}>
                  {children}
                </span>
              ),
            }}
          >
            {source}
          </ReactMarkdown>
        ) : undefined
      }
    />
  );
}

export function AgentCanvasPanel({ sessionId, items }: { sessionId: string; items: AgentItem[] }) {
  return <CanvasSession key={sessionId} sessionId={sessionId} items={items} />;
}
