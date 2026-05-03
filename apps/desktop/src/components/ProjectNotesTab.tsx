import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor, IKeyboardEvent } from 'monaco-editor';
import { ipc } from '@/lib/ipc';
import { useMonacoReady } from '@/lib/monacoRuntime';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { useTheme } from '@/lib/theme';
import type { NoteFile } from '@/types';
import { Cheatsheet } from '@/components/project-notes/Cheatsheet';
import { EmptyNotesState } from '@/components/project-notes/EmptyNotesState';
import {
  insertLink,
  toggleHeading,
  toggleLinePrefix,
  wrapSelection,
} from '@/components/project-notes/editorActions';
import { readWidePref, writeWidePref } from '@/components/project-notes/model';
import { NoteSubNav } from '@/components/project-notes/NoteSubNav';
import { NotesFormatToolbar } from '@/components/project-notes/NotesFormatToolbar';
import { NotesToolbar } from '@/components/project-notes/NotesToolbar';
import { PreviewBody } from '@/components/project-notes/PreviewBody';
import type { NoteViewMode } from '@/components/project-notes/types';

interface ProjectNotesTabProps {
  serviceId: string;
  serviceName: string;
}

export function ProjectNotesTab({ serviceId, serviceName }: ProjectNotesTabProps) {
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<NoteViewMode>('edit');
  const [wide, setWide] = useState<boolean>(() => readWidePref());
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const { effective: effectiveTheme } = useTheme();
  const monacoTheme = useMonacoTheme(effectiveTheme);
  const monaco = useMonacoReady();

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
        setActiveName(list[0]?.name ?? null);
      })
      .catch((error) => {
        if (!cancelled) setError(`Couldn't load notes: ${String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

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
      .catch((error) => {
        if (!cancelled) setError(`Couldn't read note: ${String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId, activeName]);

  const isDirty = content !== originalContent;

  const handleSave = useCallback(async (): Promise<void> => {
    if (!activeName) return;
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await ipc.writeNote(serviceId, activeName, content);
      setOriginalContent(content);
      setNotes(await ipc.listNotes(serviceId));
    } catch (error) {
      setError(`Couldn't save: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [serviceId, activeName, content, isDirty, saving]);
  saveRef.current = handleSave;

  flushRef.current = useCallback(async () => {
    if (!activeName) return;
    if (content === originalContent) return;
    try {
      await ipc.writeNote(serviceId, activeName, content);
    } catch {
      // Best-effort autosave on navigation/unmount.
    }
  }, [serviceId, activeName, content, originalContent]);

  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, [activeName, serviceId]);

  const handleCreate = useCallback(async () => {
    setError(null);
    try {
      await flushRef.current();
      const newName = await ipc.createNote(serviceId);
      setNotes(await ipc.listNotes(serviceId));
      setActiveName(newName);
      setMode('edit');
    } catch (error) {
      setError(`Couldn't create note: ${String(error)}`);
    }
  }, [serviceId]);

  const handleDelete = useCallback(
    async (name: string) => {
      setError(null);
      try {
        await ipc.deleteNote(serviceId, name);
        const list = await ipc.listNotes(serviceId);
        setNotes(list);
        if (name === activeName) {
          setActiveName(list[0]?.name ?? null);
        }
      } catch (error) {
        setError(`Couldn't delete: ${String(error)}`);
      }
    },
    [serviceId, activeName],
  );

  const handleSelect = useCallback(
    async (name: string) => {
      if (name === activeName) return;
      await flushRef.current();
      setActiveName(name);
    },
    [activeName],
  );

  const toggleWide = useCallback(() => {
    setWide((previous) => {
      const next = !previous;
      writeWidePref(next);
      return next;
    });
  }, []);

  const onEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    const actions: Array<{ id: string; label: string; keys: number[]; run: () => void }> = [
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
    for (const action of actions) {
      editor.addAction({
        id: action.id,
        label: action.label,
        keybindings: action.keys,
        contextMenuGroupId: 'markdown',
        run: action.run,
      });
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });
    editor.onKeyDown((event: IKeyboardEvent) => {
      if (event.keyCode !== monaco.KeyCode.Tab) return;
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!selection || !model) return;
      const line = model.getLineContent(selection.startLineNumber);
      if (!/^\s*([-*+]|\d+\.)\s/.test(line)) return;
      event.preventDefault();
      event.stopPropagation();
      editor.trigger(
        'keyboard',
        event.shiftKey ? 'editor.action.outdentLines' : 'editor.action.indentLines',
        null,
      );
    });
  }, []);

  const fireAction = useCallback((id: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger('toolbar', id, null);
  }, []);

  const activeNote = useMemo(
    () => (activeName ? (notes.find((note) => note.name === activeName) ?? null) : null),
    [notes, activeName],
  );

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <NoteSubNav
        notes={notes}
        activeName={activeName}
        loading={listLoading}
        onSelect={(name) => void handleSelect(name)}
        onCreate={() => void handleCreate()}
        onDelete={(name) => void handleDelete(name)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <NotesToolbar
          activeName={activeName}
          activeNote={activeNote}
          cheatsheetOpen={cheatsheetOpen}
          isDirty={isDirty}
          mode={mode}
          onDeleteActive={() => activeName && void handleDelete(activeName)}
          onSave={() => void handleSave()}
          onSetMode={setMode}
          onToggleCheatsheet={() => setCheatsheetOpen((value) => !value)}
          onToggleWide={toggleWide}
          originalContentLength={originalContent.length}
          saving={saving}
          serviceName={serviceName}
          wide={wide}
        />

        {error && (
          <div className="border-tone-critical/30 bg-tone-critical/5 text-tone-critical-fg shrink-0 border-b px-3 py-1.5 text-[11px]">
            {error}
          </div>
        )}

        {activeName && mode === 'edit' && <NotesFormatToolbar onFireAction={fireAction} />}

        {!activeName && !listLoading ? (
          <EmptyNotesState onCreate={() => void handleCreate()} serviceName={serviceName} />
        ) : bodyLoading ? (
          <div className="text-fg-dim flex flex-1 items-center justify-center text-[12px]">
            Loading…
          </div>
        ) : mode === 'edit' && activeName ? (
          <div className="relative flex-1 overflow-hidden">
            {monaco.error ? (
              <div className="text-tone-critical-fg flex h-full items-center justify-center px-6 text-[12px]">
                Couldn't load editor: {monaco.error}
              </div>
            ) : monaco.ready ? (
              <Editor
                key={activeName}
                value={content}
                onChange={(value) => setContent(value ?? '')}
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
              />
            ) : (
              <div className="text-fg-dim flex h-full items-center justify-center text-[12px]">
                Loading editor…
              </div>
            )}
          </div>
        ) : activeName ? (
          <PreviewBody content={content} wide={wide} serviceName={serviceName} />
        ) : null}

        {cheatsheetOpen && <Cheatsheet onClose={() => setCheatsheetOpen(false)} />}
      </div>
    </div>
  );
}
