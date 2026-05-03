import { useCallback, useEffect, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '@/lib/cn';
import type { LayoutNode, SplitNode } from '../layoutModel';

interface SplitPaneProps {
  node: SplitNode;
  renderChild: (child: LayoutNode) => React.ReactNode;
  onResize: (splitId: string, sizes: [number, number]) => void;
}

export function SplitPane({ node, renderChild, onResize }: SplitPaneProps) {
  const latestSizes = useRef<[number, number]>(node.sizes);
  const flushTimer = useRef<number | null>(null);

  const handleLayout = useCallback(
    (sizes: number[]) => {
      const a = sizes[0] ?? 50;
      const b = sizes[1] ?? 50;
      latestSizes.current = [a, b];
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const [na, nb] = latestSizes.current;
        if (Math.abs(na - node.sizes[0]) < 0.1 && Math.abs(nb - node.sizes[1]) < 0.1) return;
        onResize(node.id, latestSizes.current);
      }, 80);
    },
    [node.id, node.sizes, onResize],
  );

  useEffect(
    () => () => {
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  return (
    <PanelGroup
      direction={node.orientation}
      onLayout={handleLayout}
      id={node.id}
      className="flex min-h-0 flex-1"
    >
      <Panel defaultSize={node.sizes[0]} minSize={10}>
        <div className="flex h-full min-h-0 flex-1">{renderChild(node.children[0])}</div>
      </Panel>
      <PanelResizeHandle
        className={cn(
          'group/handle',
          node.orientation === 'horizontal'
            ? 'w-[2px] hover:w-1 active:w-1'
            : 'h-[2px] hover:h-1 active:h-1',
          'bg-border-strong hover:bg-accent active:bg-accent transition-all',
        )}
      />
      <Panel defaultSize={node.sizes[1]} minSize={10}>
        <div className="flex h-full min-h-0 flex-1">{renderChild(node.children[1])}</div>
      </Panel>
    </PanelGroup>
  );
}
