import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FolderOpen,
  GripVertical,
  Plus,
  Route,
  Settings,
  Terminal,
  Trash2,
  Variable,
} from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { Tabs, type Tab } from '@/components/ui/Tabs';
import { IconButton } from '@/components/ui/IconButton';
import { Switch } from '@/components/ui/Switch';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/useAppStore';
import type { CommandEntry, ProjectCandidate, ServiceDef } from '@/types';
import {
  DEFAULT_GRACE_MS,
  NODE_PACKAGE_MANAGERS,
  inferPmFromCmds,
  rewritePmInCmd,
  type EnvRow,
  type NodePackageManager,
} from './types';
import { DetectedSuggestions } from './DetectedSuggestions';
import { TagInput } from './TagInput';
import { EnvEditor } from './EnvEditor';

interface Props {
  service: ServiceDef | null;
  onClose: () => void;
}

type TabKey = 'general' | 'env' | 'advanced';

let cmdUid = 0;
const nextUid = () => `cmd-${++cmdUid}`;

interface CmdRow extends CommandEntry {
  uid: string;
}

export function ServiceEditor({ service, onClose }: Props) {
  const [tab, setTab] = useState<TabKey>('general');
  const [name, setName] = useState(service?.name ?? '');
  const [cwd, setCwd] = useState(service?.cwd ?? '');
  const [cmds, setCmds] = useState<CmdRow[]>(() => {
    if (service?.cmds?.length) return service.cmds.map((c) => ({ ...c, uid: nextUid() }));
    return [];
  });
  const [port, setPort] = useState<string>(service?.port?.toString() ?? '');
  const [tags, setTags] = useState<string[]>(service?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    () => service?.env.map(([key, value]) => ({ key, value })) ?? [],
  );
  const [graceMs, setGraceMs] = useState<string>(
    service?.grace_ms?.toString() ?? String(DEFAULT_GRACE_MS),
  );
  const [pathOverride, setPathOverride] = useState<string>(service?.path_override ?? '');
  const [preCommand, setPreCommand] = useState<string>(service?.pre_command ?? '');
  const [autoStart, setAutoStart] = useState(service?.auto_start ?? false);
  const [hideDashboard, setHideDashboard] = useState(service?.hide_dashboard ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detected, setDetected] = useState<ProjectCandidate | null>(null);
  const [detecting, setDetecting] = useState(false);
  const nameManuallyEdited = useRef(service !== null);
  const isEdit = service !== null;
  const [selectedPm, setSelectedPm] = useState<NodePackageManager>(() =>
    inferPmFromCmds(service?.cmds ?? []),
  );
  const prevPmRef = useRef<NodePackageManager>(selectedPm);

  useEffect(() => {
    if (isEdit) return;
    if (
      detected?.package_manager &&
      NODE_PACKAGE_MANAGERS.includes(detected.package_manager as NodePackageManager)
    ) {
      const pm = detected.package_manager as NodePackageManager;
      setSelectedPm(pm);
      prevPmRef.current = pm;
    }
  }, [detected?.package_manager, isEdit]);

  useEffect(() => {
    const prev = prevPmRef.current;
    if (prev === selectedPm) return;
    prevPmRef.current = selectedPm;
    const hasPmCmd = (cmd: string) => /\b(npm|yarn|pnpm|bun)\b/.test(cmd);
    setCmds((cmds) => {
      if (!cmds.some((c) => hasPmCmd(c.cmd))) return cmds;
      return cmds.map((c) =>
        hasPmCmd(c.cmd) ? { ...c, cmd: rewritePmInCmd(c.cmd, selectedPm) } : c,
      );
    });
  }, [selectedPm]);

  const upsertService = useAppStore((s) => s.upsertService);
  const setSelected = useAppStore((s) => s.setSelected);

  const tabs = useMemo<Tab<TabKey>[]>(
    () => [
      { key: 'general', label: 'General', icon: <Terminal className="h-3 w-3" /> },
      {
        key: 'env',
        label: 'Environment',
        icon: <Variable className="h-3 w-3" />,
        badge: envRows.length ? (
          // `surface-muted` reads as a clear "chip on the dialog body" — the
          // previous `surface-overlay` matched the body exactly and the
          // count was effectively invisible.
          <span className="bg-surface-muted text-fg-muted rounded-app-sm ml-1 px-1 text-[9px]">
            {envRows.length}
          </span>
        ) : undefined,
      },
      { key: 'advanced', label: 'Advanced', icon: <Settings className="h-3 w-3" /> },
    ],
    [envRows.length],
  );

  const chooseDir = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') setCwd(picked);
  };

  useEffect(() => {
    if (!cwd.trim()) {
      setDetected(null);
      setDetecting(false);
      return;
    }
    const path = cwd.trim();
    setDetecting(true);
    const handle = setTimeout(async () => {
      try {
        const result = await ipc.detectProject(path);
        setDetected(result);
        if (result && !nameManuallyEdited.current && !name.trim()) {
          setName(result.name);
        }
      } catch {
        setDetected(null);
      } finally {
        setDetecting(false);
      }
    }, 350);
    return () => {
      clearTimeout(handle);
      setDetecting(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced detection; only `cwd` should trigger
  }, [cwd]);

  const addCmd = () => {
    const idx = cmds.length + 1;
    setCmds([...cmds, { name: `cmd-${idx}`, cmd: '', uid: nextUid() }]);
  };

  const removeCmd = (i: number) => {
    setCmds(cmds.filter((_, idx) => idx !== i));
  };

  const updateCmd = (i: number, patch: Partial<CommandEntry>) => {
    setCmds(cmds.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const moveCmd = (from: number, to: number) => {
    setCmds((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const from = cmds.findIndex((_, i) => String(i) === active.id);
      const to = cmds.findIndex((_, i) => String(i) === over.id);
      if (from >= 0 && to >= 0) moveCmd(from, to);
    }
  };

  const addSuggestionAsCmd = (suggestion: { label: string; cmd: string }) => {
    const existing = cmds.findIndex((c) => c.name === suggestion.label);
    if (existing >= 0) {
      updateCmd(existing, { cmd: suggestion.cmd });
    } else {
      setCmds([...cmds, { name: suggestion.label, cmd: suggestion.cmd, uid: nextUid() }]);
    }
    if (tags.length === 0 && detected?.runtime === 'node') {
      const label = suggestion.label.toLowerCase();
      if (label.includes('dev') || label.includes('start') || label.includes('serve')) {
        setTags(['frontend']);
      }
    }
  };

  const addTag = (value: string) => {
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    if (tags.includes(cleaned)) return;
    setTags([...tags, cleaned]);
    setTagDraft('');
  };

  const submit = async () => {
    setError(null);
    const validCmds = cmds.filter((c) => c.cmd.trim() && c.name.trim());
    if (!name.trim() || !cwd.trim() || validCmds.length === 0) {
      setError('Name, folder, and at least one command are all required.');
      setTab('general');
      return;
    }
    const parsedPort = port.trim() ? Number(port) : null;
    if (parsedPort !== null && (!Number.isFinite(parsedPort) || parsedPort <= 0)) {
      setError('Port must be a positive number.');
      setTab('general');
      return;
    }
    const parsedGrace = Number(graceMs);
    if (!Number.isFinite(parsedGrace) || parsedGrace < 0) {
      setError('Grace period must be zero or greater.');
      setTab('advanced');
      return;
    }

    const env: Array<[string, string]> = envRows
      .filter((r) => r.key.trim())
      .map((r) => [r.key.trim(), r.value]);

    const pathVal = pathOverride.trim() || null;
    const preVal = preCommand.trim() || null;

    setSaving(true);
    try {
      let saved: ServiceDef;
      if (isEdit && service) {
        saved = await ipc.updateService({
          ...service,
          name: name.trim(),
          cwd: cwd.trim(),
          cmds: validCmds,
          env,
          path_override: pathVal,
          pre_command: preVal,
          port: parsedPort,
          tags,
          auto_start: autoStart,
          hide_dashboard: hideDashboard,
          grace_ms: Math.round(parsedGrace),
        });
      } else {
        saved = await ipc.addService({
          name: name.trim(),
          cwd: cwd.trim(),
          cmds: validCmds,
          env,
          path_override: pathVal,
          pre_command: preVal,
          port: parsedPort,
          tags,
          auto_start: autoStart,
          hide_dashboard: hideDashboard,
          grace_ms: Math.round(parsedGrace),
        });
      }
      upsertService(saved);
      setSelected(saved.id);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyboard handler; all form state captured in closure
  }, [name, cwd, cmds, port, tags, envRows, graceMs]);

  return (
    <Dialog
      title={isEdit ? `Edit service — ${service.name}` : 'Add service'}
      subtitle={isEdit ? service.id : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {error && <span className="text-status-error mr-auto text-[10px]">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create service'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs<TabKey> tabs={tabs} value={tab} onChange={setTab} className="self-start" />

        {tab === 'general' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name" className="md:col-span-2">
              <Input
                autoFocus
                placeholder="web"
                value={name}
                onChange={(e) => {
                  nameManuallyEdited.current = true;
                  setName(e.target.value);
                }}
              />
            </Field>
            <Field label="Working directory" className="md:col-span-2">
              <div className="flex gap-1.5">
                <Input
                  mono
                  placeholder="/Users/you/project"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FolderOpen className="h-3 w-3" />}
                  onClick={chooseDir}
                >
                  Browse
                </Button>
              </div>
            </Field>
            <Field
              label="Commands"
              hint="Multiple commands run in parallel. Each has its own log stream."
              className="md:col-span-2"
            >
              <div className="space-y-1.5">
                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={cmds.map((_, i) => String(i))}
                    strategy={verticalListSortingStrategy}
                  >
                    {cmds.map((entry, i) => (
                      <SortableCmdRow
                        key={i}
                        id={String(i)}
                        name={entry.name}
                        cmd={entry.cmd}
                        onNameChange={(v) => updateCmd(i, { name: v })}
                        onCmdChange={(v) => updateCmd(i, { cmd: v })}
                        onRemove={() => removeCmd(i)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-2.5 w-2.5" />}
                  onClick={addCmd}
                >
                  Add command
                </Button>
                <DetectedSuggestions
                  loading={detecting}
                  detected={detected}
                  existingCmds={cmds}
                  onPick={addSuggestionAsCmd}
                  selectedPm={selectedPm}
                  onPmChange={setSelectedPm}
                />
              </div>
            </Field>
            <div className="grid grid-cols-[30%_70%] gap-3 md:col-span-2">
              <Field label="Port" hint="Port bar.">
                <Input
                  mono
                  placeholder="3000"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
                />
              </Field>
              <Field label="Category" hint="Start typing or pick from the list.">
                <TagInput
                  tags={tags}
                  draft={tagDraft}
                  setDraft={setTagDraft}
                  onAdd={addTag}
                  onRemove={(t) => setTags(tags.filter((x) => x !== t))}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Switch
                checked={autoStart}
                onChange={setAutoStart}
                label="Auto-start on app launch"
                description="Automatically start this service when RunHQ opens."
              />
            </div>
          </div>
        )}

        {tab === 'env' && <EnvEditor rows={envRows} setRows={setEnvRows} />}

        {tab === 'advanced' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="PATH override"
              hint="Directories prepended to $PATH before spawning. Use : to separate multiple paths."
              className="md:col-span-2"
            >
              <div className="flex items-center gap-1.5">
                <Route className="text-fg-dim h-3.5 w-3.5 shrink-0" />
                <Input
                  mono
                  placeholder="/Users/you/.nvm/versions/node/v22/bin"
                  value={pathOverride}
                  onChange={(e) => setPathOverride(e.target.value)}
                  className="flex-1"
                />
              </div>
            </Field>
            <Field
              label="Pre-command"
              hint="Shell setup that runs before the main command — in the SAME shell session, so env vars (export, source, nvm use, unset) carry into the command. One line per step. Any line exiting non-zero aborts the start (set -e)."
              className="md:col-span-2"
            >
              <div className="flex items-start gap-1.5">
                <Terminal className="text-fg-dim mt-1.5 h-3.5 w-3.5 shrink-0" />
                <Textarea
                  mono
                  rows={4}
                  placeholder={'source .env\nnvm use 14\nunset NODE_OPTIONS'}
                  value={preCommand}
                  onChange={(e) => setPreCommand(e.target.value)}
                  className="flex-1"
                />
              </div>
            </Field>
            <Field
              label="Shutdown grace period"
              hint="Milliseconds to wait after SIGTERM before escalating to SIGKILL."
            >
              <Input
                mono
                inputMode="numeric"
                value={graceMs}
                onChange={(e) => setGraceMs(e.target.value.replace(/[^\d]/g, ''))}
              />
            </Field>
            <div className="md:col-span-2">
              <Switch
                checked={hideDashboard}
                onChange={setHideDashboard}
                label="Hide from dashboard"
                description="Track this project in the sidebar, palette, and search only — skip it on the dashboard, dependency scans, and license aggregates. Useful for vendored or docs-only repos that have no run story."
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function SortableCmdRow({
  id,
  name,
  cmd,
  onNameChange,
  onCmdChange,
  onRemove,
}: {
  id: string;
  name: string;
  cmd: string;
  onNameChange: (v: string) => void;
  onCmdChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = isDragging
    ? { transform: CSS.Transform.toString(transform), transition, zIndex: 10 }
    : { transform: CSS.Transform.toString(transform), transition: '0ms' };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-center gap-1.5', isDragging && 'opacity-70')}
    >
      <button
        type="button"
        className="text-fg-dim hover:text-fg-muted cursor-grab touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <Input
        placeholder="name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="w-24 shrink-0"
      />
      <Input
        mono
        placeholder="pnpm dev"
        value={cmd}
        onChange={(e) => onCmdChange(e.target.value)}
        className="flex-1"
      />
      <IconButton label="Remove" icon={<Trash2 />} tone="danger" size="xs" onClick={onRemove} />
    </div>
  );
}
