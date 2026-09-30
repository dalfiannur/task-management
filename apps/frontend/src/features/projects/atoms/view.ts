// How /projects lays out its results (Jotai). A per-browser preference, like pins.

import { atomWithStorage } from "jotai/utils";

export type ProjectsView = "grid" | "list";

export const projectsViewAtom = atomWithStorage<ProjectsView>(
  "sedjiwa.projects-view",
  "grid",
  undefined,
  { getOnInit: true },
);
