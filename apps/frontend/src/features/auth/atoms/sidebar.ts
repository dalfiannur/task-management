// Shell layout state (Jotai). Collapsed is a per-browser preference, so it is
// persisted. The mobile sheet is owned by sedjiwa-ui's SidebarProvider.

import { atomWithStorage } from "jotai/utils";

export const sidebarCollapsedAtom = atomWithStorage(
  "sedjiwa.sidebar-collapsed",
  false,
  undefined,
  { getOnInit: true },
);
