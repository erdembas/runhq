import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useState } from 'react';
import { GripVertical, Layers, Plus, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot } from '@/components/ui/StatusDot';
import { Switch } from '@/components/ui/Switch';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import type { StackDef, Status } from '@/types';

interface Props {
  stack: StackDef | null;
  onClose: () => void;
}

export function StackEditor({ stack, onClose }: Props) {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const upsertStack = useAppStore((s) => s.upsertStack);
  const closeStackEditor = useAppStore((s) => s.closeStackEditor);

  const [name, setName] = useState(stack?.name ?? '');
  const [selectedIds, setSelectedIds] = useState<string[]>(stack?.service_ids ?? []);
  const [autoStart, setAutoStart] = useState(stack?.auto_start ?? false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const unassignedServices = useMemo(
    () => services.filter((s) => !selectedIds.includes(s.id)),
    [services, selectedIds],
  );

  const selectedServices = useMemo(
    () => selectedIds.map((id) => services.find((s) => s.id === id)!).filter(Boolean),
    [selectedIds, services],
  );

  const toggleService = useCallback((svcId: string) => {
    setSelectedIds((prev) =>
      prev.includes(svcId) ? prev.filter((x) => x !== svcId) : [...prev, svcId],
    );
  }, []);

  const removeService = useCallback((svcId: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== svcId));
  }, []);

  const moveItem = useCallback((from: number, to: number) => {
    setSelectedIds((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!name.trim() || selectedIds.length === 0) return;
    setSaving(true);
    try {
      if (stack) {
        const updated: StackDef = {
          ...stack,
          name: name.trim(),
          service_ids: selectedIds,
          auto_start: autoStart,
        };
        await ipc.updateStack(updated);
        upsertStack(updated);
      } else {
        const created = await ipc.addStack({
          name: name.trim(),
          service_ids: selectedIds,
          auto_start: autoStart,
        });
        upsertStack(created);
      }
      closeStackEditor();
    } catch (err) {
      console.error('save stack failed', err);
    } finally {
      setSaving(false);
    }
  };

  const isValid = name.trim().length > 0 && selectedIds.length > 0;

  return (
    <Dialog
      onClose={onClose}
      title={stack ? i18n.t('Edit Stack') : i18n.t('New Stack')}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {i18n.t('Cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!isValid || saving}>
            {saving ? i18n.t('Saving…') : stack ? i18n.t('Save') : i18n.t('Create Stack')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={i18n.t('Stack Name')} hint={i18n.t('A name for this group of services')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={i18n.t('e.g. Full-Stack App')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isValid) handleSave();
            }}
          />
        </Field>

        <Switch
          checked={autoStart}
          onChange={setAutoStart}
          label={i18n.t('Auto-start on app launch')}
          description={i18n.t(
            'Launches every service in this stack automatically when Runner HQ boots.',
          )}
        />

        <Card>
          <CardHeader
            icon={<Layers className="text-accent h-3 w-3" />}
            title={i18n.t('Services in Stack')}
            count={selectedIds.length}
            hint={selectedServices.length > 1 ? i18n.t('Drag to reorder') : undefined}
          />
          {selectedServices.length === 0 ? (
            <div className="text-fg-dim px-4 py-6 text-center text-[11.5px]">
              {i18n.t('Click a service below to add it here.')}
            </div>
          ) : (
            <div className="divide-border divide-y">
              {selectedServices.map((svc, idx) => {
                const st: Status = statuses[svc.id]?.status ?? 'stopped';
                return (
                  <div
                    key={svc.id}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx != null && dragIdx !== idx) moveItem(dragIdx, idx);
                      setDragIdx(null);
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    className={cn(
                      'group hover:bg-surface-muted/50 flex items-center gap-2 px-3 py-2 transition',
                      dragIdx === idx && 'opacity-40',
                    )}
                  >
                    <GripVertical className="text-fg-dim h-3.5 w-3.5 shrink-0 cursor-grab" />
                    <StatusDot status={st} size="sm" />
                    <span className="text-fg min-w-0 flex-1 truncate text-[12.5px] font-medium">
                      {svc.name}
                    </span>
                    {svc.port != null && (
                      <span className="text-accent text-[11px] tabular-nums">:{svc.port}</span>
                    )}
                    <IconButton
                      label={i18n.t('Remove')}
                      icon={<X className="h-3 w-3" />}
                      size="xs"
                      onClick={() => removeService(svc.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={i18n.t('Available Services')} count={unassignedServices.length} />
          {unassignedServices.length === 0 ? (
            <div className="text-fg-dim px-4 py-5 text-center text-[11.5px]">
              {services.length === 0
                ? i18n.t('No services configured yet.')
                : i18n.t('All services are already in this stack.')}
            </div>
          ) : (
            <div className="divide-border max-h-48 divide-y overflow-y-auto">
              {unassignedServices.map((svc) => {
                const st: Status = statuses[svc.id]?.status ?? 'stopped';
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggleService(svc.id)}
                    className="group hover:bg-surface-muted/50 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition"
                  >
                    <StatusDot status={st} size="sm" />
                    <span className="text-fg min-w-0 flex-1 truncate text-[12.5px]">
                      {svc.name}
                    </span>
                    {svc.port != null && (
                      <span className="text-accent text-[11px] tabular-nums">:{svc.port}</span>
                    )}
                    <Plus className="text-fg-dim h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </Dialog>
  );
}

/**
 * Titled panel mirroring the Ports popover: only the header strip carries a
 * solid `surface-muted` fill, while the body stays transparent so it reads as
 * an extension of the dialog background. The border + header strip together
 * do all the "this is a card" work — no darker inset needed, which also keeps
 * light mode readable (where raised == overlay == pure white).
 */
function Card({ children }: { children: React.ReactNode }) {
  i18n.useLocale();
  return <div className="border-border rounded-app-sm overflow-hidden border">{children}</div>;
}

function CardHeader({
  icon,
  title,
  count,
  hint,
}: {
  icon?: React.ReactNode;
  title: string;
  count: number;
  hint?: string;
}) {
  i18n.useLocale();
  return (
    <div className="border-border bg-surface-muted text-fg-dim flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
      <div className="flex items-center gap-1.5">
        {icon}
        <span>{title}</span>
        <span className="tracking-normal normal-case tabular-nums">{count}</span>
      </div>
      {hint && <span className="text-fg-dim text-[10px] tracking-normal normal-case">{hint}</span>}
    </div>
  );
}
