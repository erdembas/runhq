/**
 * Scheduled recipe runs. RunHQ does not execute anything while it is closed, so a schedule is a
 * statement about when to start work *while RunHQ is running*, never a promise of background
 * execution. Missed occurrences are reported and collapsed into a single run rather than replayed.
 */
export type AgentCadence =
  | { kind: 'interval'; hours: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; day: number; time: string };

export interface AgentSchedule {
  id: string;
  recipeId: string;
  projectId: string;
  cadence: AgentCadence;
  enabled: boolean;
  /** Filled in by the runner, never by the editor. */
  lastRunAt?: number;
  lastOutcome?: string;
  /** Creation id reserved before launching, so a retry after a crash cannot duplicate the task. */
  pendingCreationId?: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MAX_INTERVAL_HOURS = 24 * 14;

export function parseCadence(value: unknown): AgentCadence {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (raw.kind === 'interval') {
    const hours = raw.hours;
    if (!Number.isInteger(hours) || (hours as number) < 1 || (hours as number) > MAX_INTERVAL_HOURS)
      throw new Error('Choose an interval between 1 hour and 14 days');
    return { kind: 'interval', hours: hours as number };
  }
  if (raw.kind === 'daily' || raw.kind === 'weekly') {
    if (typeof raw.time !== 'string' || !TIME.test(raw.time))
      throw new Error('Enter a time as HH:MM');
    if (raw.kind === 'daily') return { kind: 'daily', time: raw.time };
    if (!Number.isInteger(raw.day) || (raw.day as number) < 0 || (raw.day as number) > 6)
      throw new Error('Choose a weekday');
    return { kind: 'weekly', day: raw.day as number, time: raw.time };
  }
  throw new Error('Choose how often this recipe should run');
}

export function parseSchedule(value: unknown): AgentSchedule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  for (const field of ['id', 'recipeId', 'projectId'])
    if (typeof raw[field] !== 'string' || !(raw[field] as string).trim())
      throw new Error(`A schedule needs ${field}`);
  if (typeof raw.enabled !== 'boolean') throw new Error('Invalid schedule state');
  return {
    id: raw.id as string,
    recipeId: raw.recipeId as string,
    projectId: raw.projectId as string,
    cadence: parseCadence(raw.cadence),
    enabled: raw.enabled,
    ...(typeof raw.lastRunAt === 'number' ? { lastRunAt: raw.lastRunAt } : {}),
    ...(typeof raw.lastOutcome === 'string' ? { lastOutcome: raw.lastOutcome } : {}),
    ...(typeof raw.pendingCreationId === 'string'
      ? { pendingCreationId: raw.pendingCreationId }
      : {}),
  };
}

const atTime = (from: Date, time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

/** The first occurrence strictly after `after`. Local time, so it follows the user's clock. */
export function nextScheduledRun(cadence: AgentCadence, after: number): number {
  const from = new Date(after);
  if (cadence.kind === 'interval') return after + cadence.hours * 3_600_000;
  let next = atTime(from, cadence.time);
  if (next.getTime() <= after) next.setDate(next.getDate() + 1);
  if (cadence.kind === 'weekly') {
    const shift = (cadence.day - next.getDay() + 7) % 7;
    if (shift) next = new Date(next.getTime() + shift * 86_400_000);
  }
  return next.getTime();
}

export interface AgentScheduleWorkspace {
  /** Saved recipes and schedules have been read from the workspace at least once. */
  libraryReady: boolean;
  /** Projects and sessions have been read at least once. */
  agentsReady: boolean;
  /** Connections have been probed at least once. */
  toolsReady: boolean;
  /** The last workspace read failed, so its contents say nothing about what exists. */
  workspaceError: boolean;
  projectCount: number;
  toolCount: number;
}

/**
 * What a tick may do with what it currently knows.
 *
 * `hydrate` asks for the library again: a failed first read otherwise leaves it unready for the
 * rest of the session and silently stops every schedule until someone opens the Library screen.
 *
 * `wait` covers a workspace that has not answered yet or whose read failed. An empty store is not
 * evidence that a project was removed or a connection disabled, and the runner records a blocked
 * occurrence as run — so judging a schedule too early swallows it for a whole cadence.
 */
export function agentScheduleTickState(
  workspace: AgentScheduleWorkspace,
): 'hydrate' | 'wait' | 'run' {
  if (!workspace.libraryReady) return 'hydrate';
  if (!workspace.agentsReady || !workspace.toolsReady || workspace.workspaceError) return 'wait';
  if (!workspace.projectCount || !workspace.toolCount) return 'wait';
  return 'run';
}

export interface AgentScheduleDecision {
  schedule: AgentSchedule;
  due: boolean;
  /** How many occurrences passed unrun; they are collapsed into one run, never replayed. */
  missed: number;
  reason: string | null;
}

/**
 * Decide what a tick should do. A schedule that has never run does not fire immediately: it waits
 * for its next occurrence, so enabling one never launches work the user did not expect right then.
 */
export function scheduleDecision(
  schedule: AgentSchedule,
  now: number,
  blocked?: (schedule: AgentSchedule) => string | null,
): AgentScheduleDecision {
  const idle = { schedule, due: false, missed: 0 };
  if (!schedule.enabled) return { ...idle, reason: 'Paused' };
  const since = schedule.lastRunAt ?? now;
  let next = nextScheduledRun(schedule.cadence, since);
  if (next > now) return { ...idle, reason: null };
  let missed = 0;
  while (next <= now) {
    missed += 1;
    next = nextScheduledRun(schedule.cadence, next);
  }
  const reason = blocked?.(schedule) ?? null;
  return { schedule, due: !reason, missed: missed - 1, reason };
}

export function describeCadence(cadence: AgentCadence): string {
  if (cadence.kind === 'interval')
    return cadence.hours === 1 ? 'Every hour' : `Every ${cadence.hours} hours`;
  if (cadence.kind === 'daily') return `Every day at ${cadence.time}`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `Every ${days[cadence.day]} at ${cadence.time}`;
}
