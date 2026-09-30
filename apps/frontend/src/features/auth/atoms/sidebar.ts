// Shell layout state (Jotai). Collapsed is a per-browser preference, so it is
// persisted; the mobile drawer is transient and resets on reload.

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const sidebarCollapsedAtom = atomWithStorage(
  "sedjiwa.sidebar-collapsed",
  false,
  undefined,
  { getOnInit: true },
);

export const mobileNavOpenAtom = atom(false);
