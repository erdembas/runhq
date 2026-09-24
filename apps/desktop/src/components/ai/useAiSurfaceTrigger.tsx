import { type ReactNode, type RefObject, useCallback, useRef, useState } from 'react';
import { useAppStore, type OpenAiChatInput } from '@/store/useAppStore';
import { canUseChatProvider, type AiChatProvider } from './chat-panel/aiChatProviders';
import { aiGenerationSettings } from '@/lib/ai/aiGenerationSettings';
import { configuredAiProvider } from '@/lib/ai/aiPreferences';
import { loadAiProviders } from '@/lib/ai/loadAiProviders';
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
    | Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId' | 'forcedModel' | 'forcedSettings'>
    | null
    | undefined
    | Promise<
        | Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId' | 'forcedModel' | 'forcedSettings'>
        | null
        | undefined
      >;
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
 *   • A saved use-case/default selection → send directly with its model.
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
  const [providers, setProviders] = useState<AiChatProvider[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const fetchProviders = useCallback(async () => {
    const list = await loadAiProviders();
    setProviders(list.filter(canUseChatProvider));
    return list;
  }, []);

  // Hold latest payload-builder + dispatch in refs so the click
  // handler doesn't need to re-bind every time the parent re-renders
  // the buildPayload closure. Otherwise outside-click listeners
  // would re-attach on every parent state tick.
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;

  // Keep the prepared evidence while the user chooses a provider. Resolve the
  // use-case preference from the payload's origin before deciding to show a picker.
  const pendingPayloadRef = useRef<Promise<
    | Omit<OpenAiChatInput, 'autoSend' | 'forcedProviderId' | 'forcedModel' | 'forcedSettings'>
    | null
    | undefined
  > | null>(null);

  const dispatch = useCallback(
    async (forced?: AiChatProvider) => {
      const promise = pendingPayloadRef.current ?? Promise.resolve(buildPayloadRef.current());
      pendingPayloadRef.current = null;
      const payload = await promise;
      if (!payload) return;
      void openAiChat({
        ...payload,
        autoSend: true,
        forcedProviderId: forced?.id,
        forcedModel: forced?.model,
        forcedSettings: forced ? aiGenerationSettings(forced) : undefined,
      });
    },
    [openAiChat],
  );

  const onClick = useCallback(async () => {
    setError(null);
    try {
      const [list, payload] = await Promise.all([fetchProviders(), buildPayloadRef.current()]);
      if (!payload) return;
      pendingPayloadRef.current = Promise.resolve(payload);
      const configured = configuredAiProvider(list, payload.origin);
      const available = list.filter(canUseChatProvider);
      if (configured || available.length <= 1) {
        await dispatch(configured ?? available[0]);
        return;
      }
      setPopoverOpen(true);
    } catch (error) {
      pendingPayloadRef.current = null;
      setError(String(error instanceof Error ? error.message : error));
    }
  }, [fetchProviders, dispatch]);

  const handleSelect = useCallback(
    (p: AiChatProvider) => {
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
  ) : error ? (
    <span role="alert" className="text-[11px] text-rose-400">
      {error}
    </span>
  ) : null;

  return { triggerRef, onClick, popover };
}
