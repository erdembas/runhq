import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { memo, useEffect, useState } from 'react';
import {
  CircleCheck,
  CircleHelp,
  Code2,
  FileCheck2,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  PencilRuler,
  ScanEye,
} from 'lucide-react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  canConnectWorkflowTasks,
  workflowCanvasPositions,
  workflowStepTitle,
} from './agentWorkflowEditor';
import type { WorkflowTaskLane } from './agentWorkflowGraph';
import { WORKFLOW_ROLE_OPTIONS } from './agentWorkflowStepPolicy';
import './agentWorkflowCanvas.css';

type StepNode = Node<
  {
    step: CreateWorkflowStep;
    number: number;
    account: string;
    lane?: WorkflowTaskLane;
    problem?: boolean;
  },
  'workflowStep'
>;

const roleIcons = {
  plan: PencilRuler,
  implement: Code2,
  review: ScanEye,
  revise: ListChecks,
  validate: FileCheck2,
};
const laneLabels = {
  get attention() {
    return i18n.t('Needs you');
  },
  get working() {
    return i18n.t('Working');
  },
  get ready() {
    return i18n.t('Ready');
  },
  get blocked() {
    return i18n.t('Waiting');
  },
  get completed() {
    return i18n.t('Done');
  },
};

const WorkflowStepNode = memo(function WorkflowStepNode({
  data,
  selected,
  isConnectable,
}: NodeProps<StepNode>) {
  i18n.useLocale();
  const Icon = roleIcons[data.step.role];
  const role = WORKFLOW_ROLE_OPTIONS.find((option) => option.value === data.step.role)?.label;
  return (
    <div
      className={`workflow-step bg-surface text-fg rounded-xl border p-3 shadow-sm ${selected ? 'border-accent ring-accent/15 ring-4' : data.problem || data.lane === 'attention' ? 'border-tone-warning' : 'border-border'}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-accent/10 text-accent flex size-7 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <span className="text-fg-muted text-[11px] font-medium">{role}</span>
        {data.step.continue_from && (
          <MessageSquare
            className="text-fg-dim size-3"
            aria-label={i18n.t('Continues an earlier prompt’s conversation')}
          />
        )}
        <span className="text-fg-dim ml-auto text-[10px]">
          {String(data.number).padStart(2, '0')}
        </span>
      </div>
      <p
        className="line-clamp-2 min-h-9 text-xs leading-[18px] font-medium"
        title={workflowStepTitle(data.step)}
      >
        {workflowStepTitle(data.step)}
      </p>
      <div className="text-fg-dim mt-3 flex items-center gap-2 text-[10px]">
        <span className="min-w-0 flex-1 truncate">{data.account || i18n.t('Choose an agent')}</span>
        {data.lane ? (
          <span
            className={`flex shrink-0 items-center gap-1 ${data.lane === 'completed' ? 'text-status-running' : data.lane === 'attention' ? 'text-tone-warning-fg' : data.lane === 'working' ? 'text-accent' : ''}`}
          >
            {data.lane === 'working' && <Loader2 className="size-3 animate-spin" />}
            {data.lane === 'completed' && <CircleCheck className="size-3" />}
            {data.lane === 'attention' && <CircleHelp className="size-3" />}
            {laneLabels[data.lane]}
          </span>
        ) : data.problem ? (
          <span className="text-tone-warning-fg">{i18n.t('Needs setup')}</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
const nodeTypes = { workflowStep: WorkflowStepNode };

interface CanvasProps {
  steps: CreateWorkflowStep[];
  selected?: string;
  onSelect: (id: string) => void;
  providerName: (target: string) => string;
  lanes?: Record<string, WorkflowTaskLane>;
  problems?: Set<string>;
  onConnect?: (connection: Connection) => void;
  disabled?: boolean;
}

function Canvas({
  steps,
  selected,
  onSelect,
  providerName,
  lanes,
  problems,
  onConnect,
  disabled,
}: CanvasProps) {
  i18n.useLocale();
  const { fitView } = useReactFlow<StepNode>();
  const initialized = useNodesInitialized();
  const shape = JSON.stringify(steps.map((step) => [step.id, step.depends_on]));
  const defaults = useMemo(() => workflowCanvasPositions(steps), [steps]);
  const [placement, setPlacement] = useState<{
    shape: string;
    positions: Record<string, { x: number; y: number }>;
  }>({ shape: '', positions: {} });
  // React Flow measures custom nodes once. Keep those dimensions when their data changes,
  // otherwise a controlled node becomes hidden until a ResizeObserver fires again.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const positions = placement.shape === shape ? placement.positions : {};
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(
      () => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [shape, initialized, fitView]);
  const nodes: StepNode[] = steps.map((step, index) => ({
    id: step.id,
    type: 'workflowStep',
    position: positions[step.id] ?? defaults[step.id] ?? { x: 0, y: 0 },
    measured: measurements[step.id],
    selected: selected === step.id,
    ariaLabel: i18n.t('Step {value1}: {value2}{value3}', {
      value1: index + 1,
      value2: workflowStepTitle(step),
      value3: lanes?.[step.id] ? `, ${laneLabels[lanes[step.id]!]}` : '',
    }),
    data: {
      step,
      number: index + 1,
      account: providerName(step.target),
      lane: lanes?.[step.id],
      problem: problems?.has(step.id),
    },
  }));
  const edges: Edge[] = steps.flatMap((step) =>
    step.depends_on.map((source) => ({
      id: `${source}->${step.id}`,
      source,
      target: step.id,
      type: 'smoothstep',
      animated: lanes?.[step.id] === 'working',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { strokeWidth: 1.5 },
      focusable: false,
    })),
  );
  return (
    <div className="workflow-canvas h-[360px] min-w-0" aria-label={i18n.t('Workflow map')}>
      <ReactFlow<StepNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => {
          for (const change of changes) {
            if (change.type === 'select' && change.selected) onSelect(change.id);
          }
          if (changes.some((change) => change.type === 'dimensions' && change.dimensions)) {
            setMeasurements((previous) => {
              const next = { ...previous };
              for (const change of changes) {
                if (change.type === 'dimensions' && change.dimensions)
                  next[change.id] = change.dimensions;
              }
              return next;
            });
          }
          if (!changes.some((change) => change.type === 'position' && change.position)) return;
          setPlacement((previous) => {
            const next = previous.shape === shape ? { ...previous.positions } : {};
            for (const change of changes)
              if (change.type === 'position' && change.position) next[change.id] = change.position;
            return { shape, positions: next };
          });
        }}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onConnect={disabled ? undefined : onConnect}
        isValidConnection={(connection) =>
          canConnectWorkflowTasks(steps, connection.source, connection.target)
        }
        nodesConnectable={!!onConnect && !disabled}
        nodesDraggable={!disabled}
        edgesReconnectable={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.5}
        zoomOnScroll={false}
        preventScrolling={false}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <button
            type="button"
            className="bg-surface border-border text-fg-muted hover:text-fg flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
            onClick={() => {
              setPlacement({ shape, positions: {} });
              requestAnimationFrame(
                () => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }),
              );
            }}
          >
            {i18n.rich('{value1} Arrange', { value1: <Maximize2 className="size-3" /> })}
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function AgentWorkflowCanvas(props: CanvasProps) {
  i18n.useLocale();
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
