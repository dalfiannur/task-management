import { create } from "zustand";

import type { MediaViewMode } from "@/types/media";

interface UIState {
  sidebarOpen: boolean;
  viewMode: "list" | "board";
  mediaViewMode: MediaViewMode;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setViewMode: (mode: "list" | "board") => void;
  setMediaViewMode: (mode: MediaViewMode) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  viewMode: "list",
  mediaViewMode: "grid",
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
}));
