import { useRef, useState } from 'react';
import { FileText, Paperclip, Plus, X } from 'lucide-react';
import {
  agentSupportsImages,
  validateAgentAttachments,
  MAX_AGENT_IMAGE_BYTES,
  AGENT_IMAGE_MIME_TYPES,
  SearchableSelect,
} from '@runhq/cockpit-ui';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentStore } from '@/store/useAgentStore';
import { agentWorkspaceIpc } from '@/lib/ipc/agentWorkspaceIpc';
import { ipc } from '@/lib/ipc';
import { useAgentContext } from './useAgentContext';
import { agentContextImages, type AgentContextEntry, type AgentMemory } from './agentLibraryModel';

export function AgentContextTray({
  draftKey,
  projectId,
  sessionId,
  adapter = '',
  disabled,
}: {
  draftKey: string;
  projectId: string;
  sessionId?: string;
  adapter?: string;
  disabled?: boolean;
}) {
  const context = useAgentContext(draftKey, projectId);
  const records = useAgentLibraryStore((s) => s.records);
  const projects = useAgentStore((s) => s.projects);
  const [sourceProject, setSourceProject] = useState(projectId);
  const sourceProjectId = projects.some((project) => project.id === sourceProject)
    ? sourceProject
    : projectId;
  const storageError = useAgentLibraryStore((s) => s.error);
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imagesSupported = agentSupportsImages(adapter);
  const memories = Object.values(records)
    .filter((r) => r.key.startsWith('memory:'))
    .map((r) => r.value as AgentMemory)
    .filter((m) => m.projectId === sourceProjectId);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const add = async (entry: AgentContextEntry) => {
    if (new TextEncoder().encode(entry.content).length > 192 * 1024)
      throw new Error('Context exceeds 192 KiB. Select a smaller excerpt.');
    if (context.entries.length >= 12) throw new Error('Attach at most 12 context items.');
    const attachmentError = validateAgentAttachments(
      agentContextImages([...context.entries, entry]),
    );
    if (attachmentError) throw new Error(attachmentError);
    if (
      new TextEncoder().encode(JSON.stringify([...context.entries, entry])).length >
      4 * 1024 * 1024
    )
      throw new Error(
        'Saved context exceeds 4 MiB. Remove an attachment or choose a smaller image.',
      );
    await context.set([...context.entries, entry]);
  };
  return (
    <div className="border-border/60 border-t px-4 py-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="text-fg-muted hover:text-fg flex items-center gap-1.5 rounded py-1 disabled:opacity-40"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Context{context.entries.length > 0 && ` · ${context.entries.length}`}
        </button>
        {context.entries.map((entry) => (
          <span
            key={entry.id}
            className="bg-fg/5 text-fg-muted flex max-w-52 items-center gap-1 rounded-md px-2 py-1"
            title={`${entry.source}\nCaptured ${new Date(entry.capturedAt).toLocaleString()}`}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{entry.name}</span>
            <button
              type="button"
              disabled={disabled || busy}
              aria-label={`Remove ${entry.name}`}
              onClick={() =>
                void action(() => context.set(context.entries.filter((e) => e.id !== entry.id)))
              }
              className="hover:text-status-error"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {(error || storageError) && (
        <p role="alert" className="text-status-error py-2">
          {error || storageError}
          <button
            className="ml-2 underline"
            onClick={() => void useAgentLibraryStore.getState().refresh()}
          >
            Reload context
          </button>
        </p>
      )}
      {!imagesSupported && agentContextImages(context.entries).length > 0 && (
        <p role="alert" className="text-status-error py-2">
          This agent connection does not support image attachments. Choose Codex or Claude, or
          remove the image.
        </p>
      )}
      {expanded && (
        <fieldset
          disabled={disabled || busy || !context.ready}
          className="mt-2 space-y-3 disabled:opacity-50"
        >
          <p className="text-fg-dim">
            Snapshots stay with this draft. Inspect the captured content before sending.
          </p>
          <label className="text-fg-muted flex flex-wrap items-center gap-2">
            Source project
            <SearchableSelect
              label="Context source project"
              compact
              value={sourceProjectId}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
                description: project.id === projectId ? 'This task' : project.path,
              }))}
              onChange={setSourceProject}
              searchPlaceholder="Find a project…"
              className="max-w-full min-w-0"
            />
          </label>
          {sourceProjectId !== projectId && (
            <p className="text-accent">
              Cross-project reference: files and decisions below come from the selected project.
              This task keeps its own workspace.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="border-border hover:bg-fg/5 rounded-md border px-2 py-1.5"
              onClick={() => fileInput.current?.click()}
            >
              Attach text file
            </button>
            <button
              type="button"
              disabled={!imagesSupported}
              title={
                imagesSupported
                  ? 'Selected model must support image input'
                  : 'Native image input is available for Codex and Claude'
              }
              className="border-border hover:bg-fg/5 rounded-md border px-2 py-1.5 disabled:opacity-40"
              onClick={() => imageInput.current?.click()}
            >
              Attach image
            </button>
            <input
              ref={imageInput}
              type="file"
              accept={AGENT_IMAGE_MIME_TYPES.join(',')}
              className="hidden"
              aria-label="Attach image context"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void action(async () => {
                  if (file.size > MAX_AGENT_IMAGE_BYTES)
                    throw new Error('Image exceeds 2.25 MiB. Choose a smaller image.');
                  const data = await new Promise<string>((resolve, reject) => {
                    const reader = new globalThis.FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                    reader.onerror = () => reject(new Error('Image could not be read'));
                    reader.readAsDataURL(file);
                  });
                  await add({
                    ...context.make(
                      file.name,
                      `Image supplied as native ${file.type} input`,
                      `Selected image: ${file.name}`,
                    ),
                    attachment: { name: file.name, mime_type: file.type as 'image/png', data },
                  });
                });
              }}
            />
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label="Attach text context"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void action(async () => {
                  if (file.size > 192 * 1024)
                    throw new Error('File exceeds 192 KiB. Paste a selected excerpt instead.');
                  if (file.type.startsWith('image/'))
                    throw new Error('Use image attachments for screenshots.');
                  const content = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(
                    await file.arrayBuffer(),
                  );
                  if (content.includes('\0')) throw new Error('Choose a UTF-8 text file.');
                  await add(context.make(file.name, content, `Selected file: ${file.name}`));
                });
              }}
            />
            {sessionId && (
              <button
                type="button"
                className="border-border hover:bg-fg/5 rounded-md border px-2 py-1.5"
                onClick={() =>
                  void action(async () =>
                    add(
                      context.make(
                        'Working changes',
                        await ipc.agentWorkspaceDiff(sessionId),
                        `Task ${sessionId} · working diff`,
                      ),
                    ),
                  )
                }
              >
                Attach current diff
              </button>
            )}
            {memories.length > 0 && (
              <SearchableSelect
                label="Attach a project decision"
                compact
                placeholder="Add a saved decision…"
                value=""
                options={memories.map((m) => ({ value: m.id, label: m.title }))}
                onChange={(value) => {
                  const memory = memories.find((m) => m.id === value);
                  if (memory)
                    void action(() =>
                      add({
                        ...context.make(
                          memory.title,
                          memory.content,
                          `Project memory · ${memory.sourceSessionId || memory.id}`,
                        ),
                        projectId: memory.projectId,
                      }),
                    );
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Workspace file path"
              placeholder="Workspace path, e.g. src/App.tsx"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="bg-surface border-border text-fg min-w-0 flex-1 rounded-md border px-2 py-1.5"
            />
            <button
              type="button"
              disabled={!path.trim()}
              className="text-fg-muted hover:text-fg"
              onClick={() =>
                void action(async () => {
                  const file = await agentWorkspaceIpc.contextFile(
                    sourceProjectId,
                    sourceProjectId === projectId ? sessionId : undefined,
                    path,
                  );
                  await add({
                    ...context.make(file.name, file.content, file.path),
                    projectId: file.project_id,
                    capturedAt: file.captured_at,
                  });
                  setPath('');
                })
              }
            >
              <Plus className="h-4 w-4" />
              <span className="sr-only">Attach workspace file</span>
            </button>
          </div>
          <div className="space-y-2">
            <input
              aria-label="Excerpt title"
              placeholder="Log excerpt or note title"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="bg-surface border-border text-fg w-full rounded-md border px-2 py-1.5"
            />
            <textarea
              aria-label="Context excerpt"
              rows={3}
              value={excerpt}
              maxLength={150000}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Paste selected logs, a note, or reference text…"
              className="bg-surface border-border text-fg w-full rounded-md border px-2 py-1.5"
            />
            <button
              type="button"
              disabled={!excerpt.trim()}
              className="text-accent disabled:opacity-40"
              onClick={() =>
                void action(async () => {
                  await add(
                    context.make(label.trim() || 'Selected excerpt', excerpt, 'Pasted excerpt'),
                  );
                  setExcerpt('');
                  setLabel('');
                })
              }
            >
              Add excerpt
            </button>
          </div>
          {context.entries.map((entry) => (
            <details key={entry.id} className="text-fg-muted rounded-md">
              <summary className="cursor-pointer py-1">Inspect {entry.name}</summary>
              <p className="text-fg-dim break-all">
                {projects.find((project) => project.id === entry.projectId)?.name ||
                  entry.projectId}{' '}
                · {entry.source} · {new Date(entry.capturedAt).toLocaleString()} ·{' '}
                {Math.ceil(
                  (entry.attachment
                    ? entry.attachment.data.length * 0.75
                    : new TextEncoder().encode(entry.content).length) / 1024,
                )}{' '}
                KiB snapshot
              </p>
              {entry.attachment ? (
                <img
                  src={`data:${entry.attachment.mime_type};base64,${entry.attachment.data}`}
                  alt={entry.name}
                  className="mt-2 max-h-64 max-w-full rounded-md object-contain"
                />
              ) : (
                <pre className="bg-fg/3 mt-2 max-h-48 overflow-auto rounded-md p-3 whitespace-pre-wrap">
                  {entry.content}
                </pre>
              )}
            </details>
          ))}
        </fieldset>
      )}
    </div>
  );
}
