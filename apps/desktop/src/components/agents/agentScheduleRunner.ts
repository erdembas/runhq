import type { AgentSession, CreateAgentSession } from '@runhq/cockpit-types';
import { scheduleDecision, type AgentSchedule } from './agentSchedule';
import type { AgentAccountChoice } from './agentAccountRouting';
import type { AgentRecipe } from './agentLibraryModel';

export interface AgentScheduleRun {
  schedule: AgentSchedule;
  outcome: string;
  ranAt: number;
}

/**
 * Start the recipes whose time has come. Everything that can stop a run is decided before anything
 * is created, and every schedule is written back with what happened so a run is never silent.
 */
export async function runDueSchedules(deps: {
  now: number;
  schedules: AgentSchedule[];
  recipe: (id: string) => AgentRecipe | null;
  /** Why this schedule cannot run right now, in the user's words, or null when it can. */
  blocked: (schedule: AgentSchedule) => string | null;
  /**
   * The connection this recipe should start on. A recipe may target a single connection or a pool
   * of interchangeable accounts; either way the task is created against one concrete account, so
   * the session keeps the identity that opened it.
   */
  route: (recipe: AgentRecipe) => AgentAccountChoice;
  launch: (input: CreateAgentSession, prompt: string, creationId: string) => Promise<AgentSession>;
  save: (schedule: AgentSchedule) => Promise<void>;
}): Promise<AgentScheduleRun[]> {
  const runs: AgentScheduleRun[] = [];
  for (const schedule of deps.schedules) {
    const decision = scheduleDecision(schedule, deps.now, deps.blocked);
    if (!decision.due) {
      // Record a blocked occurrence so the next tick does not treat it as still overdue.
      if (decision.reason && decision.reason !== 'Paused' && decision.missed >= 0) {
        const skipped = { ...schedule, lastRunAt: deps.now, lastOutcome: decision.reason };
        await deps.save(skipped);
        runs.push({ schedule: skipped, outcome: decision.reason, ranAt: deps.now });
      }
      continue;
    }
    const recipe = deps.recipe(schedule.recipeId);
    if (!recipe) {
      const missing = { ...schedule, enabled: false, lastOutcome: 'Recipe was removed' };
      await deps.save(missing);
      runs.push({ schedule: missing, outcome: 'Recipe was removed', ranAt: deps.now });
      continue;
    }
    // Route before reserving anything: an occurrence that cannot reach an account records why, the
    // same way a blocked one does, instead of creating a task with no place to run.
    const choice = deps.route(recipe);
    if (!choice.accountId) {
      const unrouted = { ...schedule, lastRunAt: deps.now, lastOutcome: choice.reason };
      await deps.save(unrouted);
      runs.push({ schedule: unrouted, outcome: choice.reason, ranAt: deps.now });
      continue;
    }
    // Reserve the creation id before any IPC: a retry after a lost acknowledgement then reuses it
    // instead of creating a second task.
    const creationId = schedule.pendingCreationId ?? crypto.randomUUID();
    const reserved = { ...schedule, pendingCreationId: creationId };
    await deps.save(reserved);
    const missedNote = decision.missed
      ? ` (${decision.missed} earlier ${decision.missed === 1 ? 'run was' : 'runs were'} missed while RunHQ was closed)`
      : '';
    try {
      const session = await deps.launch(
        {
          creation_request_id: creationId,
          project_id: schedule.projectId,
          backend: choice.accountId,
          executable: '',
          title: recipe.name,
          model: recipe.model,
          effort: recipe.effort,
          mode: recipe.mode,
          agent: recipe.agent,
          isolated: recipe.isolated,
        },
        recipe.prompt,
        creationId,
      );
      const routed = choice.reason ? ` · ${choice.reason}` : '';
      const outcome = `Started ${session.title}${routed}${missedNote}`;
      const done = {
        ...reserved,
        lastRunAt: deps.now,
        lastOutcome: outcome,
        pendingCreationId: undefined,
      };
      await deps.save(done);
      runs.push({ schedule: done, outcome, ranAt: deps.now });
    } catch (error) {
      // Keep the reserved id: the next attempt continues the same creation rather than duplicating.
      const outcome = `Could not start: ${String(error)}`;
      const failed = { ...reserved, lastRunAt: deps.now, lastOutcome: outcome };
      await deps.save(failed);
      runs.push({ schedule: failed, outcome, ranAt: deps.now });
    }
  }
  return runs;
}
