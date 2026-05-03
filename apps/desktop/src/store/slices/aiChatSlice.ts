import { ipc } from '@/lib/ipc';
import type { AiDraft } from '@/store/appStoreTypes';
import { MAX_OPEN_TABS, saveRightPanel } from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createAiChatSlice: AppStoreSlice = (set) => ({
  activeConversationId: null,
  aiDraft: null,
  openTabs: [],
  setActiveConversation: (id) =>
    set((s) => {
      // Null target → just blank the active id; tabs are user
      // territory (a "new chat" gesture shouldn't yank tabs they
      // explicitly opened from history).
      if (id == null) return { activeConversationId: null };
      if (s.openTabs.includes(id)) {
        return { activeConversationId: id };
      }
      // Insert as a new tab on the right. If we'd overflow the cap,
      // evict the first tab that *isn't* about to become active —
      // FIFO with an "active is sticky" carve-out so we never
      // close the chat the user is currently looking at.
      let next = [...s.openTabs, id];
      if (next.length > MAX_OPEN_TABS) {
        const evictAt = next.findIndex((tabId) => tabId !== id && tabId !== s.activeConversationId);
        if (evictAt >= 0) {
          next.splice(evictAt, 1);
        } else {
          // Fallback: nothing safe to evict (everything is the
          // active or incoming id, which means cap === 1 edge
          // case). Drop the head; the active id is `id` itself,
          // so `s.activeConversationId` losing its slot is fine.
          next = next.slice(1);
        }
      }
      return { activeConversationId: id, openTabs: next };
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.openTabs.indexOf(id);
      if (idx < 0) return s;
      const next = s.openTabs.filter((t) => t !== id);
      if (s.activeConversationId !== id) {
        return { openTabs: next };
      }
      // Closing the active tab → snap to the neighbour. We prefer
      // the tab that took the closing tab's slot (idx in `next`),
      // falling back to the previous one. This matches VSCode's
      // editor-tab close behaviour and keeps the user's mental
      // model intact: closing tab N puts you on the new tab N
      // (the one that just shifted left), or on N-1 if N was the
      // last tab.
      const fallback = next[idx] ?? next[idx - 1] ?? null;
      return { openTabs: next, activeConversationId: fallback };
    }),
  closeOtherTabs: (keepId) =>
    set((s) => {
      if (!s.openTabs.includes(keepId)) return s;
      // No work needed if the kept tab is already the only one —
      // returning a fresh array would force a re-render for nothing.
      if (s.openTabs.length === 1) return s;
      return { openTabs: [keepId], activeConversationId: keepId };
    }),
  closeTabsToRight: (id) =>
    set((s) => {
      const idx = s.openTabs.indexOf(id);
      if (idx < 0) return s;
      // Already the rightmost tab — nothing to close.
      if (idx === s.openTabs.length - 1) return s;
      const next = s.openTabs.slice(0, idx + 1);
      if (s.activeConversationId == null || next.includes(s.activeConversationId)) {
        return { openTabs: next };
      }
      // The active tab lived in the closed range; snap to the
      // anchor tab so the user lands on a sensible neighbour
      // instead of an empty rail.
      return { openTabs: next, activeConversationId: id };
    }),
  closeAllTabs: () => set({ openTabs: [], activeConversationId: null }),
  clearAiDraft: () => set({ aiDraft: null }),
  openAiChat: async (input) => {
    // Step 1: persist the conversation row first. We need the id
    // so the panel can rehydrate the right rows on activation —
    // even if the user closes the rail before sending.
    let conversationId: string;
    try {
      conversationId = await ipc.createConversation({
        title: input.title.slice(0, 200),
        origin: input.origin,
        context_json: input.context ? JSON.stringify(input.context) : null,
      });
    } catch (e) {
      // Store-side errors should never be silent — surface in
      // console for now; a toast layer can pick this up later.
      console.error('openAiChat: failed to create conversation', e);
      return null;
    }

    const draft: AiDraft = {
      conversationId,
      draftPrompt: input.draftPrompt,
      contextSystemMessage: input.contextSystemMessage,
      actionHook: input.actionHook ?? { kind: 'none' },
      autoSend: input.autoSend ?? false,
      forcedProviderId: input.forcedProviderId,
    };

    // Stash draft + active id + open the panel atomically. Doing
    // them in one set() prevents the panel from waking up between
    // states (e.g. `activeConversationId` set but `aiDraft` still
    // null would show the empty conversation for a frame).
    //
    // Tab insertion mirrors `setActiveConversation`: append to the
    // right; FIFO-evict the oldest non-active, non-incoming tab if
    // we'd overflow the cap. We can't just call the action here
    // because we also need to write `aiDraft` and `rightPanel` in
    // the same set() — splitting them would race with the panel's
    // mount effect.
    saveRightPanel('ai');
    set((s) => {
      let openTabs = s.openTabs;
      if (!openTabs.includes(conversationId)) {
        const next = [...openTabs, conversationId];
        if (next.length > MAX_OPEN_TABS) {
          const evictAt = next.findIndex(
            (tabId) => tabId !== conversationId && tabId !== s.activeConversationId,
          );
          if (evictAt >= 0) {
            next.splice(evictAt, 1);
          } else {
            next.shift();
          }
        }
        openTabs = next;
      }
      return {
        aiDraft: draft,
        activeConversationId: conversationId,
        rightPanel: 'ai',
        openTabs,
      };
    });
    return conversationId;
  },
});
