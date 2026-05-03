import type { AiChatStoreSlice } from '@/store/types/aiChatTypes';
import type { FilterStoreSlice } from '@/store/types/filterTypes';
import type { MainTabStoreSlice } from '@/store/types/mainTabTypes';
import type { OverviewStoreSlice } from '@/store/types/overviewStoreTypes';
import type { SectionStoreSlice } from '@/store/types/sectionStoreTypes';
import type { UiStoreSlice } from '@/store/types/uiStoreTypes';
import type { WorkspaceStoreSlice } from '@/store/types/workspaceStoreTypes';

export type {
  AiActionHook,
  AiDraft,
  AiChatStoreSlice,
  OpenAiChatInput,
} from '@/store/types/aiChatTypes';
export type {
  DashboardGroupBy,
  DashboardSortBy,
  FilterStoreSlice,
  SidebarGroupBy,
  SidebarStatusFilter,
} from '@/store/types/filterTypes';
export {
  DASHBOARD_TAB,
  DASHBOARD_TAB_KEY,
  RELEASE_NOTES_TAB,
  RELEASE_NOTES_TAB_KEY,
  SETTINGS_TAB,
  SETTINGS_TAB_KEY,
  mainTabKey,
} from '@/store/types/mainTabTypes';
export type { MainTab, MainTabKind, MainTabStoreSlice } from '@/store/types/mainTabTypes';
export type { OverviewStoreSlice } from '@/store/types/overviewStoreTypes';
export type { SectionStoreSlice } from '@/store/types/sectionStoreTypes';
export type { SettingsCategoryId } from '@/store/types/settingsTypes';
export type { UiStoreSlice } from '@/store/types/uiStoreTypes';
export type { LogBuffer, WorkspaceStoreSlice } from '@/store/types/workspaceStoreTypes';

export interface AppStore
  extends
    WorkspaceStoreSlice,
    MainTabStoreSlice,
    FilterStoreSlice,
    SectionStoreSlice,
    UiStoreSlice,
    AiChatStoreSlice,
    OverviewStoreSlice {}
