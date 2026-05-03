import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { ipc } from '@/lib/ipc';
import type { AiProvider } from '@/types';

interface Args {
  isOpen: boolean;
  pendingAutoSendPromptRef: MutableRefObject<string | null>;
  pendingAutoSendRef: MutableRefObject<boolean>;
  pickerOpen: boolean;
  pickerRef: RefObject<HTMLDivElement | null>;
  sendRef: RefObject<
    ((overrideText?: string, providerOverride?: AiProvider) => Promise<void>) | null
  >;
  setAwaitingAutoSend: (value: boolean) => void;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setProvider: Dispatch<SetStateAction<AiProvider | null>>;
  setProviderError: (value: string | null) => void;
  setProviders: Dispatch<SetStateAction<AiProvider[]>>;
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
  const reloadProviders = useCallback(async () => {
    try {
      const list = await ipc.listAiProviders();
      setProviders(list);
      setProvider((current) => {
        if (current) {
          const stillExists = list.find((p) => p.id === current.id);
          if (stillExists) return stillExists;
        }
        return list.find((p) => p.default) ?? list[0] ?? null;
      });
      setProviderError(
        list.length === 0 ? 'No AI provider configured. Add one from Settings → AI.' : null,
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
    async (provider: AiProvider) => {
      setProvider(provider);
      setPickerOpen(false);
      if (pendingAutoSendRef.current) {
        pendingAutoSendRef.current = false;
        const prompt = pendingAutoSendPromptRef.current ?? undefined;
        pendingAutoSendPromptRef.current = null;
        setAwaitingAutoSend(false);
        requestAnimationFrame(() => {
          sendRef.current?.(prompt);
        });
      }
      try {
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
