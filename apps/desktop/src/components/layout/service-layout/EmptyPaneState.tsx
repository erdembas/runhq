import * as i18n from '@runhq/cockpit-ui/i18n';
export function EmptyPaneState({ onAddTerminal }: { onAddTerminal: () => void }) {
  i18n.useLocale();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <button
        type="button"
        onClick={onAddTerminal}
        className="text-fg-dim hover:text-fg hover:bg-surface-overlay/60 rounded-app-sm border-border/40 border px-3 py-2 text-[12px] transition"
      >
        {i18n.t('Empty pane — click to start a new terminal')}
      </button>
    </div>
  );
}
