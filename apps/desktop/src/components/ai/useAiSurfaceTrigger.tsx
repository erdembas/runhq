import { type ReactNode, type RefObject, useCallback, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore, type OpenAiChatInput } from '@/store/useAppStore';
import type { AiProvider } from '@/types';
import { ModelChooserPopover } from './ModelChooserPopover';

/**
 * Inputs to `useAiSurfaceTrigger`. The hook builds the chat payload
 * lazily at click-time so call sites can capture freshest UI state
 * (selected log line, current diff, project state) instead of
 * baking it into the closure once at mount.
 */
interface UseAiSurfaceTriggerOptions {
  /** Lazy builder for the openAiChat payload. Called once per click.
   *  May be sync or async — async builders unlock surfaces that
   *  need an IPC round-trip first (e.g. CommitPanel fetching the
   *  staged diff before composing the prompt). The hook always
   *  pins `autoSend: true` and threads `forcedProviderId` through,
   *  so the returned object should NOT set those fields. Returning
   *  `null`/`undefined` cancels the dispatch silently — handy for
   *  guarded states (no staged changes, empty diff). */
  buildPayload: () =>
    | Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId'>
    | null
    | undefined
    | Promise<Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId'> | null | undefined>;
}

interface AiSurfaceTrigger<T extends HTMLElement> {
  /** Wire onto the trigger element via `ref`. Used to anchor the
   *  popover so it floats directly under the button the user
   *  pressed. Typed as `RefObject<T>` (not `T | null`) so JSX
   *  accepts it directly without a cast — the underlying
   *  useRef-with-null is invariant-safe via the cast inside the
   *  hook body. */
  triggerRef: RefObject<T>;
  /** Click handler for the trigger element. Branches on configured
   *  provider count: 0 → open panel (which surfaces the "configure
   *  one" banner), 1 → fire openAiChat with that provider, 2+ →
   *  open the surface popover anchored to `triggerRef`. */
  onClick: () => void;
  /** Render slot for the popover. Always render this in the JSX next
   *  to the trigger; the hook decides whether the popover is
   *  actually visible (it portals to body when shown). */
  popover: ReactNode;
}

/**
 * Surface-level AI trigger primitive.
 *
 * Replaces the old "send the user to the chat panel and let *it*
 * ask which model" flow. The new UX:
 *
 *   • 0 providers configured → open the panel anyway; its empty-
 *     state banner already directs the user to AI Settings.
 *   • 1 provider configured → fire the chat directly, prompt is
 *     dispatched on arrival in the panel (no second confirmation).
 *   • 2+ providers configured → open a small popover under the
 *     trigger button. The user picks; the panel opens and starts
 *     streaming against the picked provider in one motion.
 *
 * Call sites get a clean, drop-in API:
 *
 * ```tsx
 * const { triggerRef, onClick, popover } = useAiSurfaceTrigger({
 *   buildPayload: () => buildWhyChatPayload(meta),
 * });
 * return (
 *   <>
 *     <button ref={triggerRef} onClick={onClick}>Why?</button>
 *     {popover}
 *   </>
 * );
 * ```
 */
export function useAiSurfaceTrigger<T extends HTMLElement = HTMLElement>({
  buildPayload,
}: UseAiSurfaceTriggerOptions): AiSurfaceTrigger<T> {
  const openAiChat = useAppStore((s) => s.openAiChat);
  const triggerRef = useRef<T>(null) as RefObject<T>;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [providers, setProviders] = useState<AiProvider[] | null>(null);

  // We re-fetch the provider list at every click so newly added /
  // deleted models are reflected without a refresh — the IPC is a
  // single SQL row read, costs nothing. The first click pays the
  // round-trip latency before the popover opens (a few ms locally),
  // subsequent clicks open instantly because providers are cached
  // in state and re-fetched in the background to catch updates.
  const fetchProviders = useCallback(async (): Promise<AiProvider[]> => {
    try {
      const list = await ipc.listAiProviders();
      setProviders(list);
      return list;
    } catch {
      // Treat IPC failure as "no providers" — the panel surfaces a
      // sensible error from its own retry. Better than blocking the
      // user's click on a transient blip.
      setProviders([]);
      return [];
    }
  }, []);

  // Hold latest payload-builder + dispatch in refs so the click
  // handler doesn't need to re-bind every time the parent re-renders
  // the buildPayload closure. Otherwise outside-click listeners
  // would re-attach on every parent state tick.
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;

  // Async payload support: a slow `buildPayload` (e.g. fetching
  // the staged diff over IPC) shouldn't block the popover from
  // appearing for multi-model setups. Strategy:
  //   • Multi-model path: open the popover immediately, kick off
  //     buildPayload in parallel, then dispatch when both the user
  //     pick AND the payload are ready.
  //   • Single-model / no-model path: fetch payload, then fire.
  // The pending payload promise lives in a ref so we can await it
  // again on selection without re-running buildPayload.
  const pendingPayloadRef = useRef<Promise<
    Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId'> | null | undefined
  > | null>(null);

  const dispatch = useCallback(
    async (forced?: AiProvider) => {
      const promise = pendingPayloadRef.current ?? Promise.resolve(buildPayloadRef.current());
      pendingPayloadRef.current = null;
      const payload = await promise;
      if (!payload) return;
      void openAiChat({
        ...payload,
        autoSend: true,
        forcedProviderId: forced?.id,
      });
    },
    [openAiChat],
  );

  const onClick = useCallback(async () => {
    const list = providers ?? (await fetchProviders());
    if (list.length <= 1) {
      // 0 or 1 providers — fire payload + dispatch sequentially.
      // For zero providers we still open the panel (with payload)
      // so the user lands on the empty-state banner. For one, we
      // pin that provider so the panel skips the in-panel picker.
      void dispatch(list.length === 1 ? list[0] : undefined);
      return;
    }
    // Multi-model: kick off payload prep in the background so the
    // user's click feels instant — popover opens right away. By
    // the time they pick a model the IPC will usually be done.
    pendingPayloadRef.current = Promise.resolve(buildPayloadRef.current());
    // Refresh in background while the popover is up so a model
    // added between clicks shows up without dismiss-and-retry.
    void fetchProviders();
    setPopoverOpen(true);
  }, [providers, fetchProviders, dispatch]);

  const handleSelect = useCallback(
    (p: AiProvider) => {
      setPopoverOpen(false);
      void dispatch(p);
    },
    [dispatch],
  );

  const handleDismiss = useCallback(() => {
    setPopoverOpen(false);
    // Drop the in-flight payload promise — the user backed out, no
    // sense holding onto a stale capture if they click again later
    // (the next click will re-build with fresh state).
    pendingPayloadRef.current = null;
  }, []);

  const popover = popoverOpen ? (
    <ModelChooserPopover
      anchorRef={triggerRef}
      providers={providers ?? []}
      onSelect={handleSelect}
      onDismiss={handleDismiss}
    />
  ) : null;

  return { triggerRef, onClick, popover };
}
