import { useCallback, useMemo, useRef } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { cn } from '@/lib/cn';
import type { TimelineEvent } from '@/types';
import { ActivityCollapsedRail } from '@/components/activity-timeline/ActivityCollapsedRail';
import { ActivityEventList } from '@/components/activity-timeline/ActivityEventList';
import { ActivityEventModal } from '@/components/activity-timeline/ActivityEventModal';
import { ActivitySummaryStrip } from '@/components/activity-timeline/ActivitySummaryStrip';
import { ActivityTimelineFilters } from '@/components/activity-timeline/ActivityTimelineFilters';
import { ActivityTimelineFooter } from '@/components/activity-timeline/ActivityTimelineFooter';
import { ActivityTimelineHeader } from '@/components/activity-timeline/ActivityTimelineHeader';
import { ActivityWeeklySparkline } from '@/components/activity-timeline/ActivityWeeklySparkline';
import {
  TIMELINE_COLLAPSED_W,
  activityFilterCount,
  formatTime,
  timelineSize,
} from '@/components/activity-timeline/model';
import type { ActivityTimelineProps } from '@/components/activity-timeline/types';
import { useActivityConsoleSections } from '@/components/activity-timeline/useActivityConsoleSections';
import { useActivityKeyboard } from '@/components/activity-timeline/useActivityKeyboard';
import { useActivityStandup } from '@/components/activity-timeline/useActivityStandup';
import { useActivityTimelineData } from '@/components/activity-timeline/useActivityTimelineData';
import { useActivityTimelineDerived } from '@/components/activity-timeline/useActivityTimelineDerived';
import {
  useActivityTimelineStore,
  useActivityTimelineStoreRef,
} from '@/components/activity-timeline/useActivityTimelineStore';
import { useTimelineAnsi } from '@/components/activity-timeline/useTimelineAnsi';
import { useTimelineChrome } from '@/components/activity-timeline/useTimelineChrome';

export function ActivityTimeline({
  onClose,
  variant = 'overlay',
  embedded = false,
}: ActivityTimelineProps) {
  const store = useActivityTimelineStoreRef();
  const state = useActivityTimelineStore(store, (timeline) => timeline);
  const isInline = variant === 'inline';
  const size = useMemo(() => timelineSize(isInline), [isInline]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { ansi, isDark } = useTimelineAnsi();
  const chrome = useTimelineChrome(store);
  const refresh = useActivityTimelineData(store, {
    isInline,
    collapsed: state.collapsed,
    hoverOpen: state.hoverOpen,
  });
  const standup = useActivityStandup(state.markStandupCopied);

  useActivityKeyboard(store, {
    isInline,
    collapsed: state.collapsed,
    hoverOpen: state.hoverOpen,
    onClose,
    searchInputRef,
  });

  const derived = useActivityTimelineDerived(state.events, state.search, state.filterType);
  const consoleSectionsFor = useActivityConsoleSections(state.events, derived.childrenByRun);
  const activeFilterCount = activityFilterCount(
    state.filterType,
    state.filterProject,
    state.timeRange,
    state.search,
  );
  const selectedEvent = state.events.find((event) => event.id === state.selectedId) ?? null;
  const modalEvent =
    state.modalEventId !== null
      ? (state.events.find((event) => event.id === state.modalEventId) ?? null)
      : null;

  const handleCopyDetail = useCallback(
    async (event: TimelineEvent) => {
      try {
        const header = `[${formatTime(event.timestamp)}] ${event.event_type}${
          event.service_name ? ` · ${event.service_name}` : ''
        }`;
        await writeText(`${header}\n${event.description}`);
        state.markDetailCopied();
      } catch (error) {
        console.error('Failed to copy event', error);
      }
    },
    [state],
  );

  const panelContent = (
    <>
      <ActivitySummaryStrip summary={state.summary} size={size} />
      <ActivityWeeklySparkline weeklySummary={state.weeklySummary} size={size} />
      <ActivityTimelineFilters
        activeFilterCount={activeFilterCount}
        clearFilters={state.clearFilters}
        filterProject={state.filterProject}
        filterType={state.filterType}
        projectNames={derived.projectNames}
        search={state.search}
        searchInputRef={searchInputRef}
        setFilterProject={(filterProject) => state.patch({ filterProject })}
        setFilterType={(filterType) => state.patch({ filterType })}
        setSearch={(search) => state.patch({ search })}
        setTimeRange={(timeRange) => state.patch({ timeRange })}
        size={size}
        timeRange={state.timeRange}
      />
      <ActivityEventList
        activeFilterCount={activeFilterCount}
        ansi={ansi}
        childrenByRun={derived.childrenByRun}
        clearFilters={state.clearFilters}
        consoleSectionsFor={consoleSectionsFor}
        detailCopied={state.detailCopied}
        events={state.events}
        filteredEvents={derived.filteredEvents}
        grouped={derived.grouped}
        isDark={isDark}
        isInline={isInline}
        loading={state.loading}
        now={state.now}
        onCopyEvent={(event) => void handleCopyDetail(event)}
        search={state.search}
        selectedId={state.selectedId}
        setModalEventId={(modalEventId) => state.patch({ modalEventId })}
        setSearch={(search) => state.patch({ search })}
        setSelectedId={(selectedId) => state.patch({ selectedId })}
        size={size}
      />
      <ActivityTimelineFooter
        eventCount={state.events.length}
        filteredCount={derived.filteredEvents.length}
        selectedEvent={selectedEvent}
        size={size}
      />
    </>
  );

  if (isInline) {
    const isPanelVisible = embedded ? true : !state.collapsed || state.hoverOpen;
    const isOverlay = !embedded && state.collapsed && state.hoverOpen;

    return (
      <div
        className="relative flex h-full min-h-0 shrink-0 self-stretch"
        style={
          embedded
            ? { width: '100%' }
            : { width: state.collapsed ? TIMELINE_COLLAPSED_W : state.width }
        }
        onMouseEnter={() => {
          if (!embedded && state.collapsed) chrome.scheduleHoverOpen();
        }}
        onMouseLeave={() => {
          if (!embedded && state.collapsed) chrome.scheduleHoverClose();
        }}
      >
        {!embedded && state.collapsed && (
          <ActivityCollapsedRail
            summary={state.summary}
            onClick={() => state.setCollapsed(false)}
            onFocus={chrome.scheduleHoverOpen}
          />
        )}

        {isPanelVisible && (
          <div
            className={cn(
              'border-border/60 flex min-h-0 min-w-0 flex-col overflow-hidden',
              !embedded && 'bg-surface border-l',
              embedded && 'bg-transparent',
              isOverlay
                ? 'animate-in slide-in-from-right absolute top-0 right-0 bottom-0 z-40 max-h-full shadow-2xl duration-150'
                : 'h-full flex-1',
            )}
            style={isOverlay ? { width: state.width } : undefined}
            onMouseEnter={() => {
              if (state.collapsed) {
                chrome.clearHoverTimer();
                state.patch({ hoverOpen: true });
              }
            }}
          >
            <ActivityTimelineHeader
              isEmbedded={embedded}
              isOverlay={isOverlay}
              loading={state.loading}
              onCollapse={() => state.setCollapsed(true)}
              onExportStandup={() => void standup.exportStandup()}
              onPinOpen={() => state.setCollapsed(false)}
              onRefresh={() => void refresh()}
              size={size}
              standupCopied={state.standupCopied}
              standupTrigger={standup.standupOverlay}
              variant="inline"
            />
            {panelContent}
          </div>
        )}

        {!embedded && !state.collapsed && (
          <div
            onPointerDown={chrome.onResizeStart}
            onPointerMove={chrome.onResizeMove}
            onPointerUp={chrome.onResizeEnd}
            onPointerCancel={chrome.onResizeEnd}
            className="group absolute top-0 bottom-0 left-0 z-20 w-2 cursor-col-resize"
            aria-hidden
          >
            <div className="group-hover:bg-accent/30 group-active:bg-accent/50 absolute top-0 bottom-0 left-0 w-[2px] transition-colors" />
          </div>
        )}
        <ActivityEventModal
          ansi={ansi}
          consoleSectionsFor={consoleSectionsFor}
          detailCopied={state.detailCopied}
          event={modalEvent}
          isDark={isDark}
          onClose={() => state.patch({ modalEventId: null })}
          onCopy={(event) => void handleCopyDetail(event)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close timeline"
      />
      <div className="bg-surface border-border animate-in slide-in-from-right relative flex h-full w-[680px] flex-col shadow-2xl duration-300">
        <ActivityTimelineHeader
          eventsCount={state.events.length}
          loading={state.loading}
          onClose={onClose}
          onCollapse={() => state.setCollapsed(true)}
          onExportStandup={() => void standup.exportStandup()}
          onPinOpen={() => state.setCollapsed(false)}
          onRefresh={() => void refresh()}
          size={size}
          standupCopied={state.standupCopied}
          standupTrigger={standup.standupHeader}
          variant="overlay"
        />
        {panelContent}
      </div>
      <ActivityEventModal
        ansi={ansi}
        consoleSectionsFor={consoleSectionsFor}
        detailCopied={state.detailCopied}
        event={modalEvent}
        isDark={isDark}
        onClose={() => state.patch({ modalEventId: null })}
        onCopy={(event) => void handleCopyDetail(event)}
      />
    </div>
  );
}
