import * as i18n from '@runhq/cockpit-ui/i18n';
import { Activity, Check, Copy, PanelRightClose, Pin, RefreshCw, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AiSurfaceTriggerHandle, TimelineSize } from './types';

interface ActivityTimelineHeaderProps {
  eventsCount?: number;
  isEmbedded?: boolean;
  isOverlay?: boolean;
  loading: boolean;
  onClose?: () => void;
  onCollapse: () => void;
  onExportStandup: () => void;
  onPinOpen: () => void;
  onRefresh: () => void;
  size: TimelineSize;
  standupCopied: boolean;
  standupTrigger: AiSurfaceTriggerHandle;
  variant: 'inline' | 'overlay';
}

export function ActivityTimelineHeader({
  eventsCount,
  isEmbedded = false,
  isOverlay = false,
  loading,
  onClose,
  onCollapse,
  onExportStandup,
  onPinOpen,
  onRefresh,
  size,
  standupCopied,
  standupTrigger,
  variant,
}: ActivityTimelineHeaderProps) {
  i18n.useLocale();
  const inline = variant === 'inline';

  return (
    <div
      className={cn(
        inline
          ? 'border-border/40 flex items-center gap-2 border-b'
          : 'border-border/60 flex items-center gap-2.5 border-b',
        size.padX,
        size.headerPY,
      )}
    >
      <div
        className={cn(
          inline
            ? 'bg-accent/10 text-accent flex shrink-0 items-center justify-center rounded-md'
            : 'bg-accent/10 flex items-center justify-center rounded-md',
          size.iconWrap,
        )}
      >
        <Activity className={inline ? 'h-3.5 w-3.5' : 'text-accent h-4 w-4'} />
      </div>
      {inline ? (
        <span
          className={cn('text-fg min-w-0 flex-1 truncate font-semibold tracking-tight', size.title)}
        >
          {i18n.t('Activity')}
        </span>
      ) : (
        <>
          <h2 className={cn('text-fg font-semibold tracking-tight', size.title)}>
            {i18n.t('Activity')}
          </h2>
          <span className={cn('text-fg/40 tabular-nums', size.meta)}>
            {i18n.rich('{value1} total', { value1: eventsCount ?? 0 })}
          </span>
        </>
      )}
      {isOverlay && (
        <span className="bg-fg/6 text-fg/55 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium tracking-wider uppercase">
          {i18n.t('Peek')}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          ref={standupTrigger.triggerRef}
          onClick={() => standupTrigger.onClick()}
          className={cn(
            inline
              ? 'flex items-center gap-1 rounded-md px-2 py-1 font-medium transition'
              : 'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition',
            size.meta,
            'hover:bg-accent/10 text-accent/80 hover:text-accent',
          )}
          title={
            inline
              ? i18n.t('Polish standup with AI (last 24h → Yesterday/Today/Blockers)')
              : i18n.t('Polish standup with AI')
          }
        >
          {i18n.rich('{value1}AI', { value1: <Sparkles size={inline ? 12 : 13} /> })}
        </button>
        {standupTrigger.popover}
        <button
          onClick={onExportStandup}
          className={cn(
            inline
              ? 'flex items-center gap-1 rounded-md px-2 py-1 font-medium transition'
              : 'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition',
            size.meta,
            standupCopied
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'hover:bg-fg/8 text-fg/55 hover:text-fg/85',
          )}
          title={
            inline ? i18n.t('Copy last 24h as raw standup notes') : i18n.t('Copy standup summary')
          }
        >
          {standupCopied ? <Check size={inline ? 12 : 13} /> : <Copy size={inline ? 12 : 13} />}
          {standupCopied ? i18n.t('Copied') : i18n.t('Standup')}
        </button>
        <button
          onClick={onRefresh}
          className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition disabled:opacity-50"
          title={inline ? i18n.t('Refresh now') : i18n.t('Refresh')}
          disabled={loading}
          aria-label={i18n.t('Refresh')}
        >
          <RefreshCw size={inline ? 13 : 14} className={loading ? 'animate-spin' : ''} />
        </button>
        {inline &&
          !isEmbedded &&
          (isOverlay ? (
            <button
              onClick={onPinOpen}
              className="hover:bg-accent/10 text-fg/50 hover:text-accent rounded-md p-1.5 transition"
              title={i18n.t('Pin open')}
              aria-label={i18n.t('Pin open')}
            >
              <Pin size={13} />
            </button>
          ) : (
            <button
              onClick={onCollapse}
              className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition"
              title={i18n.t('Collapse (hover rail to peek)')}
              aria-label={i18n.t('Collapse timeline')}
            >
              <PanelRightClose size={13} />
            </button>
          ))}
        {!inline && onClose && (
          <button
            onClick={onClose}
            className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition"
            aria-label={i18n.t('Close')}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
