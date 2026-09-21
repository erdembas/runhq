import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import {
  parseAccountCooldowns,
  pruneCooldowns,
  reportedLimitFailures,
  startCooldown,
} from '../agents/agentAccountRouting';

const COOLDOWN_KEY = 'preferences:cooldowns';

/**
 * Put an account on cool-down when its provider reports a limit.
 *
 * The only quota signal these CLIs give is a failure they actually returned, so this reacts to a
 * failed session and never to token counts or elapsed time. The account a session already holds is
 * not changed: the cool-down only steers what routing picks next, because provider-native resume
 * belongs to the account that opened the conversation.
 */
export function useAgentAccountCooldowns() {
  useEffect(() => {
    if (!isTauri()) return;
    // One failure is one report. Keyed by when the session reached it, so the same failed task is
    // not counted again on every refresh, while a later limit on the same task still is.
    const recorded = new Set<string>();
    let writing = false;
    const apply = async () => {
      if (writing) return;
      const library = useAgentLibraryStore.getState();
      if (!library.ready) return;
      const now = Date.now();
      const stored = parseAccountCooldowns(library.records[COOLDOWN_KEY]?.value);
      let next = pruneCooldowns(stored, now);
      for (const failure of reportedLimitFailures(
        Object.values(useAgentStore.getState().sessions),
      )) {
        const key = `${failure.sessionId}:${failure.at}`;
        if (recorded.has(key)) continue;
        recorded.add(key);
        next = startCooldown(next, failure.accountId, failure.reason, now);
      }
      if (next === stored) return;
      writing = true;
      try {
        await useAgentLibraryStore
          .getState()
          .save(COOLDOWN_KEY, Object.keys(next).length ? next : null);
      } catch (error) {
        console.error('could not record an account cool-down', error);
      } finally {
        writing = false;
      }
    };
    void apply();
    const unsubscribe = useAgentStore.subscribe((state, previous) => {
      if (state.sessions !== previous.sessions) void apply();
    });
    // An expired cool-down has to disappear on its own, even while nothing else changes.
    const timer = window.setInterval(() => void apply(), 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);
}
