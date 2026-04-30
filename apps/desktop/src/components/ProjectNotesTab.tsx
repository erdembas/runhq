import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Eye,
  FileText,
  Heading,
  HelpCircle,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTree,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Quote,
  Save,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor, IKeyboardEvent } from 'monaco-editor';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { DOCS_SANITIZE_SCHEMA } from '@/lib/docs/sanitizeSchema';
import { ROOMY_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { useTheme } from '@/lib/theme';
import type { NoteFile } from '@/types';

interface Props {
  serviceId: string;
  serviceName: string;
}

type ViewMode = 'edit' | 'preview';

const WIDE_PREF_KEY = 'runhq.notes.wideLayout';

/**
 * Project Notes — multi-note in-service tab.
 *
 * Layout mirrors the DOCS tab: a slim sub-nav on the left lists
 * every note for the service, the body on the right hosts the
 * Monaco editor (in edit mode) or the rendered markdown plus a
 * sticky table-of-contents (in preview mode).
 *
 * Storage: notes live in `$RUNHQ_HOME/notes/<service-id>/*.md` —
 * NOT in the project repo. Legacy v0.9 single-file notes
 * (`<service-id>.md`) auto-migrate to `<service-id>/index.md` on
 * first access; users see no behavioural change beyond "now you
 * can have more than one note".
 *
 * Auto-save on switch: clicking a different note in the sub-nav
 * (or unmounting the panel entirely) saves any unsaved buffer
 * first, no confirm dialog. Notes are not commits — every
 * mainstream notes app on the planet (Notion, Apple Notes, Bear)
 * does the same, and the user has the full Monaco undo history if
 * they did something they didn't mean to.
 */
export function ProjectNotesTab({ serviceId, serviceName }: Props) {
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('edit');
  const [wide, setWide] = useState<boolean>(() => readWidePref());
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const { effective: effectiveTheme } = useTheme();
  const monacoTheme = useMonacoTheme(effectiveTheme);

  // ---- Note list discovery ------------------------------------------------
  //
  // Rerun on serviceId change. We deliberately do NOT poll —
  // notes are owned by this surface; nothing else mutates them
  // out of band. A manual reload affordance would be feature-
  // creep until we have evidence users want it.
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setError(null);
    setNotes([]);
    setActiveName(null);
    setContent('');
    setOriginalContent('');
    ipc
      .listNotes(serviceId)
      .then((list) => {
        if (cancelled) return;
        setNotes(list);
        // Auto-select the first (most-recently-edited) note so a
        // re-visit lands the user back on the note they were
        // working on. If the project has no notes yet, leave
        // active = null so the empty state renders.
        setActiveName(list[0]?.name ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't load notes: ${String(e)}`);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  // ---- Body load ----------------------------------------------------------
  //
  // Driven by `activeName`. Resets the buffer synchronously so a
  // fast click sequence (note A → note B) can't briefly flash A's
  // content under B's title. Smart default for `mode` (edit vs
  // preview) is applied per-note — empty notes land on edit, non-
  // empty on preview.
  useEffect(() => {
    if (!activeName) {
      setContent('');
      setOriginalContent('');
      return;
    }
    let cancelled = false;
    setBodyLoading(true);
    setError(null);
    setContent('');
    setOriginalContent('');
    ipc
      .readNote(serviceId, activeName)
      .then((body) => {
        if (cancelled) return;
        setContent(body);
        setOriginalContent(body);
        setMode(body.length > 0 ? 'preview' : 'edit');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't read note: ${String(e)}`);
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId, activeName]);

  const isDirty = content !== originalContent;

  // ---- Save ---------------------------------------------------------------
  //
  // Capture the current handler in a ref so the Monaco command we
  // register on mount always sees the latest dirty/saving state.
  // Without the ref the ⌘S action would close over the first-
  // render handler and write stale content.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const handleSave = useCallback(async (): Promise<void> => {
    if (!activeName) return;
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await ipc.writeNote(serviceId, activeName, content);
      setOriginalContent(content);
      // Refresh just the metadata for this note so the sub-nav
      // shows the updated `updated_at_ms` (and re-sorts the list
      // to keep the just-saved note at the top). We could
      // optimistically patch but the IPC is cheap and avoids
      // drift if anything else mutated the directory in
      // parallel.
      const list = await ipc.listNotes(serviceId);
      setNotes(list);
    } catch (e) {
      setError(`Couldn't save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [serviceId, activeName, content, isDirty, saving]);
  saveRef.current = handleSave;

  // Auto-save when the user switches to a different note OR when
  // the panel unmounts. Captures `serviceId/activeName/content/
  // originalContent` from a ref so the cleanup function always
  // sees the LATEST values — without this, the cleanup would
  // capture the values at mount time and silently lose later
  // edits.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  flushRef.current = useCallback(async () => {
    if (!activeName) return;
    if (content === originalContent) return;
    try {
      await ipc.writeNote(serviceId, activeName, content);
    } catch {
      // Silently ignore: the user is leaving the surface, an
      // error toast at this point would be more confusing than
      // helpful. They can save explicitly via ⌘S before
      // navigating if they care.
    }
  }, [serviceId, activeName, content, originalContent]);
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, [activeName, serviceId]);

  // ---- Create / delete ----------------------------------------------------

  const handleCreate = useCallback(async () => {
    setError(null);
    try {
      // Auto-flush the current dirty buffer before swapping notes
      // so the user doesn't lose half-typed content the moment
      // they hit "+".
      await flushRef.current();
      const newName = await ipc.createNote(serviceId);
      const list = await ipc.listNotes(serviceId);
      setNotes(list);
      setActiveName(newName);
      setMode('edit');
    } catch (e) {
      setError(`Couldn't create note: ${String(e)}`);
    }
  }, [serviceId]);

  const handleDelete = useCallback(
    async (name: string) => {
      setError(null);
      try {
        await ipc.deleteNote(serviceId, name);
        const list = await ipc.listNotes(serviceId);
        setNotes(list);
        // If we just deleted the active note, fall back to the
        // first remaining one so the user keeps reading
        // something instead of staring at an empty body.
        if (name === activeName) {
          setActiveName(list[0]?.name ?? null);
        }
      } catch (e) {
        setError(`Couldn't delete: ${String(e)}`);
      }
    },
    [serviceId, activeName],
  );

  const handleSelect = useCallback(
    async (name: string) => {
      if (name === activeName) return;
      // Save the current note before switching. Notion / Apple
      // Notes / Bear all do this — auto-save on navigation is
      // the established pattern for notes apps and lets the user
      // jump around without thinking about persistence.
      await flushRef.current();
      setActiveName(name);
    },
    [activeName],
  );

  // ---- Wide preference ----------------------------------------------------

  const toggleWide = useCallback(() => {
    setWide((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(WIDE_PREF_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // ---- Editor mount + actions --------------------------------------------

  const onEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    const actions: Array<{
      id: string;
      label: string;
      keys: number[];
      run: () => void;
    }> = [
      {
        id: 'runhq.notes.bold',
        label: 'Markdown: Toggle Bold',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
        run: () => wrapSelection(editor, '**', '**', 'bold text'),
      },
      {
        id: 'runhq.notes.italic',
        label: 'Markdown: Toggle Italic',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: () => wrapSelection(editor, '*', '*', 'italic text'),
      },
      {
        id: 'runhq.notes.code',
        label: 'Markdown: Toggle Inline Code',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
        run: () => wrapSelection(editor, '`', '`', 'code'),
      },
      {
        id: 'runhq.notes.link',
        label: 'Markdown: Insert Link',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: () => insertLink(editor),
      },
      {
        id: 'runhq.notes.quote',
        label: 'Markdown: Toggle Block Quote',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Period],
        run: () => toggleLinePrefix(editor, '> '),
      },
      {
        id: 'runhq.notes.list',
        label: 'Markdown: Toggle Bullet List',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
        run: () => toggleLinePrefix(editor, '- '),
      },
      {
        id: 'runhq.notes.ordered',
        label: 'Markdown: Toggle Ordered List',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Digit7],
        run: () => toggleLinePrefix(editor, '1. '),
      },
      {
        id: 'runhq.notes.heading',
        label: 'Markdown: Toggle Heading',
        keys: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH],
        run: () => toggleHeading(editor),
      },
    ];
    for (const a of actions) {
      editor.addAction({
        id: a.id,
        label: a.label,
        keybindings: a.keys,
        contextMenuGroupId: 'markdown',
        run: a.run,
      });
    }

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });

    editor.onKeyDown((e: IKeyboardEvent) => {
      if (e.keyCode !== monaco.KeyCode.Tab) return;
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model) return;
      const line = model.getLineContent(sel.startLineNumber);
      const isListLine = /^\s*([-*+]|\d+\.)\s/.test(line);
      if (!isListLine) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        editor.trigger('keyboard', 'editor.action.outdentLines', null);
      } else {
        editor.trigger('keyboard', 'editor.action.indentLines', null);
      }
    });
  }, []);

  const fireAction = useCallback((id: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger('toolbar', id, null);
  }, []);

  const activeNote = useMemo(
    () => (activeName ? (notes.find((n) => n.name === activeName) ?? null) : null),
    [notes, activeName],
  );

  // ---- Render -------------------------------------------------------------

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <NoteSubNav
        notes={notes}
        activeName={activeName}
        loading={listLoading}
        onSelect={(n) => void handleSelect(n)}
        onCreate={() => void handleCreate()}
        onDelete={(n) => void handleDelete(n)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top toolbar */}
        <div className="border-border/60 bg-surface-raised/30 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="text-fg-dim flex min-w-0 items-center gap-2 text-[11px]">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono" title={serviceName}>
              {serviceName}
            </span>
            {activeNote && (
              <>
                <span className="text-fg-muted/60 shrink-0">/</span>
                <span className="text-fg/80 truncate font-medium" title={activeNote.title}>
                  {activeNote.title}
                </span>
              </>
            )}
            <span
              className="border-border/60 bg-surface-raised/60 text-fg-muted inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-sans text-[10px] tracking-wide uppercase"
              title="These notes live in your local RunHQ folder — not in the repo. Nothing here is committed or shared."
            >
              <Lock className="h-2.5 w-2.5" />
              Local
            </span>
            {isDirty && <span className="text-fg-muted shrink-0 italic">· unsaved</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {activeName && (
              <div
                role="tablist"
                aria-label="Notes view mode"
                className="border-border bg-surface inline-flex items-center rounded-md border p-0.5"
              >
                <ModeButton
                  active={mode === 'edit'}
                  icon={<Pencil className="h-3 w-3" />}
                  label="Edit"
                  onClick={() => setMode('edit')}
                />
                <ModeButton
                  active={mode === 'preview'}
                  icon={<Eye className="h-3 w-3" />}
                  label="Preview"
                  onClick={() => setMode('preview')}
                />
              </div>
            )}
            {/* Wide / centred toggle. Only meaningful in preview
                mode (the editor word-wraps anyway), but kept
                visible always so the wide setting can be flipped
                while reading without an extra mode-switch round-
                trip. Pressed-state styling makes the current
                preference unambiguous. */}
            {activeName && mode === 'preview' && (
              <IconButton
                label={wide ? 'Switch to centred layout' : 'Switch to wide layout'}
                icon={
                  wide ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )
                }
                onClick={toggleWide}
                size="sm"
                tone={wide ? 'accent' : 'default'}
              />
            )}
            <IconButton
              label="Markdown shortcuts"
              icon={<HelpCircle className="h-3.5 w-3.5" />}
              onClick={() => setCheatsheetOpen((v) => !v)}
              size="sm"
              tone={cheatsheetOpen ? 'accent' : 'default'}
            />
            {activeName && originalContent.length > 0 && (
              <IconButton
                label="Delete note"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => activeName && void handleDelete(activeName)}
                size="sm"
                tone="danger"
              />
            )}
            {activeName && (
              <Button
                variant="primary"
                size="xs"
                leftIcon={<Save className="h-3 w-3" />}
                disabled={!isDirty || saving}
                onClick={() => void handleSave()}
                title="Save (⌘/Ctrl+S)"
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="border-tone-critical/30 bg-tone-critical/5 text-tone-critical-fg shrink-0 border-b px-3 py-1.5 text-[11px]">
            {error}
          </div>
        )}

        {/* Format toolbar — edit mode only */}
        {activeName && mode === 'edit' && (
          <div className="border-border/60 bg-surface flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
            <FormatButton
              icon={<Heading className="h-3.5 w-3.5" />}
              label="Heading (⌘⇧H)"
              onClick={() => fireAction('runhq.notes.heading')}
            />
            <FormatButton
              icon={<Bold className="h-3.5 w-3.5" />}
              label="Bold (⌘B)"
              onClick={() => fireAction('runhq.notes.bold')}
            />
            <FormatButton
              icon={<Italic className="h-3.5 w-3.5" />}
              label="Italic (⌘I)"
              onClick={() => fireAction('runhq.notes.italic')}
            />
            <FormatButton
              icon={<Code className="h-3.5 w-3.5" />}
              label="Inline Code (⌘E)"
              onClick={() => fireAction('runhq.notes.code')}
            />
            <FormatButton
              icon={<LinkIcon className="h-3.5 w-3.5" />}
              label="Link (⌘K)"
              onClick={() => fireAction('runhq.notes.link')}
            />
            <div className="bg-border/60 mx-1 h-3.5 w-px" />
            <FormatButton
              icon={<List className="h-3.5 w-3.5" />}
              label="Bullet list (⌘⇧L)"
              onClick={() => fireAction('runhq.notes.list')}
            />
            <FormatButton
              icon={<ListOrdered className="h-3.5 w-3.5" />}
              label="Numbered list (⌘⇧7)"
              onClick={() => fireAction('runhq.notes.ordered')}
            />
            <FormatButton
              icon={<Quote className="h-3.5 w-3.5" />}
              label="Block quote (⌘⇧.)"
              onClick={() => fireAction('runhq.notes.quote')}
            />
          </div>
        )}

        {/* Body */}
        {!activeName && !listLoading ? (
          <EmptyState onCreate={() => void handleCreate()} serviceName={serviceName} />
        ) : bodyLoading ? (
          <div className="text-fg-dim flex flex-1 items-center justify-center text-[12px]">
            Loading…
          </div>
        ) : mode === 'edit' && activeName ? (
          <div className="relative flex-1 overflow-hidden">
            <Editor
              key={activeName /* re-mount on note swap so undo history doesn't bleed */}
              value={content}
              onChange={(v) => setContent(v ?? '')}
              onMount={onEditorMount}
              language="markdown"
              theme={monacoTheme}
              options={{
                language: 'markdown',
                wordWrap: 'on',
                wrappingIndent: 'same',
                minimap: { enabled: false },
                lineNumbers: 'off',
                folding: false,
                glyphMargin: false,
                lineDecorationsWidth: 12,
                lineNumbersMinChars: 0,
                renderLineHighlight: 'none',
                scrollBeyondLastLine: false,
                padding: { top: 14, bottom: 24 },
                fontSize: 13,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", Consolas, monospace',
                fontLigatures: true,
                tabSize: 2,
                insertSpaces: true,
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                occurrencesHighlight: 'off',
                matchBrackets: 'never',
                renderWhitespace: 'none',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                automaticLayout: true,
                stickyScroll: { enabled: false },
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                  useShadows: false,
                },
              }}
              loading={
                <div className="text-fg-dim flex h-full items-center justify-center text-[12px]">
                  Loading editor…
                </div>
              }
            />
          </div>
        ) : activeName ? (
          <PreviewBody content={content} wide={wide} serviceName={serviceName} />
        ) : null}

        {cheatsheetOpen && <Cheatsheet onClose={() => setCheatsheetOpen(false)} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-nav: list of notes for the current service
// ---------------------------------------------------------------------------

function NoteSubNav({
  notes,
  activeName,
  loading,
  onSelect,
  onCreate,
  onDelete,
}: {
  notes: NoteFile[];
  activeName: string | null;
  loading: boolean;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
}) {
  return (
    <aside className="border-border/60 bg-surface-raised/20 flex w-[200px] shrink-0 flex-col border-r">
      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="text-fg-muted text-[10px] font-semibold tracking-wider uppercase">
          Notes
        </div>
        <button
          type="button"
          onClick={onCreate}
          title="New note (creates an `untitled` markdown file)"
          aria-label="Create new note"
          className="text-fg-dim hover:text-fg hover:bg-fg/5 inline-flex h-5 w-5 items-center justify-center rounded transition"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-fg-dim px-2 py-2 text-[11px]">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="text-fg-muted px-2 py-3 text-[11px] leading-relaxed">
            No notes yet.
            <br />
            Press{' '}
            <kbd className="border-border bg-surface-muted rounded border px-1 font-mono text-[9.5px]">
              +
            </kbd>{' '}
            to create one.
          </div>
        ) : (
          <ul className="flex flex-col gap-px">
            {notes.map((n) => (
              <NoteRow
                key={n.name}
                note={n}
                active={n.name === activeName}
                onSelect={() => onSelect(n.name)}
                onDelete={() => onDelete(n.name)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function NoteRow({
  note,
  active,
  onSelect,
  onDelete,
}: {
  note: NoteFile;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  // Inline two-step delete: first click arms, second confirms.
  // Keeps the feature discoverable (no separate confirm dialog
  // mounted just for this) and doesn't punish the user for an
  // accidental click — the armed state auto-disarms after 2.5s.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 2500);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <li>
      <div
        className={cn(
          'group/note flex items-center gap-1 px-2 py-1',
          active ? 'bg-accent/10' : 'hover:bg-fg/5',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-0.5 text-left transition-colors',
            active ? 'text-fg' : 'text-fg/80',
          )}
        >
          <span className="truncate text-[12px] leading-tight" title={note.title}>
            {note.title}
          </span>
          <span className="text-fg-muted/80 truncate text-[10px] leading-tight">
            {formatRelativeMs(note.updated_at_ms)}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (armed) {
              setArmed(false);
              onDelete();
            } else {
              setArmed(true);
            }
          }}
          title={armed ? 'Click again to confirm' : 'Delete note'}
          aria-label="Delete note"
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
            armed
              ? 'text-tone-critical-fg bg-tone-critical/15'
              : 'text-fg-muted hover:text-tone-critical-fg hover:bg-fg/5 opacity-0 group-hover/note:opacity-100',
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Preview body: rendered markdown + optional sticky TOC
// ---------------------------------------------------------------------------

interface TocHeading {
  id: string;
  level: number;
  text: string;
}

function PreviewBody({
  content,
  wide,
  serviceName,
}: {
  content: string;
  wide: boolean;
  serviceName: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  // Re-derive the ToC after each render. We can't compute it from
  // raw markdown alone (we'd need a parser); reading the rendered
  // DOM after `useLayoutEffect` is cheap, exact, and lets us share
  // IDs with anchor links generated by the same DOM walk.
  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const collected: TocHeading[] = [];
    const used = new Set<string>();
    const elements = root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3');
    elements.forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      let id = slugify(text);
      let suffix = 1;
      while (used.has(id)) {
        id = `${slugify(text)}-${suffix++}`;
      }
      used.add(id);
      el.id = id;
      collected.push({
        id,
        level: parseInt(el.tagName.slice(1), 10),
        text,
      });
    });
    setHeadings(collected);
    setActiveHeading(collected[0]?.id ?? null);
  }, [content]);

  // IntersectionObserver-driven active-heading tracking. Same
  // "top 15% stripe" model the DOCS tab uses — when a heading
  // enters the upper viewport band it becomes active, when the
  // next heading enters it takes over. Cheaper than per-frame
  // bounding-rect walks at 60 Hz.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const headingEls: HTMLElement[] = [];
    for (const h of headings) {
      const el = root.querySelector(`#${cssEscape(h.id)}`);
      if (el instanceof HTMLElement) headingEls.push(el);
    }
    if (headingEls.length === 0) return;

    const intersecting = new Set<string>();
    const idOrder = headings.map((h) => h.id);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        for (const id of idOrder) {
          if (intersecting.has(id)) {
            setActiveHeading((prev) => (prev === id ? prev : id));
            return;
          }
        }
      },
      { root, rootMargin: '0px 0px -85% 0px', threshold: 0 },
    );
    for (const el of headingEls) obs.observe(el);
    return () => obs.disconnect();
  }, [headings]);

  if (content.length === 0) {
    return (
      <div className="text-fg-dim flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[12.5px]">
        <FileText className="text-fg-dim/60 h-6 w-6" />
        <p className="max-w-sm leading-relaxed">
          Empty note. Switch to <span className="font-medium">Edit</span> to start writing.
        </p>
        <p className="text-fg-muted/90 max-w-sm text-[11px] leading-relaxed">
          <Lock className="mr-1 inline-block h-3 w-3 align-[-2px]" />
          Local-only — saved to your RunHQ folder, never to the repo.
        </p>
      </div>
    );
  }

  const showToc = headings.length >= 3;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-5">
        <article
          className={cn(
            'text-fg/95 mx-auto text-[13px] leading-relaxed',
            wide ? 'max-w-none' : 'max-w-3xl',
          )}
          // serviceName threaded through purely as a hover tip
          // for screen-reader users; visible content already
          // names the service in the toolbar.
          aria-label={`${serviceName} — note preview`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, DOCS_SANITIZE_SCHEMA]]}
            components={ROOMY_MARKDOWN_COMPONENTS}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
      {showToc && (
        <aside className="border-border/40 hidden w-[200px] shrink-0 overflow-y-auto border-l py-4 pr-4 pl-3 lg:block">
          <Toc
            headings={headings}
            activeId={activeHeading}
            onSelect={(id) => {
              const target = scrollerRef.current?.querySelector(`#${cssEscape(id)}`);
              if (target instanceof HTMLElement) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          />
        </aside>
      )}
    </div>
  );
}

function Toc({
  headings,
  activeId,
  onSelect,
}: {
  headings: TocHeading[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="sticky top-2">
      <div className="text-fg-dim mb-2 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-wider uppercase">
        <ListTree className="h-3 w-3" />
        On this note
      </div>
      <ul className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: (h.level - 1) * 8 }}>
            <button
              type="button"
              onClick={() => onSelect(h.id)}
              className={cn(
                'block w-full truncate rounded px-2 py-0.5 text-left text-[11.5px] transition-colors',
                activeId === h.id
                  ? 'text-accent bg-accent/10'
                  : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
              )}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown when the service has zero notes
// ---------------------------------------------------------------------------

function EmptyState({ onCreate, serviceName }: { onCreate: () => void; serviceName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FileText className="text-fg-dim/60 h-7 w-7" />
      <p className="text-fg-dim max-w-sm text-[12.5px] leading-relaxed">
        No notes yet for <code className="font-mono">{serviceName}</code>. Notes are perfect for
        runbooks, gotchas, environment variables, or anything you don't want to commit.
      </p>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={onCreate}
      >
        Create your first note
      </Button>
      <p className="text-fg-muted/90 max-w-sm text-[11px] leading-relaxed">
        <Lock className="mr-1 inline-block h-3 w-3 align-[-2px]" />
        Local-only — saved to your RunHQ folder, never to the repo. AI Chat will pick this up as
        context for "Project Q&A".
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor command helpers (unchanged from the single-note version)
// ---------------------------------------------------------------------------

function wrapSelection(
  editor: MonacoEditor.IStandaloneCodeEditor,
  prefix: string,
  suffix: string,
  placeholder: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const selected = model.getValueInRange(selection);
  if (
    selected.length >= prefix.length + suffix.length &&
    selected.startsWith(prefix) &&
    selected.endsWith(suffix)
  ) {
    const inner = selected.slice(prefix.length, selected.length - suffix.length);
    editor.executeEdits('markdown-toggle', [
      { range: selection, text: inner, forceMoveMarkers: true },
    ]);
    return;
  }
  const inner = selected.length > 0 ? selected : placeholder;
  const replacement = `${prefix}${inner}${suffix}`;
  editor.executeEdits('markdown-toggle', [
    { range: selection, text: replacement, forceMoveMarkers: true },
  ]);
  if (selected.length === 0) {
    const startCol = selection.startColumn + prefix.length;
    const endCol = startCol + inner.length;
    editor.setSelection({
      startLineNumber: selection.startLineNumber,
      startColumn: startCol,
      endLineNumber: selection.startLineNumber,
      endColumn: endCol,
    });
  }
  editor.focus();
}

function insertLink(editor: MonacoEditor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const selected = model.getValueInRange(selection);
  const looksLikeUrl = /^(https?:\/\/|mailto:|\/)/i.test(selected.trim());
  const text = looksLikeUrl ? 'link text' : selected || 'link text';
  const url = looksLikeUrl ? selected.trim() : 'https://';
  const replacement = `[${text}](${url})`;
  editor.executeEdits('markdown-link', [
    { range: selection, text: replacement, forceMoveMarkers: true },
  ]);
  const startLine = selection.startLineNumber;
  const startCol = looksLikeUrl
    ? selection.startColumn + 1
    : selection.startColumn + replacement.indexOf('](') + 2;
  const endCol = looksLikeUrl
    ? startCol + text.length
    : selection.startColumn + replacement.length - 1;
  editor.setSelection({
    startLineNumber: startLine,
    startColumn: startCol,
    endLineNumber: startLine,
    endColumn: endCol,
  });
  editor.focus();
}

function toggleLinePrefix(editor: MonacoEditor.IStandaloneCodeEditor, prefix: string): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const startLine = selection.startLineNumber;
  const endLine = selection.endLineNumber;
  let allPrefixed = true;
  for (let l = startLine; l <= endLine; l++) {
    const text = model.getLineContent(l);
    if (text.length === 0) continue;
    if (!text.startsWith(prefix)) {
      allPrefixed = false;
      break;
    }
  }
  const edits: MonacoEditor.IIdentifiedSingleEditOperation[] = [];
  for (let l = startLine; l <= endLine; l++) {
    const text = model.getLineContent(l);
    const range = {
      startLineNumber: l,
      startColumn: 1,
      endLineNumber: l,
      endColumn: text.length + 1,
    };
    if (allPrefixed) {
      edits.push({ range, text: text.slice(prefix.length), forceMoveMarkers: true });
    } else if (text.length === 0 || !text.startsWith(prefix)) {
      edits.push({ range, text: prefix + text, forceMoveMarkers: true });
    }
  }
  if (edits.length > 0) {
    editor.executeEdits('markdown-line-prefix', edits);
  }
  editor.focus();
}

function toggleHeading(editor: MonacoEditor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const line = selection.startLineNumber;
  const text = model.getLineContent(line);
  const m = text.match(/^(#{1,6})\s+(.*)$/);
  let next: string;
  if (!m) {
    next = `# ${text}`;
  } else {
    const level = m[1]!.length;
    const body = m[2]!;
    if (level >= 3) {
      next = body;
    } else {
      next = `${'#'.repeat(level + 1)} ${body}`;
    }
  }
  editor.executeEdits('markdown-heading', [
    {
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: text.length + 1,
      },
      text: next,
      forceMoveMarkers: true,
    },
  ]);
  editor.focus();
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition',
        active ? 'bg-fg/10 text-fg' : 'text-fg-dim hover:text-fg hover:bg-fg/5',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FormatButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="text-fg-dim hover:text-fg hover:bg-fg/5 inline-flex h-7 w-7 items-center justify-center rounded transition"
    >
      {icon}
    </button>
  );
}

function Cheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Markdown cheat sheet"
      className="border-border bg-surface absolute right-3 bottom-3 z-20 w-[340px] overflow-hidden rounded-lg border shadow-lg"
    >
      <div className="border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="text-fg flex items-center gap-1.5 text-[12px] font-medium">
          <HelpCircle className="text-fg-muted h-3.5 w-3.5" />
          Markdown cheat sheet
        </div>
        <button type="button" onClick={onClose} className="text-fg-dim hover:text-fg text-[11px]">
          Close
        </button>
      </div>
      <div className="max-h-[360px] space-y-3 overflow-y-auto p-3 text-[11px]">
        <Section title="Storage">
          <p className="text-fg/80 leading-relaxed">
            Notes are local-only — they live in{' '}
            <code className="text-fg/90 font-mono">
              $RUNHQ_HOME/notes/&lt;service-id&gt;/&lt;name&gt;.md
            </code>{' '}
            on this machine. Nothing here ends up in the project repo,
            <code className="text-fg/90 mx-1 font-mono">git status</code>, or remote sync.
          </p>
          <p className="text-fg-muted mt-1 leading-relaxed">
            Safe for credentials, todos, half-formed thoughts, or anything you don't want in a
            commit.
          </p>
        </Section>
        <Section title="Shortcuts">
          <ShortcutRow keys="⌘B" label="Bold" />
          <ShortcutRow keys="⌘I" label="Italic" />
          <ShortcutRow keys="⌘E" label="Inline code" />
          <ShortcutRow keys="⌘K" label="Insert link" />
          <ShortcutRow keys="⌘⇧H" label="Cycle heading level" />
          <ShortcutRow keys="⌘⇧L" label="Toggle bullet list" />
          <ShortcutRow keys="⌘⇧7" label="Toggle numbered list" />
          <ShortcutRow keys="⌘⇧." label="Toggle block quote" />
          <ShortcutRow keys="⌘F / ⌘H" label="Find / replace" />
          <ShortcutRow keys="⌘D" label="Multi-cursor next match" />
          <ShortcutRow keys="⌘S" label="Save" />
        </Section>
        <Section title="Syntax">
          <SyntaxRow code="# H1, ## H2, ### H3" desc="Headings" />
          <SyntaxRow code="**bold**, *italic*" desc="Emphasis" />
          <SyntaxRow code="`inline`" desc="Inline code" />
          <SyntaxRow code="```bash\ncode block\n```" desc="Fenced code (lang-tagged)" />
          <SyntaxRow code="- item / 1. item" desc="Lists" />
          <SyntaxRow code="> quote" desc="Block quote" />
          <SyntaxRow code="[label](url)" desc="Link" />
          <SyntaxRow code="![alt](url)" desc="Image" />
          <SyntaxRow code="| a | b |\n|---|---|" desc="GFM table" />
          <SyntaxRow code="- [ ] todo" desc="Task list" />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-fg-muted mb-1 text-[10px] font-semibold tracking-wider uppercase">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg/80">{label}</span>
      <kbd className="border-border bg-surface-muted text-fg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
        {keys}
      </kbd>
    </div>
  );
}

function SyntaxRow({ code, desc }: { code: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <code className="text-fg/80 font-mono text-[10.5px] whitespace-pre">{code}</code>
      <span className="text-fg-muted shrink-0 text-[10.5px]">{desc}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readWidePref(): boolean {
  try {
    return window.localStorage.getItem(WIDE_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/[^\w-]/g, '\\$&');
}

function formatRelativeMs(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}
