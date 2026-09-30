// Timeline zoom level (Jotai). A per-browser preference, like the Tasks tab's
// list/board toggle.

import { atomWithStorage } from "jotai/utils";
import type { Zoom } from "../timeline-utils";

export const timelineZoomAtom = atomWithStorage<Zoom>(
  "sedjiwa.timeline-zoom",
  "day",
  undefined,
  { getOnInit: true },
);
