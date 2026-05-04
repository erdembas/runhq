import { useDroppable } from '@dnd-kit/core';

interface TabEndSlotProps {
  groupId: string;
  insertIndex: number;
}

export function TabEndSlot({ groupId, insertIndex }: TabEndSlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tab-slot:end:${groupId}`,
    data: { kind: 'tab-slot', groupId, insertIndex },
  });

  return (
    <div ref={setNodeRef} className="relative flex min-w-[24px] flex-1">
      {isOver && (
        <span aria-hidden className="bg-accent absolute top-1 bottom-1 left-0 w-0.5 rounded-full" />
      )}
    </div>
  );
}
