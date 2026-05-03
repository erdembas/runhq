import type { Ref, RefObject } from 'react';
import { EmptyState } from '../AiChatEmptyState';
import { TurnView } from '../AiChatTurnView';
import type { Turn } from '../chatPanelTypes';

interface Props {
  turns: Turn[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onContinue: () => void;
}

export function AiChatMessageList({ turns, scrollRef, onContinue }: Props) {
  return (
    <div
      ref={scrollRef as Ref<HTMLDivElement>}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
      {turns.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {turns.map((turn, idx) => (
            <TurnView
              key={turn.id}
              turn={turn}
              onContinue={isLastResumable(turns, turn, idx) ? onContinue : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isLastResumable(turns: Turn[], turn: Turn, idx: number) {
  return (
    idx === turns.length - 1 &&
    turn.role === 'assistant' &&
    !turn.streaming &&
    !turn.error &&
    (turn.finishReason === 'length' || turn.finishReason === 'timeout' || turn.partial === true)
  );
}
