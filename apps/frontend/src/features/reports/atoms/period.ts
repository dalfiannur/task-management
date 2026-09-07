import { atom } from "jotai";
import type { Granularity } from "../types";

/** Which period the page is showing. Session-local: a report is read, not
 *  configured, so there is nothing here worth persisting between visits. */
export const periodAtom = atom<{ granularity: Granularity; offset: number }>({
  granularity: "weekly",
  offset: -1, // the last complete period — the one a team actually reports on
});
