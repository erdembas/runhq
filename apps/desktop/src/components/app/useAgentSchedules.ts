import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import {
  agentCapacityPreferences,
  agentCapacityWaitReason,
  agentOccupiedSlots,
} from '../agents/agentCapacity';
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
          blocked: (schedule) => {
            if (!agents.projects.some((project) => project.id === schedule.projectId))
              return 'Project is no longer in the workspace';
            const recipe = record(
              library.records[`recipe:${schedule.recipeId}`]?.value,
              parseRecipe,
            );
            const tool = agents.tools.find((entry) => entry.id === recipe?.backend);
            if (recipe?.backend && !tool?.enabled) return 'The recipe’s tool is disabled';
            // Respect the same execution limits a person starting this task would hit.
            return recipe?.backend
              ? agentCapacityWaitReason(recipe.backend, capacity, occupied)
              : null;
          },
          launch: (input, prompt) =>
            createAgentTaskLauncher({
              create: ipc.agentCreate,
              start: ipc.agentStart,
              created: () => {},
            }).send(input, prompt),
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
    void tick();
    return () => window.clearInterval(timer);
  }, []);
}
