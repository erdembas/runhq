import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AiChatProvider } from './aiChatProviders';
import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import {
  canUseChatProvider,
  cliChatProviders,
  isCliChatProvider,
  rememberChatProvider,
  selectedChatProviderId,
} from './aiChatProviders';

interface Args {
  isOpen: boolean;
  pendingAutoSendPromptRef: MutableRefObject<string | null>;
  pendingAutoSendRef: MutableRefObject<boolean>;
  pickerOpen: boolean;
  pickerRef: RefObject<HTMLDivElement | null>;
  sendRef: RefObject<
    ((overrideText?: string, providerOverride?: AiChatProvider) => Promise<void>) | null
  >;
  setAwaitingAutoSend: (value: boolean) => void;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setProvider: Dispatch<SetStateAction<AiChatProvider | null>>;
  setProviderError: (value: string | null) => void;
  setProviders: Dispatch<SetStateAction<AiChatProvider[]>>;
  setProvidersLoaded: (value: boolean) => void;
}

export function useAiProviderPicker({
  isOpen,
  pendingAutoSendPromptRef,
  pendingAutoSendRef,
  pickerOpen,
  pickerRef,
  sendRef,
  setAwaitingAutoSend,
  setPickerOpen,
  setProvider,
  setProviderError,
  setProviders,
  setProvidersLoaded,
}: Args) {
  const tools = useAgentStore((state) => state.tools);
  useEffect(() => {
    const cliProviders = cliChatProviders(tools);
    setProviders((previous) => [
      ...previous.filter((provider) => !isCliChatProvider(provider)),
      ...cliProviders,
    ]);
    setProvider((previous) => {
      if (!previous || !isCliChatProvider(previous)) return previous;
      return (
        cliProviders.find(
          (provider) => provider.id === previous.id && canUseChatProvider(provider),
        ) ?? null
      );
    });
  }, [tools, setProvider, setProviders]);

  const reloadProviders = useCallback(async () => {
    try {
      const [apiResult, cliResult] = await Promise.allSettled([
        ipc.listAiProviders(),
        useAgentStore.getState().refreshTools(),
      ]);
      const list = [
        ...(apiResult.status === 'fulfilled' ? apiResult.value : []),
        ...cliChatProviders(useAgentStore.getState().tools),
      ];
      setProviders(list);
      setProvider((current) => {
        const previousId = current?.id ?? selectedChatProviderId();
        if (previousId) {
          const stillExists = list.find((p) => p.id === previousId && canUseChatProvider(p));
          if (stillExists) return stillExists;
        }
        return (
          list.find((p) => p.default && canUseChatProvider(p)) ??
          list.find(canUseChatProvider) ??
          null
        );
      });
      setProviderError(
        list.some(canUseChatProvider)
          ? null
          : apiResult.status === 'rejected' && cliResult.status === 'rejected'
            ? i18n.t('Could not load AI providers. Reopen the panel to try again.')
            : i18n.t('Connect a CLI in Agent tools or add an API provider in Settings → AI.'),
      );
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : String(e));
    } finally {
      setProvidersLoaded(true);
    }
  }, [setProvider, setProviderError, setProviders, setProvidersLoaded]);

  useEffect(() => {
    if (isOpen) void reloadProviders();
  }, [isOpen, reloadProviders]);

  useEffect(() => {
    if (!pickerOpen) return;
    const cancelAutoSend = () => {
      pendingAutoSendRef.current = false;
      pendingAutoSendPromptRef.current = null;
      setAwaitingAutoSend(false);
    };
    const onDown = (e: MouseEvent) => {
      const node = pickerRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setPickerOpen(false);
        cancelAutoSend();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerOpen(false);
        cancelAutoSend();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [
    pendingAutoSendPromptRef,
    pendingAutoSendRef,
    pickerOpen,
    pickerRef,
    setAwaitingAutoSend,
    setPickerOpen,
  ]);

  const selectProvider = useCallback(
    async (provider: AiChatProvider) => {
      if (!canUseChatProvider(provider)) return;
      rememberChatProvider(provider);
      setProvider(provider);
      setProviderError(null);
      setPickerOpen(false);
      if (pendingAutoSendRef.current) {
        pendingAutoSendRef.current = false;
        const prompt = pendingAutoSendPromptRef.current ?? undefined;
        pendingAutoSendPromptRef.current = null;
        setAwaitingAutoSend(false);
        requestAnimationFrame(() => {
          sendRef.current?.(prompt, provider);
        });
      }
      try {
        if (isCliChatProvider(provider)) return;
        await ipc.setDefaultAiProvider(provider.id);
        setProviders((prev) => prev.map((x) => ({ ...x, default: x.id === provider.id })));
      } catch {
        /* local selection is enough for this session */
      }
    },
    [
      pendingAutoSendPromptRef,
      pendingAutoSendRef,
      sendRef,
      setAwaitingAutoSend,
      setPickerOpen,
      setProvider,
      setProviderError,
      setProviders,
    ],
  );

  const openAiSettingsFromPicker = useCallback(() => {
    setPickerOpen(false);
    pendingAutoSendRef.current = false;
    pendingAutoSendPromptRef.current = null;
    setAwaitingAutoSend(false);
    window.dispatchEvent(new CustomEvent('runhq:open-ai-settings'));
  }, [pendingAutoSendPromptRef, pendingAutoSendRef, setAwaitingAutoSend, setPickerOpen]);

  return { openAiSettingsFromPicker, selectProvider };
}
