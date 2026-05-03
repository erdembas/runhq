import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

interface SortableCommandRowProps {
  id: string;
  name: string;
  cmd: string;
  onNameChange: (value: string) => void;
  onCmdChange: (value: string) => void;
  onRemove: () => void;
}

export function SortableCommandRow({
  id,
  name,
  cmd,
  onNameChange,
  onCmdChange,
  onRemove,
}: SortableCommandRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = isDragging
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
        onChange={(event) => onNameChange(event.target.value)}
        className="w-24 shrink-0"
      />
      <Input
        mono
        placeholder="pnpm dev"
        value={cmd}
        onChange={(event) => onCmdChange(event.target.value)}
        className="flex-1"
      />
      <IconButton label="Remove" icon={<Trash2 />} tone="danger" size="xs" onClick={onRemove} />
    </div>
  );
}
