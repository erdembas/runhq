import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { memo, useEffect, useState } from 'react';
import {
  CircleCheck,
  CircleHelp,
  Code2,
  FileCheck2,
  GripVertical,
  LayoutGrid,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  PencilRuler,
  ScanEye,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Background,
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
import { Button } from '@/components/ui/Button';
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
    locked?: boolean;
  },
  'workflowStep'
>;

const roleIcons = {
  plan: PencilRuler,
  implement: Code2,
  review: ScanEye,
  revise: ListChecks,
  validate: FileCheck2,
  shell: Code2,
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
      data-lane={data.lane}
      className={`workflow-step bg-surface text-fg rounded-xl border p-3.5 shadow-md transition-[border-color,box-shadow] ${selected ? 'border-accent ring-accent/15 ring-4' : data.problem || data.lane === 'attention' ? 'border-tone-warning' : 'border-border hover:border-accent/50'}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable && !data.locked}
      />
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
          {i18n.number(data.number, { minimumIntegerDigits: 2 })}
        </span>
        <GripVertical className="text-fg-dim size-3.5" aria-hidden="true" />
      </div>
      <p
        className="line-clamp-2 min-h-9 text-xs leading-[18px] font-medium"
        title={workflowStepTitle(data.step)}
      >
        {workflowStepTitle(data.step)}
      </p>
      <div className="border-border/60 text-fg-dim mt-3 flex items-center gap-2 border-t pt-2.5 text-[10px]">
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
  canConnect?: (source: string, target: string) => boolean;
  onDisconnect?: (source: string, target: string) => void;
  lockedIds?: string[];
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
  canConnect,
  onDisconnect,
  lockedIds = [],
  disabled,
}: CanvasProps) {
  i18n.useLocale();
  const { fitView, zoomIn, zoomOut } = useReactFlow<StepNode>();
  const initialized = useNodesInitialized();
  const shape = JSON.stringify(steps.map((step) => step.id));
  const defaults = useMemo(() => workflowCanvasPositions(steps), [steps]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // React Flow measures custom nodes once. Keep those dimensions when their data changes,
  // otherwise a controlled node becomes hidden until a ResizeObserver fires again.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
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
      locked: lockedIds.includes(step.id),
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
      selected: selectedEdge === `${source}->${step.id}`,
      focusable: !!onDisconnect,
      ariaLabel: i18n.t('Connection from {source} to {target}', {
        source: workflowStepTitle(steps.find((entry) => entry.id === source) ?? step),
        target: workflowStepTitle(step),
      }),
    })),
  );
  const connection = edges.find((edge) => edge.id === selectedEdge);
  return (
    <div className="workflow-canvas min-w-0" aria-label={i18n.t('Workflow map')}>
      <div className="workflow-canvas-viewport">
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
            setPositions((previous) => {
              const next = Object.fromEntries(
                steps.map((step) => [
                  step.id,
                  previous[step.id] ?? defaults[step.id] ?? { x: 0, y: 0 },
                ]),
              );
              for (const change of changes)
                if (change.type === 'position' && change.position)
                  next[change.id] = change.position;
              return next;
            });
          }}
          onNodeClick={(_event, node) => {
            setSelectedEdge(null);
            onSelect(node.id);
          }}
          onEdgeClick={(_event, edge) => setSelectedEdge(edge.id)}
          onEdgesChange={(changes) => {
            for (const change of changes)
              if (change.type === 'select')
                setSelectedEdge((previous) =>
                  change.selected ? change.id : previous === change.id ? null : previous,
                );
          }}
          onPaneClick={() => setSelectedEdge(null)}
          onConnect={disabled ? undefined : onConnect}
          isValidConnection={(connection) =>
            canConnect?.(connection.source, connection.target) ??
            canConnectWorkflowTasks(steps, connection.source, connection.target)
          }
          nodesConnectable={!!onConnect && !disabled}
          nodesDraggable={!disabled}
          snapToGrid
          snapGrid={[20, 20]}
          edgesReconnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.5}
          zoomOnScroll={false}
          preventScrolling={false}
          ariaLabelConfig={{
            'node.a11yDescription.default': i18n.t(
              'Select a step with Enter or Space. Move it with the arrow keys.',
            ),
            'node.a11yDescription.keyboardDisabled': i18n.t('Select a step with Enter or Space.'),
            'node.a11yDescription.ariaLiveMessage': ({ x, y }) =>
              i18n.t('Step moved to x: {x}, y: {y}.', { x: i18n.number(x), y: i18n.number(y) }),
            'edge.a11yDescription.default': i18n.t('Select a connection with Enter or Space.'),
            'handle.ariaLabel': i18n.t('Step connection'),
          }}
        >
          <Background gap={20} size={1} />
          <Panel
            position="bottom-left"
            className="border-border bg-surface flex gap-1 rounded-xl border p-1 shadow-sm"
          >
            {[
              {
                label: i18n.t('Zoom in'),
                Icon: ZoomIn,
                action: () => void zoomIn({ duration: 200 }),
              },
              {
                label: i18n.t('Zoom out'),
                Icon: ZoomOut,
                action: () => void zoomOut({ duration: 200 }),
              },
              {
                label: i18n.t('Fit workflow to view'),
                Icon: Maximize2,
                action: () => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }),
              },
            ].map(({ label, Icon, action }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                aria-label={label}
                title={label}
                onClick={action}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </Panel>
          <Panel position="top-right">
            <Button
              type="button"
              size="sm"
              className="bg-surface rounded-lg shadow-sm"
              leftIcon={<LayoutGrid className="size-3.5" />}
              onClick={() => {
                setPositions({});
                requestAnimationFrame(
                  () => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }),
                );
              }}
            >
              {i18n.t('Arrange steps')}
            </Button>
          </Panel>
          {connection && onDisconnect && (
            <Panel position="top-center">
              <Button
                type="button"
                size="sm"
                className="bg-surface rounded-lg shadow-sm"
                disabled={disabled || lockedIds.includes(connection.target)}
                leftIcon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  onDisconnect(connection.source, connection.target);
                  setSelectedEdge(null);
                }}
              >
                {i18n.t('Remove connection')}
              </Button>
            </Panel>
          )}
        </ReactFlow>
      </div>
      <p className="border-border bg-surface text-fg-dim border-t px-4 py-2.5 text-[11px]">
        {onConnect
          ? i18n.t('Drag steps to arrange them. Connect their ports to set the execution order.')
          : i18n.t('Drag steps to arrange them. Select a step to see its progress.')}
      </p>
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
