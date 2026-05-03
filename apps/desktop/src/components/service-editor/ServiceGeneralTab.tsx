import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FolderOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { DetectedSuggestions } from '@/components/service-editor/DetectedSuggestions';
import { SortableCommandRow } from '@/components/service-editor/SortableCommandRow';
import { TagInput } from '@/components/service-editor/TagInput';
import type { ServiceEditorStore } from '@/components/service-editor/useServiceEditorStore';

interface ServiceGeneralTabProps {
  form: ServiceEditorStore;
  patch: ServiceEditorStore['patch'];
  onChooseDir: () => void;
  onNameChange: (value: string) => void;
}

export function ServiceGeneralTab({
  form,
  patch,
  onChooseDir,
  onNameChange,
}: ServiceGeneralTabProps) {
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const from = form.cmds.findIndex((_, index) => String(index) === active.id);
      const to = form.cmds.findIndex((_, index) => String(index) === over.id);
      if (from >= 0 && to >= 0) form.moveCmd(from, to);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="Name" className="md:col-span-2">
        <Input
          autoFocus
          placeholder="web"
          value={form.name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </Field>
      <Field label="Working directory" className="md:col-span-2">
        <div className="flex gap-1.5">
          <Input
            mono
            placeholder="/Users/you/project"
            value={form.cwd}
            onChange={(event) => patch({ cwd: event.target.value })}
          />
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FolderOpen className="h-3 w-3" />}
            onClick={onChooseDir}
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
              items={form.cmds.map((_, index) => String(index))}
              strategy={verticalListSortingStrategy}
            >
              {form.cmds.map((entry, index) => (
                <SortableCommandRow
                  key={entry.uid}
                  id={String(index)}
                  name={entry.name}
                  cmd={entry.cmd}
                  onNameChange={(value) => form.updateCmd(index, { name: value })}
                  onCmdChange={(value) => form.updateCmd(index, { cmd: value })}
                  onRemove={() => form.removeCmd(index)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="h-2.5 w-2.5" />}
            onClick={form.addCmd}
          >
            Add command
          </Button>
          <DetectedSuggestions
            loading={form.detecting}
            detected={form.detected}
            existingCmds={form.cmds}
            onPick={form.addSuggestionAsCmd}
            selectedPm={form.selectedPm}
            onPmChange={(selectedPm) => patch({ selectedPm })}
          />
        </div>
      </Field>
      <div className="grid grid-cols-[30%_70%] gap-3 md:col-span-2">
        <Field label="Port" hint="Port bar.">
          <Input
            mono
            placeholder="3000"
            inputMode="numeric"
            value={form.port}
            onChange={(event) => patch({ port: event.target.value.replace(/[^\d]/g, '') })}
          />
        </Field>
        <Field label="Category" hint="Start typing or pick from the list.">
          <TagInput
            tags={form.tags}
            draft={form.tagDraft}
            setDraft={(tagDraft) => patch({ tagDraft })}
            onAdd={form.addTag}
            onRemove={form.removeTag}
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Switch
          checked={form.autoStart}
          onChange={(autoStart) => patch({ autoStart })}
          label="Auto-start on app launch"
          description="Automatically start this service when RunHQ opens."
        />
      </div>
    </div>
  );
}
