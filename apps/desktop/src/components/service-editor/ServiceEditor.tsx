import { useCallback, useEffect, useMemo, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Settings, Terminal, Variable } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Tabs, type Tab } from '@/components/ui/Tabs';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { ServiceDef } from '@/types';
import { NODE_PACKAGE_MANAGERS, type NodePackageManager } from './types';
import { EnvEditor } from './EnvEditor';
import { ServiceAdvancedTab } from './ServiceAdvancedTab';
import { ServiceGeneralTab } from './ServiceGeneralTab';
import {
  useServiceEditorStore,
  useServiceEditorStoreRef,
  type TabKey,
} from './useServiceEditorStore';

interface Props {
  service: ServiceDef | null;
  onClose: () => void;
}

export function ServiceEditor({ service, onClose }: Props) {
  const store = useServiceEditorStoreRef(service);
  const form = useServiceEditorStore(store, (state) => state);
  const patch = form.patch;
  const detectedPackageManager = form.detected?.package_manager;
  const selectedPm = form.selectedPm;
  const rewritePackageManagerCommands = form.rewritePackageManagerCommands;
  const cwd = form.cwd;
  const nameManuallyEdited = useRef(service !== null);
  const isEdit = service !== null;
  const prevPmRef = useRef<NodePackageManager>(selectedPm);

  useEffect(() => {
    if (isEdit) return;
    if (
      detectedPackageManager &&
      NODE_PACKAGE_MANAGERS.includes(detectedPackageManager as NodePackageManager)
    ) {
      const pm = detectedPackageManager as NodePackageManager;
      patch({ selectedPm: pm });
      prevPmRef.current = pm;
    }
  }, [detectedPackageManager, isEdit, patch]);

  useEffect(() => {
    const prev = prevPmRef.current;
    if (prev === selectedPm) return;
    prevPmRef.current = selectedPm;
    rewritePackageManagerCommands(selectedPm);
  }, [rewritePackageManagerCommands, selectedPm]);

  const upsertService = useAppStore((s) => s.upsertService);
  const setSelected = useAppStore((s) => s.setSelected);

  const tabs = useMemo<Tab<TabKey>[]>(
    () => [
      { key: 'general', label: 'General', icon: <Terminal className="h-3 w-3" /> },
      {
        key: 'env',
        label: 'Environment',
        icon: <Variable className="h-3 w-3" />,
        badge: form.envRows.length ? (
          // `surface-muted` reads as a clear "chip on the dialog body" — the
          // previous `surface-overlay` matched the body exactly and the
          // count was effectively invisible.
          <span className="bg-surface-muted text-fg-muted rounded-app-sm ml-1 px-1 text-[9px]">
            {form.envRows.length}
          </span>
        ) : undefined,
      },
      { key: 'advanced', label: 'Advanced', icon: <Settings className="h-3 w-3" /> },
    ],
    [form.envRows.length],
  );

  const chooseDir = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') patch({ cwd: picked });
  };

  useEffect(() => {
    if (!cwd.trim()) {
      patch({ detected: null, detecting: false });
      return;
    }
    const path = cwd.trim();
    patch({ detecting: true });
    const handle = setTimeout(async () => {
      try {
        const result = await ipc.detectProject(path);
        const currentName = store.getState().name;
        patch({
          detected: result,
          ...(result && !nameManuallyEdited.current && !currentName.trim()
            ? { name: result.name }
            : {}),
        });
      } catch {
        patch({ detected: null });
      } finally {
        patch({ detecting: false });
      }
    }, 350);
    return () => {
      clearTimeout(handle);
      patch({ detecting: false });
    };
  }, [cwd, patch, store]);

  const submit = useCallback(async () => {
    const state = store.getState();
    state.patch({ error: null });
    const validCmds = state.cmds.filter((c) => c.cmd.trim() && c.name.trim());
    if (!state.name.trim() || !state.cwd.trim() || validCmds.length === 0) {
      state.patch({
        error: 'Name, folder, and at least one command are all required.',
        tab: 'general',
      });
      return;
    }
    const parsedPort = state.port.trim() ? Number(state.port) : null;
    if (parsedPort !== null && (!Number.isFinite(parsedPort) || parsedPort <= 0)) {
      state.patch({ error: 'Port must be a positive number.', tab: 'general' });
      return;
    }
    const parsedGrace = Number(state.graceMs);
    if (!Number.isFinite(parsedGrace) || parsedGrace < 0) {
      state.patch({ error: 'Grace period must be zero or greater.', tab: 'advanced' });
      return;
    }

    const env: Array<[string, string]> = state.envRows
      .filter((r) => r.key.trim())
      .map((r) => [r.key.trim(), r.value]);

    const pathVal = state.pathOverride.trim() || null;
    const preVal = state.preCommand.trim() || null;

    state.patch({ saving: true });
    try {
      let saved: ServiceDef;
      if (isEdit && service) {
        saved = await ipc.updateService({
          ...service,
          name: state.name.trim(),
          cwd: state.cwd.trim(),
          cmds: validCmds,
          env,
          path_override: pathVal,
          pre_command: preVal,
          port: parsedPort,
          tags: state.tags,
          auto_start: state.autoStart,
          hide_dashboard: state.hideDashboard,
          grace_ms: Math.round(parsedGrace),
        });
      } else {
        saved = await ipc.addService({
          name: state.name.trim(),
          cwd: state.cwd.trim(),
          cmds: validCmds,
          env,
          path_override: pathVal,
          pre_command: preVal,
          port: parsedPort,
          tags: state.tags,
          auto_start: state.autoStart,
          hide_dashboard: state.hideDashboard,
          grace_ms: Math.round(parsedGrace),
        });
      }
      upsertService(saved);
      setSelected(saved.id);
      onClose();
    } catch (err) {
      state.patch({ error: String(err) });
    } finally {
      store.getState().patch({ saving: false });
    }
  }, [isEdit, onClose, service, setSelected, store, upsertService]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submit]);

  return (
    <Dialog
      title={isEdit ? `Edit service — ${service.name}` : 'Add service'}
      subtitle={isEdit ? service.id : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {form.error && (
            <span className="text-status-error mr-auto text-[10px]">{form.error}</span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={form.saving} onClick={() => void submit()}>
            {form.saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create service'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs<TabKey>
          tabs={tabs}
          value={form.tab}
          onChange={(tab) => patch({ tab })}
          className="self-start"
        />

        {form.tab === 'general' && (
          <ServiceGeneralTab
            form={form}
            patch={patch}
            onChooseDir={() => void chooseDir()}
            onNameChange={(name) => {
              nameManuallyEdited.current = true;
              patch({ name });
            }}
          />
        )}

        {form.tab === 'env' && (
          <EnvEditor rows={form.envRows} setRows={(envRows) => patch({ envRows })} />
        )}

        {form.tab === 'advanced' && <ServiceAdvancedTab form={form} patch={patch} />}
      </div>
    </Dialog>
  );
}
