import { Play, RotateCcw, Square } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { isRunning, type FilterMode, type ListItem, type ServiceCmd } from '../types';
import type { ServiceDef, ServiceId, StackDef } from '@/types';

interface StackItemDeps {
  query: string;
  services: ServiceDef[];
  getCmds: (svc: ServiceDef) => ServiceCmd[];
}

export function buildExpandedStackItems(stack: StackDef, deps: StackItemDeps): ListItem[] {
  const q = deps.query.trim().toLowerCase();
  const stackServices = stack.service_ids
    .map((sid) => deps.services.find((s) => s.id === sid))
    .filter(Boolean) as ServiceDef[];
  const cmdsPerService: Record<ServiceId, ServiceCmd[]> = {};
  let stackRunning = 0;
  for (const svc of stackServices) {
    const cmds = deps.getCmds(svc);
    cmdsPerService[svc.id] = cmds;
    if (cmds.some((c) => isRunning(c.status))) stackRunning++;
  }
  const anyRunning = stackRunning > 0;

  const result: ListItem[] = [
    { type: 'expanded-stack', stack, services: stackServices, cmdsPerService },
  ];
  const stackActions: ListItem[] = [
    {
      type: 'stack-action',
      stackId: stack.id,
      label: anyRunning ? 'Stop All' : 'Start All',
      icon: anyRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />,
      danger: anyRunning,
      run: async () => {
        if (anyRunning) await ipc.stopStack(stack.id);
        else await ipc.startStack(stack.id);
      },
    },
    {
      type: 'stack-action',
      stackId: stack.id,
      label: 'Restart All',
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      run: async () => {
        await ipc.restartStack(stack.id);
      },
    },
  ];

  const svcRows: ListItem[] = stackServices.map((svc) => {
    const cmds = cmdsPerService[svc.id] ?? [];
    const svcRunning = cmds.some((c) => isRunning(c.status));
    return {
      type: 'sub-action',
      serviceId: svc.id,
      label: svc.name,
      icon: svcRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />,
      danger: svcRunning,
      run: async () => {
        if (svcRunning) await ipc.stopService(svc.id);
        else await ipc.startService(svc.id);
      },
    };
  });

  const filtered = q
    ? [...stackActions, ...svcRows].filter((a) => {
        if (a.type === 'stack-action') return a.label.toLowerCase().includes(q);
        if (a.type === 'sub-action') return a.label.toLowerCase().includes(q);
        return true;
      })
    : [...stackActions, ...svcRows];
  result.push(...filtered);
  return result;
}

export function buildRootStackItems(args: {
  query: string;
  filter: FilterMode;
  stacks: StackDef[];
  services: ServiceDef[];
  getCmds: (svc: ServiceDef) => ServiceCmd[];
}): ListItem[] {
  if (args.filter !== 'all' && args.filter !== 'running' && args.filter !== 'stopped') return [];
  const q = args.query.trim().toLowerCase();
  const stackItems: ListItem[] = [];
  for (const stack of args.stacks) {
    let stackRunning = 0;
    const stackServices = stack.service_ids
      .map((sid) => args.services.find((s) => s.id === sid))
      .filter(Boolean) as ServiceDef[];
    for (const svc of stackServices) {
      const cmds = args.getCmds(svc);
      if (cmds.some((c) => isRunning(c.status))) stackRunning++;
    }
    if (args.filter === 'running' && stackRunning === 0) continue;
    if (args.filter === 'stopped' && stackRunning > 0) continue;
    if (q && !stack.name.toLowerCase().includes(q)) continue;
    stackItems.push({ type: 'stack', stack, runningCount: stackRunning });
  }
  return stackItems.length > 0 ? [{ type: 'header', label: 'Stacks' }, ...stackItems] : [];
}
