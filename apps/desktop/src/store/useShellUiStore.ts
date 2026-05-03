import { create } from 'zustand';
import { hasSeenTour } from '@/lib/onboarding';
import type { Shortcuts } from '@/types';

interface TourState {
  open: boolean;
  reopened: boolean;
}

interface ShellUiStore {
  scanPath: string | null;
  portManagerOpen: boolean;
  paletteOpen: boolean;
  tourState: TourState;
  viewShortcuts: Shortcuts | null;
  setScanPath: (path: string | null) => void;
  openPortManager: () => void;
  closePortManager: () => void;
  setPaletteOpen: (open: boolean) => void;
  openTourReplay: () => void;
  closeTour: () => void;
  setViewShortcuts: (shortcuts: Shortcuts | null) => void;
}

export const useShellUiStore = create<ShellUiStore>((set) => ({
  scanPath: null,
  portManagerOpen: false,
  // Mirrors the floating quick-action window: while it is open, App renders
  // a backdrop over the main window so the palette reads as modal chrome.
  paletteOpen: false,
  // `reopened` differentiates first-run onboarding from a user-triggered
  // replay; replay mode hides the "Skip tour" affordance.
  tourState: {
    open: !hasSeenTour(),
    reopened: false,
  },
  viewShortcuts: null,
  setScanPath: (scanPath) => set({ scanPath }),
  openPortManager: () => set({ portManagerOpen: true }),
  closePortManager: () => set({ portManagerOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openTourReplay: () => set({ tourState: { open: true, reopened: true } }),
  closeTour: () => set({ tourState: { open: false, reopened: false } }),
  setViewShortcuts: (viewShortcuts) => set({ viewShortcuts }),
}));
