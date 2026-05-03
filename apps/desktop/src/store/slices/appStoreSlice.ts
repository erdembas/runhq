import type { StateCreator } from 'zustand';
import type { AppStore } from '@/store/appStoreTypes';

export type AppStoreSlice = StateCreator<AppStore, [], [], Partial<AppStore>>;
