import { create } from "zustand";

import type { MediaViewMode } from "@/types/media";

interface UIState {
  sidebarOpen: boolean;
  viewMode: "list" | "board";
  mediaViewMode: MediaViewMode;
  fmFlatten: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setViewMode: (mode: "list" | "board") => void;
  setMediaViewMode: (mode: MediaViewMode) => void;
  setFmFlatten: (flatten: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  viewMode: "list",
  mediaViewMode: "grid",
  fmFlatten: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
  setFmFlatten: (flatten) => set({ fmFlatten: flatten }),
}));
