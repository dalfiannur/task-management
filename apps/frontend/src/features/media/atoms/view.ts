// How the Media tab lays out its files (Jotai). A per-browser preference, like
// the /projects grid/list toggle.

import { atomWithStorage } from "jotai/utils";

export type MediaView = "grid" | "list";

export const mediaViewAtom = atomWithStorage<MediaView>(
  "sedjiwa.media-view",
  "grid",
  undefined,
  { getOnInit: true },
);
