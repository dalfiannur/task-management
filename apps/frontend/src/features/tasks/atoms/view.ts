// How the project Tasks tab lays out its tasks (Jotai). A per-browser
// preference, like the /projects grid/list toggle.

import { atomWithStorage } from "jotai/utils";

export type TasksView = "list" | "board";

export const tasksViewAtom = atomWithStorage<TasksView>(
  "sedjiwa.tasks-view",
  "list",
  undefined,
  { getOnInit: true },
);
