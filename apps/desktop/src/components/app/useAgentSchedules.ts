import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { agentCapacityPreferences, agentOccupiedSlots } from '../agents/agentCapacity';
import {
  chooseAgentAccount,
  isPoolTarget,
  parseAccountCooldowns,
  parseAccountPool,
  resolveAccountPool,
} from '../agents/agentAccountRouting';
import { parseRecipe } from '../agents/agentLibraryModel';
import { agentScheduleTickState, parseSchedule, type AgentSchedule } from '../agents/agentSchedule';
import { runDueSchedules } from '../agents/agentScheduleRunner';
import { createAgentTaskLauncher } from '../agents/agentTaskLauncher';

const TICK_MS = 30_000;
const record = <T>(value: unknown, parse: (value: unknown) => T): T | null => {
  try {
    return parse(value);
  } catch {
    return null;
  }
};

/**
 * Start scheduled recipes while RunHQ is running. There is no background runner: nothing fires
 * while the app is closed, and occurrences missed in the meantime are reported rather than replayed.
 */
export function useAgentSchedules() {
  useEffect(() => {
    if (!isTauri()) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const library = useAgentLibraryStore.getState();
        const agents = useAgentStore.getState();
        const state = agentScheduleTickState({
          libraryReady: library.ready,
          agentsReady: agents.ready,
          toolsReady: agents.toolsReady,
          workspaceError: !!agents.error,
          projectCount: agents.projects.length,
          toolCount: agents.tools.length,
        });
        if (state === 'hydrate') {
          void useAgentLibraryStore.getState().refresh();
          return;
        }
        if (state === 'wait') return;
        const schedules = Object.entries(library.records)
          .filter(([key]) => key.startsWith('schedule:'))
          .map(([, stored]) => record(stored.value, parseSchedule))
          .filter((schedule): schedule is AgentSchedule => !!schedule);
        if (!schedules.length) return;
        const queues = useAgentQueueStore.getState().queues;
        const capacity = agentCapacityPreferences(library.records['preferences:capacity']?.value);
        const occupied = agentOccupiedSlots(agents.sessions, queues);
        await runDueSchedules({
          now: Date.now(),
          schedules,
          recipe: (id) => record(library.records[`recipe:${id}`]?.value, parseRecipe),
          blocked: (schedule) =>
            agents.projects.some((project) => project.id === schedule.projectId)
              ? null
              : 'Project is no longer in the workspace',
          // Whether the recipe names one connection or a pool, the task is created against a single
          // account, and the same signals decide it: capability fit, a reported limit, then load.
          route: (recipe) => {
            const pool = resolveAccountPool(
              recipe.backend,
              (id) => record(library.records[`pool:${id}`]?.value, parseAccountPool),
              (id) => agents.tools.find((tool) => tool.id === id)?.name ?? id,
            );
            if (!pool)
              return {
                accountId: null,
                reason: recipe.backend
                  ? 'The recipe’s account pool was removed'
                  : 'The recipe does not name a connection',
                grounds: '',
                rejected: [],
              };
            return chooseAgentAccount({
              pool,
              accounts: agents.tools.map((tool) => ({
                id: tool.id,
                name: tool.name,
                adapter: tool.adapter ?? '',
                enabled: tool.enabled !== false,
                available: tool.available,
              })),
              need: { plan: recipe.mode === 'plan' },
              cooldowns: parseAccountCooldowns(library.records['preferences:cooldowns']?.value),
              capacity,
              occupied,
              now: Date.now(),
            });
          },
          launch: (input, prompt) =>
            createAgentTaskLauncher({
              create: ipc.agentCreate,
              start: ipc.agentStart,
              created: () => {},
            }).send(input, prompt),
          routed: async (session, choice, recipe) => {
            const pool = isPoolTarget(recipe.backend)
              ? record(
                  library.records[`pool:${recipe.backend.slice('pool:'.length)}`]?.value,
                  parseAccountPool,
                )
              : null;
            await useAgentLibraryStore.getState().save(`routing:${session.id}`, {
              accountId: session.backend,
              accountName:
                agents.tools.find((entry) => entry.id === session.backend)?.name ?? session.backend,
              reason: choice.grounds,
              ...(pool ? { poolName: pool.name } : {}),
              at: Date.now(),
            });
          },
          save: (schedule) =>
            // One schedule per recipe, so the record key is the recipe the editor shows it under.
            useAgentLibraryStore.getState().save(`schedule:${schedule.recipeId}`, schedule),
        });
        await useAgentStore.getState().refresh();
      } catch (error) {
        console.error('scheduled recipes failed', error);
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void tick(), TICK_MS);
    // The first tick usually runs before the workspace has answered, and an overdue schedule should
    // not wait out a whole interval for that. Run again the moment the stores become readable —
    // a window the OS has throttled may not get its next interval for a long time.
    const watchAgents = useAgentStore.subscribe((state, previous) => {
      if (state.ready !== previous.ready || state.toolsReady !== previous.toolsReady) void tick();
    });
    const watchLibrary = useAgentLibraryStore.subscribe((state, previous) => {
      if (state.ready !== previous.ready) void tick();
    });
    void tick();
    return () => {
      window.clearInterval(timer);
      watchAgents();
      watchLibrary();
    };
  }, []);
}
