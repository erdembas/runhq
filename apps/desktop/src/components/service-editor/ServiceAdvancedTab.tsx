import { Route, Terminal } from 'lucide-react';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import type { ServiceEditorStore } from '@/components/service-editor/useServiceEditorStore';

interface ServiceAdvancedTabProps {
  form: ServiceEditorStore;
  patch: ServiceEditorStore['patch'];
}

export function ServiceAdvancedTab({ form, patch }: ServiceAdvancedTabProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field
        label="PATH override"
        hint="Directories prepended to $PATH before spawning. Use : to separate multiple paths."
        className="md:col-span-2"
      >
        <div className="flex items-center gap-1.5">
          <Route className="text-fg-dim h-3.5 w-3.5 shrink-0" />
          <Input
            mono
            placeholder="/Users/you/.nvm/versions/node/v22/bin"
            value={form.pathOverride}
            onChange={(event) => patch({ pathOverride: event.target.value })}
            className="flex-1"
          />
        </div>
      </Field>
      <Field
        label="Pre-command"
        hint="Shell setup that runs before the main command — in the SAME shell session, so env vars (export, source, nvm use, unset) carry into the command. One line per step. Any line exiting non-zero aborts the start (set -e)."
        className="md:col-span-2"
      >
        <div className="flex items-start gap-1.5">
          <Terminal className="text-fg-dim mt-1.5 h-3.5 w-3.5 shrink-0" />
          <Textarea
            mono
            rows={4}
            placeholder={'source .env\nnvm use 14\nunset NODE_OPTIONS'}
            value={form.preCommand}
            onChange={(event) => patch({ preCommand: event.target.value })}
            className="flex-1"
          />
        </div>
      </Field>
      <Field
        label="Shutdown grace period"
        hint="Milliseconds to wait after SIGTERM before escalating to SIGKILL."
      >
        <Input
          mono
          inputMode="numeric"
          value={form.graceMs}
          onChange={(event) => patch({ graceMs: event.target.value.replace(/[^\d]/g, '') })}
        />
      </Field>
      <div className="md:col-span-2">
        <Switch
          checked={form.hideDashboard}
          onChange={(hideDashboard) => patch({ hideDashboard })}
          label="Hide from dashboard"
          description="Track this project in the sidebar, palette, and search only — skip it on the dashboard, dependency scans, and license aggregates. Useful for vendored or docs-only repos that have no run story."
        />
      </div>
    </div>
  );
}
